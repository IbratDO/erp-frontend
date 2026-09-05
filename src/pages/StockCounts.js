import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import api from '../utils/api';
import Modal, { WIDE } from '../components/Modal';
import PageTitle from '../components/PageTitle';
import StockCountModal from '../components/StockCountModal';
import StockCountReport from '../components/StockCountReport';
import TableDownloadButton from '../components/TableDownloadButton';
import useAppTranslation from '../hooks/useAppTranslation';
import { usePermissions } from '../hooks/usePermissions';
import { formatAppDateTime } from '../utils/localeFormat';
import { formatLabelPrice } from '../utils/layerLabel';
import { countExportFilename, countReportToMatrix } from '../utils/stockCountExport';
import { csvFilename, downloadCsv, matrixToCsv } from '../utils/tableCsv';
import './TablePage.css';

/**
 * Ombor nazorati — every stocktake the shop has ever done.
 *
 * Counting already worked; what it had no home for was *afterwards*. A count lived inside one
 * modal, and once that modal closed the only evidence it had happened was a stock loss sitting in
 * the expense list with nothing to explain it. This page is the record: who walked the shelves,
 * when, what they found, and what it cost.
 *
 * Two things about it are deliberate.
 *
 * **Cancelled and abandoned counts are listed.** "We started counting on the 3rd and gave up" is
 * exactly the kind of thing the owner of a shop wants to be able to see. Showing only the counts
 * that finished would make the page look like nothing ever goes wrong.
 *
 * **The figures come from the server, not from arithmetic here.** They have to match the report
 * the row opens and the file it downloads, and three separate calculations of the same total is
 * how a page comes to disagree with itself.
 */
