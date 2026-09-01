import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Modal, { WIDE } from './Modal';
import api from '../utils/api';
import useAppTranslation from '../hooks/useAppTranslation';
import { usePermissions } from '../hooks/usePermissions';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { normalizeScan } from '../utils/layerBarcode';
import { beepError, beepOk, primeScanBeep } from '../utils/scanBeep';
import { formatLabelPrice } from '../utils/layerLabel';

/**
 * Inventarizatsiya — walking the shop with a scanner and putting the books right afterwards.
 *
 * One window with three faces, decided by the count's own status rather than by local state, so
 * closing the page and coming back lands exactly where the work was left:
 *
 *   no count   → choose what is being counted, and start
 *   open       → scan, with a running tally
 *   counted    → what was found, and (for those allowed) the button that corrects the books
 *
 * The counting screen writes nothing anyone can lose money over. Only **Apply** does, and it is
 * hidden from anyone without `inventory.count_apply` — the CEO counts, the Founder decides.
 */
export default function StockCountModal({ open, onClose, onApplied }) {
  const { t } = useAppTranslation(['inventory', 'common']);
  const { hasPermission } = usePermissions();
  const canApply = hasPermission('inventory.count_apply');

  const [count, setCount] = useState(null);
  const [lines, setLines] = useState([]);
  const [report, setReport] = useState(null);
  const [scope, setScope] = useState('partial');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const seqRef = useRef(0);

  const status = count?.status || null;

  const say = useCallback((kind, text) => {
    seqRef.current += 1;
    setFeedback({ kind, text, seq: seqRef.current });
    if (kind === 'ok') beepOk();
    else beepError();
  }, []);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);

  const loadLines = useCallback(async (id) => {
    const res = await api.get(`/stock-counts/${id}/lines/`);
    setLines(res.data.lines || []);
  }, []);

  const loadReport = useCallback(async (id) => {
    const res = await api.get(`/stock-counts/${id}/report/`);
    setReport(res.data);
  }, []);

  // Resume whatever was left open. A count spans shelves and coffee breaks; the browser is not
  // where it lives.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/stock-counts/open/');
        const existing = res.data.stock_count;
        if (cancelled) return;
        setCount(existing);
        if (existing) await loadLines(existing.id);
      } catch (err) {
        console.error('Error loading stock count:', err);
      }
    })();
    primeScanBeep();
    return () => { cancelled = true; };
  }, [open, loadLines]);

  useEffect(() => {
    if (status === 'counted' && count?.id) loadReport(count.id);
  }, [status, count?.id, loadReport]);

  const handleScan = useCallback(async (raw) => {
    const code = normalizeScan(raw);
    if (!code || !count || count.status !== 'open') return;
    try {
      const res = await api.post(`/stock-counts/${count.id}/scan/`, { barcode: code });
      const line = res.data.line;
      const name = line.product_detail
        ? `${line.product_detail.brand} | ${line.product_detail.model} · ${line.product_detail.size}`
        : `#${line.batch_id}`;
      say('ok', t('stockCount.scanned', { name, counted: line.counted_quantity }));
      await loadLines(count.id);
    } catch (err) {
      const msg = err?.response?.data?.error;
      say('error', msg || t('stockCount.scanUnknown', { code }));
    }
  }, [count, say, t, loadLines]);

  useBarcodeScanner({ enabled: open && status === 'open', onScan: handleScan });

  const act = async (fn, label) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      say('error', err?.response?.data?.error || t('stockCount.errGeneric', { step: label }));
    } finally {
      setBusy(false);
    }
  };

  const start = () => act(async () => {
    const res = await api.post('/stock-counts/start/', { scope });
    setCount(res.data.stock_count);
    await loadLines(res.data.stock_count.id);
  }, 'start');

  const finish = () => act(async () => {
    const res = await api.post(`/stock-counts/${count.id}/finish/`);
    setCount(res.data.stock_count);
  }, 'finish');

  const cancel = () => act(async () => {
    if (!window.confirm(t('stockCount.confirmCancel'))) return;
    await api.post(`/stock-counts/${count.id}/cancel/`);
    setCount(null);
    setLines([]);
    setReport(null);
  }, 'cancel');

  const correct = (batchId, units) => act(async () => {
    await api.post(`/stock-counts/${count.id}/set_counted/`, {
      batch_id: batchId, units: units === '' ? null : Number(units),
    });
    await loadLines(count.id);
  }, 'correct');

  const apply = () => act(async () => {
    const totals = report?.totals;
    if (!window.confirm(t('stockCount.confirmApply', {
      units: totals?.missing_units ?? 0,
      amount: formatLabelPrice({ amount: Number(totals?.loss_usd) || 0, currency: 'USD' })
        || '0.00 y.e',
    }))) return;
    const res = await api.post(`/stock-counts/${count.id}/apply/`);
    setCount(res.data.stock_count);
    await loadReport(count.id);
    onApplied?.();
  }, 'apply');

  // Only what has actually been scanned, newest first. The full list is every layer in the shop
  // and would bury the two lines the person is looking at.
  const scanned = useMemo(
    () => lines.filter((l) => l.counted_quantity != null)
      .sort((a, b) => b.batch_id - a.batch_id),
    [lines],
  );

  const productName = (line) => (line.product_detail
    ? `${line.product_detail.brand} | ${line.product_detail.model}`
    : `#${line.batch_id}`);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('stockCount.title')}
      closeLabel={t('actions.close', { ns: 'common' })}
      width={WIDE}
      closeOnBackdrop={false}
    >
      <div
        className={`scan-strip__feedback scan-strip__feedback--${feedback?.kind === 'ok' ? 'added' : (feedback?.kind || 'idle')}`}
        role="status"
        aria-live="polite"
        style={{ display: 'block', minHeight: 20, marginBottom: 8 }}
      >
        {feedback?.text || ''}
      </div>

      {/* ---- nothing open yet: say what is being counted ------------------------------ */}
      {!count && (
        <div>
          <p style={{ color: '#666', marginBottom: 12 }}>{t('stockCount.intro')}</p>
          <div className="form-group">
            <label>{t('stockCount.scopeLabel')}</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="partial">{t('stockCount.scopePartial')}</option>
              <option value="full">{t('stockCount.scopeFull')}</option>
            </select>
            {/*
              The dangerous option, named plainly. A full count treats anything never scanned as
              gone, so choosing it by accident on a half-walked shop would write off the rest.
            */}
            <small className={scope === 'full' ? 'stock-count__warn' : 'label-print__hint'}>
              {scope === 'full' ? t('stockCount.scopeFullWarn') : t('stockCount.scopePartialHint')}
            </small>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={start} disabled={busy}>
              {t('stockCount.start')}
            </button>
          </div>
        </div>
      )}

      {/* ---- counting -------------------------------------------------------------------- */}
      {status === 'open' && (
        <div>
          <p style={{ color: '#666', marginBottom: 12 }}>
            {t('stockCount.scanning', {
              scope: t(count.scope === 'full' ? 'stockCount.scopeFull' : 'stockCount.scopePartial'),
              scanned: scanned.length,
              total: lines.length,
            })}
          </p>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('table.layerNo')}</th>
                  <th>{t('table.product')}</th>
                  <th>{t('table.size')}</th>
                  <th>{t('stockCount.counted')}</th>
                  <th>{t('stockCount.systemNow')}</th>
                  <th>{t('table.actions', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {scanned.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center' }}>{t('stockCount.nothingYet')}</td></tr>
                ) : scanned.map((line) => (
                  <tr key={line.id}>
                    <td>#{line.batch_id}</td>
                    <td>{productName(line)}</td>
                    <td>{line.product_detail?.size || '-'}</td>
                    <td><strong>{line.counted_quantity}</strong></td>
                    <td>{line.system_now}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        defaultValue={line.counted_quantity}
                        style={{ width: 70 }}
                        onBlur={(e) => {
                          if (String(e.target.value) === String(line.counted_quantity)) return;
                          correct(line.batch_id, e.target.value);
                        }}
                        aria-label={t('stockCount.counted')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={finish} disabled={busy}>
              {t('stockCount.finish')}
            </button>
            <button type="button" className="btn-edit" onClick={cancel} disabled={busy}>
              {t('stockCount.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ---- the result, and the decision ----------------------------------------------- */}
      {(status === 'counted' || status === 'applied') && report && (
        <StockCountReport
          report={report}
          status={status}
          canApply={canApply}
          busy={busy}
          onApply={apply}
          onClose={onClose}
          t={t}
        />
      )}
    </Modal>
  );
}

/** The four buckets, and what the shortage is worth. Split out only to keep the file readable. */
function StockCountReport({ report, status, canApply, busy, onApply, onClose, t }) {
  const { totals, verdicts } = report;
  const notable = verdicts.filter((v) => v.kind === 'short' || v.kind === 'over');

  return (
    <div>
      <div className="stock-count__totals">
        <span className="stock-count__chip stock-count__chip--ok">
          {t('stockCount.totalMatch', { count: totals.match })}
        </span>
        <span className="stock-count__chip stock-count__chip--short">
          {t('stockCount.totalShort', { count: totals.short, units: totals.missing_units })}
        </span>
        <span className="stock-count__chip stock-count__chip--over">
          {t('stockCount.totalOver', { count: totals.over })}
        </span>
        <span className="stock-count__chip">
          {t('stockCount.totalNotCounted', { count: totals.not_counted })}
        </span>
      </div>

      <p style={{ margin: '12px 0', fontWeight: 600 }}>
        {t('stockCount.lossTotal', {
          usd: formatLabelPrice({ amount: Number(totals.loss_usd) || 0, currency: 'USD' }) || '—',
          uzs: formatLabelPrice({ amount: Number(totals.loss_uzs) || 0, currency: 'UZS' }) || '—',
        })}
      </p>

      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('table.layerNo')}</th>
              <th>{t('table.product')}</th>
              <th>{t('stockCount.expectedAtStart')}</th>
              <th>{t('stockCount.movedSince')}</th>
              <th>{t('stockCount.systemNow')}</th>
              <th>{t('stockCount.counted')}</th>
              <th>{t('stockCount.difference')}</th>
              <th>{t('stockCount.loss')}</th>
            </tr>
          </thead>
          <tbody>
            {notable.length === 0 ? (
              <tr><td colSpan="8" style={{ textAlign: 'center' }}>{t('stockCount.allMatched')}</td></tr>
            ) : notable.map((v) => (
              <tr key={v.batch_id} className={v.kind === 'short' ? 'row-short' : 'row-over'}>
                <td>#{v.batch_id}</td>
                <td>
                  {v.line?.product_detail
                    ? `${v.line.product_detail.brand} | ${v.line.product_detail.model} · ${v.line.product_detail.size}`
                    : '-'}
                </td>
                <td>{v.expected_at_start}</td>
                {/* Nearly always the till. Shown so a difference a sale caused is not chased. */}
                <td>{v.moved_since_start || '—'}</td>
                <td>{v.system_now}</td>
                <td><strong>{v.counted == null ? '—' : v.counted}</strong></td>
                <td><strong>{v.difference > 0 ? `+${v.difference}` : v.difference}</strong></td>
                <td>
                  {v.missing > 0
                    ? formatLabelPrice({ amount: Number(v.loss_usd) || 0, currency: 'USD' }) || '—'
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totals.over > 0 && (
        <p className="stock-count__note">{t('stockCount.surplusNote')}</p>
      )}

      <div className="form-actions">
        {status === 'counted' && canApply && (
          <button type="button" className="btn-danger-action" onClick={onApply} disabled={busy}>
            {t('stockCount.apply')}
          </button>
        )}
        {status === 'counted' && !canApply && (
          <span className="stock-count__note">{t('stockCount.applyNotYours')}</span>
        )}
        {status === 'applied' && (
          <span className="stock-count__note">{t('stockCount.applied')}</span>
        )}
        <button type="button" className="btn-edit" onClick={onClose}>
          {t('actions.close', { ns: 'common' })}
        </button>
      </div>
    </div>
  );
}
