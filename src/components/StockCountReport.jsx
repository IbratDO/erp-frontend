import React from 'react';

import useAppTranslation from '../hooks/useAppTranslation';
import { formatLabelPrice } from '../utils/layerLabel';

/**
 * What a count found: the four buckets, what the shortage is worth, and the lines behind it.
 *
 * Shared by the window you count in and the history page you read it back on, because those two
 * must not be allowed to describe the same count differently. Whoever reads a count and whoever
 * queries it a month later are often the same person, and a screen that has quietly changed its
 * mind in between is worse than no record at all.
 *
 * **This screen only reports.** It used to end with a button that wrote the shortage off — took
 * the missing units off their layer and booked their cost as a loss. That button was removed at
 * the owner's instruction, so a count now produces evidence and stops there: it tells you what is
 * missing and what it is worth, and correcting the books is a separate decision taken elsewhere.
 * The consequence is worth knowing rather than discovering: nothing here reduces stock any more,
 * so the books go on carrying goods a count has already found to be off the shelf.
 *
 * The endpoint behind that button still exists and is still permission-gated; only the way in
 * from this screen is gone.
 */
export default function StockCountReport({ report, status, onClose }) {
  const { t } = useAppTranslation(['inventory', 'common']);
  const { totals, verdicts } = report || {};
  if (!totals) return null;

  // Everything that matched is left out: on a full shop count that is a hundred and fifty rows of
  // "fine", and the handful that are not fine is the entire reason anybody opened this.
  const notable = (verdicts || []).filter((v) => v.kind === 'short' || v.kind === 'over');

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
        {/* Kept for counts applied before the write-off button was removed, so their rows still
            explain themselves rather than looking like any other finished count. */}
        {status === 'applied' && (
          <span className="stock-count__note">{t('stockCount.applied')}</span>
        )}
        {onClose && (
          <button type="button" className="btn-edit" onClick={onClose}>
            {t('actions.close', { ns: 'common' })}
          </button>
        )}
      </div>
    </div>
  );
}
