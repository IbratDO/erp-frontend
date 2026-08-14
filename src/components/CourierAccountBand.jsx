import React, { useState } from 'react';
import { formatDisplayAmount } from '../utils/currencyFormat';

/**
 * What a courier is holding right now, and what the shop owes him.
 *
 * The question a shop asks at the end of every day, which used to mean opening deliveries one by
 * one and adding up in your head. Every figure comes from the three-step settlement's own stamps —
 * nothing here is recorded separately, so the band cannot drift from the deliveries below it.
 *
 * Cash is the **gross** he collected. If he handed the customer change out of his own pocket he is
 * carrying that too — the sub-line names it, because "what he must hand over" and "what he is owed
 * back" are different questions and showing only one is how a courier and a shop end up arguing.
 */

function legLabel(uzs, usd) {
  const parts = [];
  if (Number(uzs) > 0) parts.push(formatDisplayAmount(Number(uzs), 'UZS'));
  if (Number(usd) > 0) parts.push(formatDisplayAmount(Number(usd), 'USD'));
  return parts.length ? parts.join(' + ') : '—';
}

function Card({ title, value, sub, rows, t, tone }) {
  const [open, setOpen] = useState(false);
  const hasRows = Array.isArray(rows) && rows.length > 0;
  return (
    <div className={`courier-account-card${tone ? ` courier-account-card--${tone}` : ''}`}>
      <div className="courier-account-card__title">{title}</div>
      <div className="courier-account-card__value">{value}</div>
      {sub ? <div className="courier-account-card__sub">{sub}</div> : null}
      {hasRows && (
        <button type="button" className="courier-account-card__toggle" onClick={() => setOpen((v) => !v)}>
          {open ? t('account.hideRows') : t('account.showRows', { count: rows.length })}
        </button>
      )}
      {open && hasRows && (
        <ul className="courier-account-card__rows">
          {rows.map((r, i) => (
            <li key={r.sale_id ?? r.payable_id ?? i}>
              {r.sale_id ? t('account.saleRef', { id: r.sale_id }) : `#${r.payable_id}`}
              {r.product ? ` · ${r.product}` : ''}
              {r.customer ? ` · ${r.customer}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CourierAccountBand({ account, t }) {
  if (!account) return null;
  const {
    goods_out: out,
    goods_coming_back: back,
    cash_held: cash,
    owed_change: owedChange,
    owed_fee: owedFee,
  } = account;

  const ownChange = cash?.own_change || {};
  const hasOwnChange = Number(ownChange.uzs) > 0 || Number(ownChange.usd) > 0;

  return (
    <div className="form-card courier-account" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{t('account.title')}</h3>
      <div className="courier-account__grid">
        <Card
          title={t('account.goodsOut')}
          value={t('account.itemsWithCost', {
            count: out?.count ?? 0,
            amount: formatDisplayAmount(out?.cost_usd ?? 0, 'USD'),
          })}
          rows={out?.rows}
          t={t}
        />
        <Card
          title={t('account.goodsComingBack')}
          value={t('account.itemsWithCost', {
            count: back?.count ?? 0,
            amount: formatDisplayAmount(back?.cost_usd ?? 0, 'USD'),
          })}
          rows={back?.rows}
          t={t}
          tone={back?.count > 0 ? 'warn' : undefined}
        />
        <Card
          title={t('account.cashHeld')}
          value={legLabel(cash?.uzs, cash?.usd)}
          sub={
            hasOwnChange
              ? t('account.ofWhichHisOwn', { amount: legLabel(ownChange.uzs, ownChange.usd) })
              : null
          }
          rows={cash?.rows}
          t={t}
          tone={cash?.count > 0 ? 'info' : undefined}
        />
        <Card
          title={t('account.owedChange')}
          value={legLabel(owedChange?.uzs, owedChange?.usd)}
          rows={owedChange?.rows}
          t={t}
          tone={owedChange?.count > 0 ? 'debt' : undefined}
        />
        <Card
          title={t('account.owedFee')}
          value={legLabel(owedFee?.uzs, owedFee?.usd)}
          rows={owedFee?.rows}
          t={t}
          tone={owedFee?.count > 0 ? 'debt' : undefined}
        />
      </div>
    </div>
  );
}
