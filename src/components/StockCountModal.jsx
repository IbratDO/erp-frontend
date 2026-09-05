import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Modal, { WIDE } from './Modal';
import api from '../utils/api';
import useAppTranslation from '../hooks/useAppTranslation';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { normalizeScan } from '../utils/layerBarcode';
import { beepError, beepOk, primeScanBeep } from '../utils/scanBeep';
import StockCountReport from './StockCountReport';

/**
 * Inventarizatsiya — walking the shop with a scanner and putting the books right afterwards.
 *
 * One window with three faces, decided by the count's own status rather than by local state, so
 * closing the page and coming back lands exactly where the work was left:
 *
 *   no count   → choose what is being counted, and start
 *   open       → scan, with a running tally
 *   counted    → what was found
 *
 * **Nothing in this window changes stock or money.** It used to end with an Apply button that
 * wrote the shortage off; that was removed at the owner's instruction, so a count now records
 * what was seen and stops there. Every count is kept on the Ombor nazorati page, which is where
 * what it found gets read and acted on.
 */
export default function StockCountModal({ open, onClose }) {
  const { t } = useAppTranslation(['inventory', 'common']);

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
        <StockCountReport report={report} status={status} onClose={onClose} />
      )}
    </Modal>
  );
}