export default function StockCounts() {
  const { t } = useAppTranslation(['inventory', 'common']);
  const { hasPermission } = usePermissions();
  const canCount = hasPermission('inventory.count');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [countingOpen, setCountingOpen] = useState(false);
  const [viewing, setViewing] = useState(null);   // { count, report } | 'loading'
  const [busyId, setBusyId] = useState(null);
  const tableRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/stock-counts/');
      setRows(Array.isArray(res.data) ? res.data : (res.data?.results || []));
      setError('');
    } catch (err) {
      console.error('Error loading stock counts:', err);
      setError(t('stockCount.history.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const scopeName = useCallback(
    (scope) => t(scope === 'full' ? 'stockCount.scopeFull' : 'stockCount.scopePartial'),
    [t],
  );
  const statusName = useCallback((status) => t(`stockCount.history.statuses.${status}`, status), [t]);
  const kindName = useCallback((kind) => t(`stockCount.history.kinds.${kind}`, kind), [t]);

  /** Column headings for the per-count file. Kept beside the table's own so the two stay level. */
  const exportLabels = useMemo(() => ({
    title: t('stockCount.title'),
    startedAt: t('stockCount.history.startedAt'),
    startedBy: t('stockCount.history.startedBy'),
    // Not `scopeLabel`: that is the question asked while starting a count ("what are you
    // counting?"), which reads as nonsense as a label in a filed record.
    scope: t('stockCount.history.scope'),
    status: t('stockCount.history.status'),
    appliedAt: t('stockCount.history.appliedAt'),
    appliedBy: t('stockCount.history.appliedBy'),
    scannedLines: t('stockCount.history.scannedLines'),
    countedUnits: t('stockCount.history.countedUnits'),
    missingUnits: t('stockCount.history.missingUnits'),
    surplusUnits: t('stockCount.history.surplusUnits'),
    notCounted: t('stockCount.history.notCountedLines'),
    lossUsd: t('stockCount.history.lossUsd'),
    lossUzs: t('stockCount.history.lossUzs'),
    columns: [
      t('table.layerNo'), t('stockCount.history.barcode'), t('table.product'),
      t('table.size'), t('stockCount.history.color'),
      t('stockCount.expectedAtStart'), t('stockCount.movedSince'), t('stockCount.systemNow'),
      t('stockCount.counted'), t('stockCount.difference'), t('stockCount.history.verdict'),
      t('stockCount.history.lossUsd'), t('stockCount.history.lossUzs'),
    ],
    formatDateTime: formatAppDateTime,
    scopeName,
    statusName,
    kindName,
  }), [t, scopeName, statusName, kindName]);

  const openReport = async (count) => {
    setBusyId(count.id);
    try {
      const res = await api.get(`/stock-counts/${count.id}/report/`);
      setViewing({ count, report: res.data });
    } catch (err) {
      console.error('Error loading stock count report:', err);
      setError(t('stockCount.history.loadFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const downloadOne = async (count) => {
    setBusyId(count.id);
    try {
      const res = await api.get(`/stock-counts/${count.id}/report/`);
      const matrix = countReportToMatrix(res.data, exportLabels);
      downloadCsv(csvFilename(countExportFilename(count)), matrixToCsv(matrix));
    } catch (err) {
      console.error('Error downloading stock count:', err);
      setError(t('stockCount.history.loadFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const money = (usd, uzs) => {
    const parts = [
      formatLabelPrice({ amount: Number(usd) || 0, currency: 'USD' }),
      formatLabelPrice({ amount: Number(uzs) || 0, currency: 'UZS' }),
    ].filter(Boolean);
    return parts.length ? parts.join(' + ') : '—';
  };

  // A count left open is not history, it is unfinished work — and the modal resumes exactly where
  // it was left, so the useful thing to offer is a way back into it.
  const openCount = rows.find((row) => row.status === 'open');

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="inventory" titleKey="stockCount.history.title" />
        {canCount && (
          <button type="button" className="btn-primary" onClick={() => setCountingOpen(true)}>
            {openCount ? t('stockCount.history.resume') : t('stockCount.button')}
          </button>
        )}
      </div>

      <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9em', maxWidth: 820 }}>
        {t('stockCount.history.intro')}
      </p>

      {error && <div className="notification error" style={{ marginBottom: 12 }}>{error}</div>}

      <StockCountModal
        open={countingOpen}
        onClose={() => { setCountingOpen(false); load(); }}
      />

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={t('stockCount.history.reportTitle', { id: viewing?.count?.id ?? '' })}
        closeLabel={t('actions.close', { ns: 'common' })}
        width={WIDE}
      >
        {viewing && (
          <StockCountReport
            report={viewing.report}
            status={viewing.count.status}
            onClose={() => setViewing(null)}
          />
        )}
      </Modal>

      <div className="table-card">
        <div className="table-card__toolbar">
          <TableDownloadButton
            tableRef={tableRef}
            filename="inventarizatsiya-tarixi"
            rowCount={rows.length}
          />
        </div>
        <div className="data-table-scroll">
          <table className="data-table" ref={tableRef}>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('stockCount.history.startedAt')}</th>
                <th>{t('stockCount.history.startedBy')}</th>
                <th>{t('stockCount.history.scope')}</th>
                <th>{t('stockCount.history.scannedLines')}</th>
                <th>{t('stockCount.history.countedUnits')}</th>
                <th>{t('stockCount.history.missingUnits')}</th>
                <th>{t('stockCount.history.surplusUnits')}</th>
                <th>{t('stockCount.history.loss')}</th>
                <th>{t('stockCount.history.appliedBy')}</th>
                <th>{t('table.actions', { ns: 'common' })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="11" style={{ textAlign: 'center' }}>
                    {t('stockCount.history.empty')}
                  </td>
                </tr>
              ) : rows.map((row) => {
                const s = row.summary || {};
                return (
                  <tr key={row.id} className={`stock-count-row--${row.status}`}>
                    <td>#{row.id}</td>
                    <td>{formatAppDateTime(row.started_at) || '—'}</td>
                    <td>{row.started_by_name || '—'}</td>
                    <td>{scopeName(row.scope)}</td>
                    <td>{s.scanned_lines ?? 0}</td>
                    <td>{s.counted_units ?? 0}</td>
                    <td>{s.missing_units ? <strong>{s.missing_units}</strong> : '—'}</td>
                    <td>{s.surplus_units ? `+${s.surplus_units}` : '—'}</td>
                    <td>{s.missing_units ? money(s.loss_usd, s.loss_uzs) : '—'}</td>
                    <td>
                      {row.applied_by_name
                        ? `${row.applied_by_name} · ${formatAppDateTime(row.applied_at)}`
                        : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn-edit"
                          onClick={() => openReport(row)}
                          disabled={busyId === row.id}
                        >
                          {t('actions.view', { ns: 'common' })}
                        </button>
                        <button
                          type="button"
                          className="btn-edit"
                          onClick={() => downloadOne(row)}
                          disabled={busyId === row.id}
                          title={t('stockCount.history.downloadOneHint')}
                        >
                          {t('actions.downloadExcel', { ns: 'common' })}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
