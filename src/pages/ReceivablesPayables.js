import Modal from '../components/Modal';
import React, { useState, useEffect, useMemo } from 'react';
import { Trans } from 'react-i18next';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import {
  sumAmountsByCurrency,
  formatMultiCurrencyAmounts,
} from '../utils/tableTotals';
import { formatDisplayAmount } from '../utils/currencyFormat';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { dateOnlyToLocalDate, formatAppDate, formatAppDateTime } from '../utils/localeFormat';
import './TablePage.css';
import SortableTh from '../components/SortableTh';
import { useClientTableSort } from '../utils/tableSort';
import { usePermissions } from '../hooks/usePermissions';
import AmountInput from '../components/AmountInput';
import FilterPanel from '../components/FilterPanel';
import BusyForm, { SubmitButton } from '../components/BusyForm';
import ActionButton from '../components/ActionButton';

/** Pending receivable — sale on-credit remainder or manual other income. */
function canCollectReceivable(receivable) {
  if (!receivable || receivable.status !== 'pending') return false;
  if (receivable.finance_record) return true;
  const sd = receivable.sale_detail;
  return !!(sd && sd.status === 'completed');
}

function receivableDispatchLabel(saleDetail, t) {
  const d = saleDetail?.dispatch_info;
  if (!d) return '—';
  if (d.dispatch_type === 'bts') {
    return d.dispatcher_name ? t('dispatch.btsNamed', { name: d.dispatcher_name }) : t('dispatch.bts');
  }
  if (d.dispatch_type === 'dostavshik') {
    return d.dispatcher_name ? t('dispatch.dostavshikNamed', { name: d.dispatcher_name }) : t('dispatch.dostavshik');
  }
  return d.dispatcher_name || d.dispatch_type || '—';
}

function payableCustomerName(p) {
  if (p.order_detail?.customer_detail?.name) return p.order_detail.customer_detail.name;
  if (p.dispatch_detail?.sale_detail?.customer_detail?.name) {
    return p.dispatch_detail.sale_detail.customer_detail.name;
  }
  if (p.return_refund_detail?.customer_name) return p.return_refund_detail.customer_name;
  if (p.delivery_change_detail?.customer_name) return p.delivery_change_detail.customer_name;
  return '—';
}

function isCustomerDepositPayable(p) {
  return p?.record_kind === 'customer_deposit';
}

/** Open Kreditorlik: supplier/courier AP (pending) plus customer prepayments (prepaid). */
function isOpenPayable(p) {
  return p?.status === 'pending' || isCustomerDepositPayable(p);
}

/** Stable code for a payable's type — what the Kreditorlik turi filter and the sort agree on.
 *  Deliberately the same order of checks as `payableKind` below, which renders the label. */
export function payableKindCode(p) {
  if (isCustomerDepositPayable(p)) return 'customerdeposit';
  if (p.order) return 'supplier';
  if (p.dispatch) return 'dispatch';
  if (p.package_history) return 'package';
  if (p.return_refund) return 'returnrefund';
  if (p.delivery_change_sale) return 'courierchange';
  if (p.finance_record) return 'finance';
  return '';
}

export const PAYABLE_KIND_OPTIONS = [
  { value: 'supplier', labelKey: 'payableKinds.supplier' },
  { value: 'dispatch', labelKey: 'payableKinds.dispatch' },
  { value: 'package', labelKey: 'payableKinds.package' },
  { value: 'returnrefund', labelKey: 'payableKinds.returnRefund' },
  { value: 'courierchange', labelKey: 'payableKinds.courierChange' },
  { value: 'finance', labelKey: 'payableKinds.otherExpense' },
  { value: 'customerdeposit', labelKey: 'payableKinds.customerDeposit' },
];

function payableKind(p, t) {
  if (isCustomerDepositPayable(p)) {
    return {
      kind: t('payableKinds.customerDeposit'),
      ref: t('payableRefs.order', { id: p.order_detail?.id || p.order || '—' }),
    };
  }
  if (p.order) return { kind: t('payableKinds.supplier'), ref: t('payableRefs.order', { id: p.order }) };
  if (p.dispatch) {
    return {
      kind: t('payableKinds.dispatch'),
      ref: t('payableRefs.dispatch', { dispatch: p.dispatch, sale: p.dispatch_detail?.sale || '—' }),
    };
  }
  if (p.package_history) {
    return { kind: t('payableKinds.package'), ref: t('payableRefs.packageHistory', { id: p.package_history }) };
  }
  if (p.return_refund) {
    return {
      kind: t('payableKinds.returnRefund'),
      ref: t('payableRefs.returnRefund', {
        id: p.return_refund,
        sale: p.return_refund_detail?.sale_id || '—',
      }),
    };
  }
  if (p.delivery_change_sale) {
    return {
      kind: t('payableKinds.courierChange'),
      ref: t('payableRefs.courierChange', { sale: p.delivery_change_sale }),
    };
  }
  if (p.finance_record) {
    return { kind: t('payableKinds.otherExpense'), ref: t('payableRefs.finance', { id: p.finance_record }) };
  }
  return { kind: '—', ref: '—' };
}

function formatMoneyAmount(amount, currency) {
  const n = parseFloat(amount) || 0;
  const ccy = String(currency || 'USD').toUpperCase();
  if (ccy === 'UZS') return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} UZS`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * What a payable owes, as {uzs, usd}.
 *
 * A customer refund can be owed in both currencies at once, because the sale it reverses was
 * paid in both. Supplier, cargo, package and fixed-asset obligations are always single-currency
 * and carry it in amount/currency, so both shapes are read here rather than at each call site.
 */
function payableLegs(p) {
  const uzs = parseFloat(p?.amount_uzs) || 0;
  const usd = parseFloat(p?.amount_usd) || 0;
  if (uzs > 0 || usd > 0) return { uzs, usd };
  const amount = parseFloat(p?.amount) || 0;
  return String(p?.currency || 'USD').toUpperCase() === 'UZS'
    ? { uzs: amount, usd: 0 }
    : { uzs: 0, usd: amount };
}

function formatPayableAmount(p) {
  const { uzs, usd } = payableLegs(p);
  const parts = [];
  if (uzs > 0) parts.push(formatMoneyAmount(uzs, 'UZS'));
  if (usd > 0) parts.push(formatMoneyAmount(usd, 'USD'));
  return parts.length ? parts.join(' + ') : formatMoneyAmount(0, p?.currency);
}

function payableCurrencyLabel(p, uzsLabel, usdLabel) {
  const { uzs, usd } = payableLegs(p);
  if (uzs > 0 && usd > 0) return `${uzsLabel} + ${usdLabel}`;
  return uzs > 0 ? uzsLabel : usdLabel;
}

function receivableCustomerName(rcv) {
  return rcv.sale_detail?.customer_detail?.name || '—';
}

/** Open means the shop is still expecting the money. Everything else is history. */
function isOpenReceivable(rcv) {
  return rcv?.status === 'pending' || rcv?.status === 'overdue';
}

/**
 * When this debt was promised, as a plain `YYYY-MM-DD`, or null.
 *
 * Two sources for one date. `Receivable.due_date` is the field that means it, and it is what
 * the balance sheet side of the feature writes; `sale_detail.credit_due_date` is the same
 * promise recorded on the sale, and it is the fallback for rows written before the receivable
 * carried the date at all. Preferring the receivable keeps one answer per row.
 */
export function receivableDueDate(rcv) {
  const raw = rcv?.due_date || rcv?.sale_detail?.credit_due_date;
  // Sliced off the front of the string rather than parsed through `Date`. The server stores
  // the promise at midnight in the project's own timezone and serializes it there, so the
  // first ten characters *are* the day the customer named. Parsing and re-reading it in the
  // browser's zone would move that day by one whenever the two disagree, which is how a debt
  // due on the 1st starts reading as due on the 31st.
  return raw ? String(raw).slice(0, 10) : null;
}

/** Whole days from today until the debt falls due. Negative once past it; null with no date. */
export function receivableDaysUntilDue(rcv, today = new Date()) {
  const due = receivableDueDate(rcv);
  if (!due) return null;
  const dueMidnight = dateOnlyToLocalDate(due);
  if (!dueMidnight) return null;
  // Both sides floored to local midnight, so "days" counts calendar days rather than a
  // fraction of one — otherwise a debt due tomorrow reads as 0 days from mid-afternoon.
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((dueMidnight - todayMidnight) / 86400000);
}

/**
 * How near the due date is, as a colour. The scale the owner asked for.
 *
 * Settled is green, comfortably ahead is left plain, the last ten days are amber, and past due
 * is red. Ten days is the shop's own horizon for chasing. Pure, so it can be tested and reused;
 * `CreditSales.creditRowBackground` is the same scale keyed off that page's own fields.
 */
export function receivableRowBackground(rcv, today = new Date()) {
  if (!rcv) return undefined;
  if (rcv.status === 'paid') return '#d4edda';
  if (rcv.status === 'cancelled') return '#e2e3e5';
  const days = receivableDaysUntilDue(rcv, today);
  // No date is not the same as no urgency — it is a row nobody promised anything about, and
  // colouring it would say something the record does not.
  if (days == null) return undefined;
  if (days < 0) return '#f8d7da';
  if (days <= 10) return '#fff3cd';
  return undefined;
}

/**
 * One row per customer, carrying their debts.
 *
 * Grouped by customer *name* rather than id because a receivable can hang off a manual finance
 * record with no customer behind it at all; those collect under one "—" heading instead of
 * each becoming a group of one. Currencies are kept apart inside each group: this page has no
 * exchange rate, and two debts in different money do not add up to a number anyone is owed.
 */
export function groupReceivablesByCustomer(rows) {
  const groups = new Map();
  for (const rcv of rows) {
    const name = receivableCustomerName(rcv);
    if (!groups.has(name)) {
      groups.set(name, { name, rows: [], openTotals: {}, openCount: 0, soonestDays: null });
    }
    const group = groups.get(name);
    group.rows.push(rcv);
    if (!isOpenReceivable(rcv)) continue;
    group.openCount += 1;
    const ccy = String(rcv.currency || rcv.sale_detail?.sale_currency || 'USD').toUpperCase();
    group.openTotals[ccy] = (group.openTotals[ccy] || 0) + (parseFloat(rcv.amount) || 0);
    const days = receivableDaysUntilDue(rcv);
    // The group takes the colour of its most urgent open debt, so a customer with one overdue
    // item reads as overdue even when their other debts are months away.
    if (days != null && (group.soonestDays == null || days < group.soonestDays)) {
      group.soonestDays = days;
    }
  }
  return [...groups.values()];
}

/** The group header's colour, from the same scale as a single row. */
export function groupRowBackground(group) {
  if (!group || group.openCount === 0) return '#d4edda';
  if (group.soonestDays == null) return undefined;
  if (group.soonestDays < 0) return '#f8d7da';
  if (group.soonestDays <= 10) return '#fff3cd';
  return undefined;
}

function payableContext(p, tr) {
  if (isCustomerDepositPayable(p)) {
    return tr('payableContext.customerDeposit');
  }
  if (p.dispatch) {
    const d = p.dispatch_detail;
    if (!d) return '—';
    if (d.dispatch_type === 'bts') {
      return d.dispatcher_detail?.name ? tr('dispatch.btsNamed', { name: d.dispatcher_detail.name }) : tr('dispatch.bts');
    }
    if (d.dispatch_type === 'dostavshik') {
      return d.dispatcher_detail?.name
        ? tr('dispatch.dostavshikNamed', { name: d.dispatcher_detail.name })
        : tr('dispatch.dostavshik');
    }
    return d.dispatcher_detail?.name || d.dispatch_type || '—';
  }
  if (p.order) {
    const parts = [];
    if (p.order_detail?.order_type === 'on_demand') {
      parts.push(tr('payableContext.onDemandSupplier'));
    } else if (p.order_detail?.order_type === 'stock') {
      parts.push(tr('payableContext.stockOrder'));
    }
    return parts.join(' · ');
  }
  if (p.package_history_detail?.package_detail) {
    const pkgType = p.package_history_detail.package_detail.package_type;
    return pkgType ? tr('payableContext.packageType', { type: pkgType }) : tr('payableContext.packagePurchase');
  }
  if (p.return_refund) return tr('payableContext.returnRefund');
  if (p.delivery_change_sale) {
    const name = p.delivery_change_detail?.courier_name;
    return name
      ? tr('payableContext.courierChangeNamed', { name })
      : tr('payableContext.courierChange');
  }
  return '—';
}

function receivableSaleProductKey(sd) {
  if (!sd?.product_detail) return '';
  const p = sd.product_detail;
  return `${p.brand || ''} ${p.model || ''}`.trim().toLowerCase();
}

const RECEIVABLE_TABLE_SORT_ACCESSORS = {
  id: (rcv) => Number(rcv.id) || 0,
  customer: (rcv) => receivableCustomerName(rcv).toLowerCase(),
  sale: (rcv) => Number(rcv.sale) || 0,
  product: (rcv) => receivableSaleProductKey(rcv.sale_detail),
  sale_type: (rcv) => String(rcv.sale_detail?.sale_type ?? '').toLowerCase(),
  from_order: (rcv) => Number(rcv.sale_detail?.order) || 0,
  dispatch: (rcv) => (rcv.sale_detail?.dispatch_info?.dispatch_type || '').toLowerCase(),
  amount: (rcv) => parseFloat(rcv.amount) || 0,
  currency: (rcv) => String(rcv.currency ?? rcv.sale_detail?.sale_currency ?? '').toLowerCase(),
  // Undated debts sort last rather than first: a row nobody promised anything about is not the
  // most urgent thing on the page.
  due_date: (rcv) => receivableDueDate(rcv) ?? '9999-12-31',
  status: (rcv) => String(rcv.status ?? '').toLowerCase(),
  created_at: (rcv) => new Date(rcv.created_at).getTime() || 0,
  paid_date: (rcv) => {
    const d = rcv.paid_date;
    return d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
  },
};

function payableProductSortKey(p) {
  const od = p.order_detail?.product_detail;
  if (od) return `${od.brand || ''} ${od.model || ''}`.trim().toLowerCase();
  const sd = p.dispatch_detail?.sale_detail?.product_detail;
  if (sd) return `${sd.brand || ''} ${sd.model || ''}`.trim().toLowerCase();
  const pkg = p.package_history_detail?.package_detail?.package_type;
  if (pkg) return String(pkg).toLowerCase();
  return '';
}

const PAYABLE_TABLE_SORT_ACCESSORS = {
  id: (p) =>
    isCustomerDepositPayable(p)
      ? -(Number(p.order_detail?.id) || 0)
      : Number(p.id) || 0,
  payable_kind: (p) => payableKindCode(p),
  ref: (p) => String(p.order || p.dispatch || p.package_history || p.finance_record || '').toLowerCase(),
  customer: (p) => payableCustomerName(p).toLowerCase(),
  product: (p) => payableProductSortKey(p),
  context: (p) => String(p.order_detail?.order_type || p.dispatch_detail?.dispatch_type || '').toLowerCase(),
  // Sorted within a currency, as before — the column mixes so'm and dollar rows either way, and
  // this page has no exchange rate to compare them with. A cross-currency refund sorts on its
  // dollar leg rather than on whichever half happened to land in `amount`.
  amount: (p) => {
    const { uzs, usd } = payableLegs(p);
    return usd > 0 ? usd : uzs;
  },
  currency: (p) => {
    const { uzs, usd } = payableLegs(p);
    if (uzs > 0 && usd > 0) return 'uzs+usd';
    return uzs > 0 ? 'uzs' : 'usd';
  },
  status: (p) => String(p.status ?? '').toLowerCase(),
  created_at: (p) => new Date(p.created_at).getTime() || 0,
  paid_date: (p) => {
    const d = p.paid_date;
    return d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
  },
};

const ReceivablesPayables = () => {
  const { t, tStatus, monthOptions } = useAppTranslation(['receivables', 'common', 'status']);
  const uzsLabel = t('currency.uzs', { ns: 'common' });
  const usdLabel = t('currency.usd', { ns: 'common' });
  const { hasPermission } = usePermissions();
  const canCollect = hasPermission('receivables.collect');
  const canRefundDeposit = hasPermission('payables.refund_deposit');
  const canPayDispatchFee = hasPermission('payables.pay_dispatch_fee');
  const canCancelDispatchFee = hasPermission('payables.cancel_dispatch_fee');
  const [activeTab, setActiveTab] = useState('receivables');
  const [receivables, setReceivables] = useState([]);
  const [payables, setPayables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collectTarget, setCollectTarget] = useState(null);
  const [collectForm, setCollectForm] = useState({
    amount: '',
    notes: '',
  });
  const [filter, setFilter] = useState({
    status: '',
    currency: '',
    year: '',
    month: '',
    kind: '',
    // Debitorlik's own view controls. `scope` is browser-side rather than another API filter:
    // the backend's `status` parameter already narrows the fetch, and stacking a second server
    // filter on top of it would make "Barchasi" mean two different things depending on which
    // one was set last.
    scope: 'open',
    grouped: true,
  });
  const [expandedCustomers, setExpandedCustomers] = useState(() => new Set());
  const [settlingCustomer, setSettlingCustomer] = useState(null);

  useEffect(() => {
    setLoading(true);
    if (activeTab === 'receivables') {
      fetchReceivables();
    } else {
      fetchPayables();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, activeTab]);

  const fetchReceivables = async () => {
    try {
      let url = '/receivables/';
      const params = new URLSearchParams();
      // By default, backend only returns pending, but allow override
      if (filter.status) params.append('status', filter.status);
      
      // Convert year/month to date range
      if (filter.year || filter.month) {
        let dateFrom, dateTo;
        if (filter.year && filter.month) {
          dateFrom = `${filter.year}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(parseInt(filter.year), parseInt(filter.month), 0).getDate();
          dateTo = `${filter.year}-${filter.month.padStart(2, '0')}-${lastDay}`;
        } else if (filter.year) {
          dateFrom = `${filter.year}-01-01`;
          dateTo = `${filter.year}-12-31`;
        } else if (filter.month) {
          const currentYear = new Date().getFullYear();
          dateFrom = `${currentYear}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(currentYear, parseInt(filter.month), 0).getDate();
          dateTo = `${currentYear}-${filter.month.padStart(2, '0')}-${lastDay}`;
        }
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
      }
      
      if (params.toString()) url += `?${params.toString()}`;

      const response = await apiGetAll(url);
      setReceivables(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching receivables:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPayables = async () => {
    try {
      let url = '/payables/';
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      
      // Convert year/month to date range
      if (filter.year || filter.month) {
        let dateFrom, dateTo;
        if (filter.year && filter.month) {
          dateFrom = `${filter.year}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(parseInt(filter.year), parseInt(filter.month), 0).getDate();
          dateTo = `${filter.year}-${filter.month.padStart(2, '0')}-${lastDay}`;
        } else if (filter.year) {
          dateFrom = `${filter.year}-01-01`;
          dateTo = `${filter.year}-12-31`;
        } else if (filter.month) {
          const currentYear = new Date().getFullYear();
          dateFrom = `${currentYear}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(currentYear, parseInt(filter.month), 0).getDate();
          dateTo = `${currentYear}-${filter.month.padStart(2, '0')}-${lastDay}`;
        }
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
      }
      
      if (params.toString()) url += `?${params.toString()}`;

      const response = await apiGetAll(url);
      setPayables(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching payables:', error);
    } finally {
      setLoading(false);
    }
  };

  const beginCollectReceivable = (receivable) => {
    setCollectTarget(receivable);
    const ccy = String(receivable.currency || receivable.sale_detail?.sale_currency || 'USD').toUpperCase();
    const rem = parseFloat(receivable.amount) || 0;
    const defAmount =
      rem > 0 ? (ccy === 'UZS' ? String(Math.round(rem)) : rem.toFixed(2)) : '';
    setCollectForm({
      amount: defAmount,
      notes: '',
    });
  };

  // Used by Cancel and by the dialog's own X and Esc, so all three leave the same clean slate.
  const closeCollectForm = () => {
    setCollectTarget(null);
    setCollectForm({ amount: '', notes: '' });
  };

  const handleCollectReceivableSubmit = async (e) => {
    e.preventDefault();
    if (!collectTarget) return;
    const ccy = String(collectTarget.currency || collectTarget.sale_detail?.sale_currency || 'USD').toUpperCase();
    const pay = parseFloat(collectForm.amount) || 0;
    const rem = parseFloat(collectTarget.amount) || 0;
    const tol = 0.02;

    if (pay <= 0) {
      alert(t('notifications.amountRequired'));
      return;
    }
    if (pay > rem + tol) {
      alert(t('notifications.amountExceeds', { balance: formatDisplayAmount(rem, ccy) }));
      return;
    }

    const uzs_cash = ccy === 'UZS' ? pay : 0;
    const usd_cash = ccy === 'USD' ? pay : 0;

    try {
      let res;
      if (collectTarget.finance_record) {
        res = await api.post(`/finance/${collectTarget.finance_record}/settle/`);
      } else {
        res = await api.post(`/receivables/${collectTarget.id}/collect_payment/`, {
          uzs_cash,
          uzs_card: 0,
          usd_cash,
          usd_card: 0,
          notes: String(collectForm.notes || '').trim(),
        });
      }
      alert(res.data?.message || t('notifications.paymentRecorded'));
      setCollectTarget(null);
      setCollectForm({
        amount: '',
        notes: '',
      });
      await fetchReceivables();
    } catch (error) {
      console.error('Error collecting receivable:', error);
      const d = error.response?.data;
      const msg =
        d?.detail ||
        d?.error ||
        (typeof d?.detail === 'string' ? d.detail : null) ||
        (Array.isArray(d) ? d[0] : null) ||
        (typeof d === 'object' && d !== null
          ? Object.entries(d)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : String(v)}`)
              .join(' ')
          : null) ||
        t('notifications.paymentFailed');
      alert(Array.isArray(msg) ? msg[0] : msg);
    }
  };

  const handleSettleManualPayable = async (payable) => {
    const frId = payable.finance_record;
    if (!frId) return;
    if (!window.confirm(t('notifications.confirmSettlePayable'))) return;
    try {
      const res = await api.post(`/finance/${frId}/settle/`);
      alert(res.data?.message || t('notifications.paid'));
      fetchPayables();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.error || t('notifications.settleFailed'));
    }
  };

  const handleRefundCustomerDeposit = async (payable) => {
    const orderId = payable.order_detail?.id || payable.order;
    if (!orderId) return;
    if (!window.confirm(t('notifications.confirmRefundDeposit'))) return;
    try {
      const res = await api.post('/payables/refund_customer_deposit/', { order_id: orderId });
      alert(res.data?.message || t('notifications.depositRefunded'));
      fetchPayables();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.error || t('notifications.refundDepositFailed'));
    }
  };

  // A cancelled sale keeps its courier fee: the trip happened, so it is still owed or waived.
  // A courier fee the delivery settlement steps can no longer reach. Those steps are gated on
  // the sale being `dispatched`, so anything past that status has nowhere else to be paid from
  // — cancelled *or* completed. Gating this on `cancelled` alone left a completed sale's unpaid
  // fee showing here with no action beside it.
  const isStrandedDispatchFee = (payable) =>
    !!payable.dispatch &&
    payable.status === 'pending' &&
    payable.dispatch_detail?.sale_detail?.status !== 'dispatched';

  const handleDispatchFeeAction = async (payable, endpoint, confirmKey, failKey) => {
    if (!window.confirm(t(confirmKey))) return;
    try {
      const res = await api.post(`/payables/${payable.id}/${endpoint}/`);
      alert(res.data?.message || t('notifications.paid'));
      fetchPayables();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.error || t(failKey));
    }
  };

  // Everything below reads `visibleReceivables`, never `receivables`. The tab used to render
  // the raw list while only the payables side had a filter, so a figure under the table could
  // count rows the table was not showing.
  const visibleReceivables = useMemo(
    () => (filter.scope === 'open' ? receivables.filter(isOpenReceivable) : receivables),
    [receivables, filter.scope],
  );

  const receivableAmountTotals = useMemo(
    () => sumAmountsByCurrency(visibleReceivables.filter((r) => r.status === 'pending')),
    [visibleReceivables]
  );
  const payableAmountTotals = useMemo(
    () => sumAmountsByCurrency(payables),
    [payables]
  );
  // Kreditorlik turi is filtered in the browser, not by the API: the type is derived from
  // which foreign key the row carries, and the customer-deposit rows are synthesized here in
  // the first place, so there is nothing for the server to filter on.
  const visiblePayables = useMemo(
    () => (filter.kind ? payables.filter((p) => payableKindCode(p) === filter.kind) : payables),
    [payables, filter.kind],
  );

  // Totals follow the filter, so the figures under the table always add up the rows above it.
  const customerDepositPayableTotals = useMemo(
    () => sumAmountsByCurrency(visiblePayables.filter((p) => isCustomerDepositPayable(p))),
    [visiblePayables]
  );
  const supplierPayableTotals = useMemo(
    () => sumAmountsByCurrency(visiblePayables.filter((p) => !isCustomerDepositPayable(p) && p.status === 'pending')),
    [visiblePayables]
  );
  const receivablePendingByCurrency = useMemo(
    () => sumAmountsByCurrency(visibleReceivables.filter((r) => r.status === 'pending')),
    [visibleReceivables]
  );
  const payablePendingByCurrency = useMemo(
    () => sumAmountsByCurrency(visiblePayables.filter((p) => isOpenPayable(p))),
    [visiblePayables]
  );

  const receivablesSort = useClientTableSort(RECEIVABLE_TABLE_SORT_ACCESSORS);
  const sortedReceivableRows = useMemo(
    () => receivablesSort.sortRows(visibleReceivables || []),
    [visibleReceivables, receivablesSort],
  );
  const receivableGroups = useMemo(
    () => groupReceivablesByCustomer(sortedReceivableRows),
    [sortedReceivableRows],
  );

  const payablesTableSort = useClientTableSort(PAYABLE_TABLE_SORT_ACCESSORS);
  const sortedPayableRows = useMemo(
    () => payablesTableSort.sortRows(visiblePayables || []),
    [visiblePayables, payablesTableSort],
  );

  const toggleCustomer = (name) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const formatGroupTotals = (group) => {
    const parts = Object.entries(group.openTotals)
      .filter(([, amount]) => amount > 0)
      .map(([ccy, amount]) => formatMoneyAmount(amount, ccy));
    return parts.length ? parts.join(' + ') : '—';
  };

  const dueLabelFor = (days, date) => {
    if (!date) return '—';
    const shown = formatAppDate(dateOnlyToLocalDate(date));
    if (days == null) return shown;
    if (days < 0) return `${shown} · ${t('receivablesTable.overdueBy', { days: Math.abs(days) })}`;
    if (days === 0) return `${shown} · ${t('receivablesTable.dueToday')}`;
    return `${shown} · ${t('receivablesTable.dueInDays', { days })}`;
  };

  const groupDueLabel = (group) => {
    if (group.soonestDays == null) return '—';
    const soonest = group.rows
      .filter((r) => isOpenReceivable(r) && receivableDaysUntilDue(r) === group.soonestDays)
      .map(receivableDueDate)[0];
    return dueLabelFor(group.soonestDays, soonest);
  };

  /**
   * Settle every open debt this customer has, one request each.
   *
   * Sequential rather than parallel, and it keeps going after a failure: each receivable is its
   * own cash movement, so a row that will not collect must not silently prevent the rows behind
   * it from being collected. What actually happened is reported at the end rather than guessed.
   */
  const handleSettleCustomer = async (group) => {
    const collectible = group.rows.filter((r) => canCollectReceivable(r) && isOpenReceivable(r));
    if (!collectible.length) return;
    if (
      !window.confirm(
        t('notifications.confirmSettleCustomer', {
          count: collectible.length,
          customer: group.name,
          amount: formatGroupTotals(group),
        }),
      )
    ) {
      return;
    }
    setSettlingCustomer(group.name);
    let done = 0;
    const failures = [];
    try {
      for (const rcv of collectible) {
        const ccy = String(rcv.currency || rcv.sale_detail?.sale_currency || 'USD').toUpperCase();
        const amount = parseFloat(rcv.amount) || 0;
        if (amount <= 0) continue;
        try {
          if (rcv.finance_record) {
            await api.post(`/finance/${rcv.finance_record}/settle/`);
          } else {
            await api.post(`/receivables/${rcv.id}/collect_payment/`, {
              uzs_cash: ccy === 'UZS' ? amount : 0,
              uzs_card: 0,
              usd_cash: ccy === 'USD' ? amount : 0,
              usd_card: 0,
              notes: '',
            });
          }
          done += 1;
        } catch (error) {
          console.error('Error settling receivable', rcv.id, error);
          failures.push(`#${rcv.id}: ${error.response?.data?.error || error.response?.data?.detail || ''}`);
        }
      }
    } finally {
      setSettlingCustomer(null);
      await fetchReceivables();
    }
    alert(
      failures.length
        ? t('notifications.settleCustomerPartial', {
          done,
          total: collectible.length,
          errors: failures.join('; '),
        })
        : t('notifications.settleCustomerDone', { done, customer: group.name }),
    );
  };

  /** One receivable row. Shared by the flat list and the expanded groups, so the two can
   *  never drift into showing different columns for the same record. */
  const receivableRow = (receivable) => {
    const sd = receivable.sale_detail;
    const days = receivableDaysUntilDue(receivable);
    return (
      <tr key={receivable.id} style={{ backgroundColor: receivableRowBackground(receivable) }}>
        <td>#{receivable.id}</td>
        <td>{receivableCustomerName(receivable)}</td>
        <td>
          {receivable.sale
            ? t('receivablesTable.saleRef', { id: receivable.sale })
            : receivable.finance_record
              ? t('receivablesTable.financeRef', { id: receivable.finance_record })
              : '—'}
        </td>
        <td>
          {sd?.product_detail ? `${sd.product_detail.brand} ${sd.product_detail.model}` : '—'}
        </td>
        <td>
          {sd?.sale_type ? t(`saleTypes.${sd.sale_type}`, { defaultValue: sd.sale_type }) : '—'}
        </td>
        <td>{sd?.order ? <span>{t('receivablesTable.orderRef', { id: sd.order })}</span> : '—'}</td>
        <td
          style={{ fontSize: '0.9rem', maxWidth: '200px' }}
          title={sd?.dispatch_info?.logistics_notes || undefined}
        >
          {receivableDispatchLabel(sd, t)}
        </td>
        <td style={{ fontWeight: '600', color: '#28a745' }}>
          {parseFloat(receivable.amount).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </td>
        <td>{receivable.currency === 'UZS' ? uzsLabel : usdLabel}</td>
        <td>{dueLabelFor(days, receivableDueDate(receivable))}</td>
        <td>
          <span className={`status-badge ${receivable.status}`}>
            {tStatus(receivable.status, 'receivable')}
          </span>
        </td>
        <td>{formatAppDateTime(receivable.created_at)}</td>
        <td>{receivable.paid_date ? formatAppDateTime(receivable.paid_date) : '—'}</td>
        <td>
          {canCollectReceivable(receivable) && canCollect ? (
            <button
              type="button"
              className="btn-edit"
              onClick={() => beginCollectReceivable(receivable)}
            >
              {t('receivablesTable.collect')}
            </button>
          ) : (
            '—'
          )}
        </td>
      </tr>
    );
  };

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="receivables" />
      </div>

      <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9em', maxWidth: 720 }}>
        {t('intro')}
      </p>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0' }}>
        <button
          onClick={() => setActiveTab('receivables')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: activeTab === 'receivables' ? '#28a745' : 'transparent',
            color: activeTab === 'receivables' ? 'white' : '#666',
            cursor: 'pointer',
            borderBottom: activeTab === 'receivables' ? '3px solid #28a745' : '3px solid transparent',
            fontWeight: activeTab === 'receivables' ? '600' : '400',
          }}
        >
          {t('tabs.receivables')}
        </button>
        <button
          onClick={() => setActiveTab('payables')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: activeTab === 'payables' ? '#dc3545' : 'transparent',
            color: activeTab === 'payables' ? 'white' : '#666',
            cursor: 'pointer',
            borderBottom: activeTab === 'payables' ? '3px solid #dc3545' : '3px solid transparent',
            fontWeight: activeTab === 'payables' ? '600' : '400',
          }}
        >
          {t('tabs.payables')}
        </button>
      </div>

      {/* Receivables Summary (by currency; do not mix UZS and USD in one number) */}
      {activeTab === 'receivables' && (
        <div className="metrics-grid" style={{ marginBottom: '20px' }}>
          <div className="metric-card" style={{ border: '2px solid #28a745' }}>
            <div className="metric-label">{t('metrics.recvPendingUsd')}</div>
            <div className="metric-value" style={{ color: '#28a745', fontSize: '1.75em' }}>
              {(receivablePendingByCurrency.USD || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {usdLabel}
            </div>
          </div>
          <div className="metric-card" style={{ border: '2px solid #28a745' }}>
            <div className="metric-label">{t('metrics.recvPendingUzs')}</div>
            <div className="metric-value" style={{ color: '#28a745', fontSize: '1.75em' }}>
              {(receivablePendingByCurrency.UZS || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {uzsLabel}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.recvAllUsd')}</div>
            <div className="metric-value">
              {(receivableAmountTotals.USD || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {usdLabel}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.recvAllUzs')}</div>
            <div className="metric-value">
              {(receivableAmountTotals.UZS || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {uzsLabel}
            </div>
          </div>
        </div>
      )}

      {/* Payables Summary (by currency) */}
      {activeTab === 'payables' && (
        <div className="metrics-grid" style={{ marginBottom: '20px' }}>
          <div className="metric-card" style={{ border: '2px solid #dc3545' }}>
            <div className="metric-label">{t('metrics.payPendingUsd')}</div>
            <div className="metric-value" style={{ color: '#dc3545', fontSize: '1.75em' }}>
              {(payablePendingByCurrency.USD || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {usdLabel}
            </div>
          </div>
          <div className="metric-card" style={{ border: '2px solid #dc3545' }}>
            <div className="metric-label">{t('metrics.payPendingUzs')}</div>
            <div className="metric-value" style={{ color: '#dc3545', fontSize: '1.75em' }}>
              {(payablePendingByCurrency.UZS || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {uzsLabel}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.payAllUsd')}</div>
            <div className="metric-value">
              {(payableAmountTotals.USD || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {usdLabel}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.payAllUzs')}</div>
            <div className="metric-value">
              {(payableAmountTotals.UZS || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {uzsLabel}
            </div>
          </div>
        </div>
      )}

      <FilterPanel title={t('filters.title')} filters={filter} style={{ marginBottom: '16px' }}>
          <div className="filter-toolbar">
          <div className="filter-field">
              <label>{t('filters.status')}</label>
              <select
                value={filter.status}
                onChange={(e) => setFilter({ ...filter, status: e.target.value })}
              >
                <option value="">{t('filters.pendingDefault')}</option>
                <option value="pending">{tStatus('pending', 'receivable')}</option>
                <option value="paid">{tStatus('paid', 'receivable')}</option>
                <option value="overdue">{tStatus('overdue', 'receivable')}</option>
                <option value="cancelled">{tStatus('cancelled', 'receivable')}</option>
              </select>
            </div>
          {activeTab === 'receivables' && (
            <>
              <div className="filter-field">
                <label>{t('filters.scope')}</label>
                <select
                  value={filter.scope}
                  onChange={(e) => setFilter({ ...filter, scope: e.target.value })}
                >
                  <option value="open">{t('filters.scopeOpen')}</option>
                  <option value="all">{t('filters.scopeAll')}</option>
                </select>
              </div>
              <div className="filter-field">
                <label>{t('filters.grouping')}</label>
                <select
                  value={filter.grouped ? 'grouped' : 'flat'}
                  onChange={(e) => setFilter({ ...filter, grouped: e.target.value === 'grouped' })}
                >
                  <option value="grouped">{t('filters.groupByCustomer')}</option>
                  <option value="flat">{t('filters.flatList')}</option>
                </select>
              </div>
            </>
          )}
          {activeTab === 'payables' && (
            <div className="filter-field">
              <label>{t('filters.payableKind')}</label>
              <select
                value={filter.kind}
                onChange={(e) => setFilter({ ...filter, kind: e.target.value })}
              >
                <option value="">{t('filters.allPayableKinds')}</option>
                {PAYABLE_KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                ))}
              </select>
            </div>
          )}
          <div className="filter-field">
            <label>{t('filters.year')}</label>
            <select
              value={filter.year}
              onChange={(e) => setFilter({ ...filter, year: e.target.value })}
            >
              <option value="">{t('filters.allYears')}</option>
              {Array.from({ length: 10 }, (_, i) => {
                const year = new Date().getFullYear() - i;
                return (
                  <option key={year} value={year.toString()}>
                    {year}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.month')}</label>
            <select
              value={filter.month}
              onChange={(e) => setFilter({ ...filter, month: e.target.value })}
            >
              <option value="">{t('filters.allMonths')}</option>
              {monthOptions.filter((o) => o.value).map((opt) => (
                <option key={opt.value} value={opt.value.padStart(2, '0')}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-toolbar__actions">
            <button
              type="button"
              className="btn-edit"
              onClick={() => setFilter({ status: '', currency: '', year: '', month: '', kind: '' })}
            >
              {t('filters.clearAll')}
            </button>
          </div>
        </div>
      </FilterPanel>

      {/* Receivables Table */}
      {activeTab === 'receivables' && (
        <>
          <Modal
              open={!!collectTarget && canCollect}
              onClose={closeCollectForm}
              closeLabel={t('actions.close', { ns: 'common' })}
              closeOnBackdrop={false}
              title={collectTarget
                ? `${t('collect.title', { id: collectTarget.id })} ${t('collect.saleRef', { sale: collectTarget.sale })}`
                : ''}
            >
              <p style={{ color: '#666', marginBottom: '12px', fontSize: '0.92rem' }}>
                <Trans
                  i18nKey="collect.hint"
                  ns="receivables"
                  values={{
                    amount: parseFloat(collectTarget.amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }),
                    currency: (collectTarget.currency || collectTarget.sale_detail?.sale_currency || 'USD').toUpperCase(),
                  }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <BusyForm onSubmit={handleCollectReceivableSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>
                      {t('collect.amount', {
                        currency: (collectTarget.currency || collectTarget.sale_detail?.sale_currency || 'USD').toUpperCase(),
                      })}
                    </label>
                    <AmountInput
                      placeholder="0"
                      value={collectForm.amount}
                      onChange={(e) => setCollectForm({ ...collectForm, amount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>{t('collect.notesOptional')}</label>
                    <textarea rows={2} value={collectForm.notes} onChange={(e) => setCollectForm({ ...collectForm, notes: e.target.value })} />
                  </div>
                </div>
                <div className="form-actions">
                  <SubmitButton className="btn-primary">{t('collect.record')}</SubmitButton>
                  <button type="button" className="btn-edit" onClick={closeCollectForm}>
                    {t('actions.cancel', { ns: 'common' })}
                  </button>
                </div>
              </BusyForm>
            </Modal>
        <div className="table-card">
          <h2>{t('receivablesTable.title')}</h2>
          <p style={{ color: '#666', fontSize: '0.9em', margin: '0 0 10px' }}>
            {t('receivablesTable.hint')}
          </p>
          <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh columnId="id" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.id')}</SortableTh>
                <SortableTh columnId="customer" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.customer')}</SortableTh>
                <SortableTh columnId="sale" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.sale')}</SortableTh>
                <SortableTh columnId="product" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.product')}</SortableTh>
                <SortableTh columnId="sale_type" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.saleType')}</SortableTh>
                <SortableTh columnId="from_order" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.fromOrder')}</SortableTh>
                <SortableTh columnId="dispatch" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.delivery')}</SortableTh>
                <SortableTh columnId="amount" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.amount')}</SortableTh>
                <SortableTh columnId="currency" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.currency')}</SortableTh>
                <SortableTh columnId="due_date" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.dueDate')}</SortableTh>
                <SortableTh columnId="status" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.status')}</SortableTh>
                <SortableTh columnId="created_at" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.created')}</SortableTh>
                <SortableTh columnId="paid_date" sortCol={receivablesSort.sortCol} sortDir={receivablesSort.sortDir} onSort={receivablesSort.onHeaderClick}>{t('receivablesTable.paidDate')}</SortableTh>
                <th>{t('receivablesTable.action')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedReceivableRows.length === 0 ? (
                <tr>
                  <td colSpan="14" style={{ textAlign: 'center' }}>
                    {t('receivablesTable.noRows')}
                  </td>
                </tr>
              ) : filter.grouped ? (
                receivableGroups.flatMap((group) => {
                  const open = expandedCustomers.has(group.name);
                  const header = (
                    <tr
                      key={`group-${group.name}`}
                      className="sale-group-row"
                      style={{ backgroundColor: groupRowBackground(group), cursor: 'pointer' }}
                      onClick={() => toggleCustomer(group.name)}
                    >
                      <td colSpan="7" style={{ fontWeight: 600 }}>
                        {open ? '▾' : '▸'} {group.name}{' '}
                        <span style={{ fontWeight: 400, color: '#555' }}>
                          {t('receivablesTable.groupCount', {
                            open: group.openCount,
                            total: group.rows.length,
                          })}
                        </span>
                      </td>
                      <td colSpan="2" style={{ fontWeight: 600, color: '#28a745' }}>
                        {formatGroupTotals(group)}
                      </td>
                      <td>{groupDueLabel(group)}</td>
                      <td colSpan="3">—</td>
                      <td>
                        {canCollect && group.openCount > 0 ? (
                          <button
                            type="button"
                            className="btn-edit"
                            disabled={settlingCustomer === group.name}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSettleCustomer(group);
                            }}
                          >
                            {settlingCustomer === group.name
                              ? t('receivablesTable.settling')
                              : t('receivablesTable.settleAll')}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                  return open ? [header, ...group.rows.map(receivableRow)] : [header];
                })
              ) : (
                sortedReceivableRows.map(receivableRow)
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="7" style={{ textAlign: 'right' }}>
                  {t('receivablesTable.footerPending')}
                </td>
                <td style={{ fontWeight: 600, color: '#28a745' }}>
                  {formatMultiCurrencyAmounts(receivableAmountTotals)}
                </td>
                <td colSpan="6">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
          </div>
        </>
      )}

      {/* Payables Table */}
      {activeTab === 'payables' && (
        <div className="table-card">
          <h2>{t('payablesTable.title')}</h2>
          <p style={{ color: '#666', fontSize: '0.9em', margin: '0 0 10px' }}>
            {t('payablesTable.hint')}
          </p>
          <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh columnId="id" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('receivablesTable.id')}</SortableTh>
                <SortableTh columnId="payable_kind" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.payableType')}</SortableTh>
                <SortableTh columnId="ref" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.ref')}</SortableTh>
                <SortableTh columnId="customer" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.customer')}</SortableTh>
                <SortableTh columnId="product" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.product')}</SortableTh>
                <SortableTh columnId="context" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.context')}</SortableTh>
                <SortableTh columnId="amount" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.amount')}</SortableTh>
                <SortableTh columnId="currency" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.currency')}</SortableTh>
                <SortableTh columnId="status" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.status')}</SortableTh>
                <SortableTh columnId="created_at" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.created')}</SortableTh>
                <SortableTh columnId="paid_date" sortCol={payablesTableSort.sortCol} sortDir={payablesTableSort.sortDir} onSort={payablesTableSort.onHeaderClick}>{t('payablesTable.paidDate')}</SortableTh>
                <th>{t('payablesTable.action')}</th>
              </tr>
            </thead>
            <tbody>
              {visiblePayables.length === 0 ? (
                <tr>
                  <td colSpan="12" style={{ textAlign: 'center' }}>
                    {t('payablesTable.noRows')}
                  </td>
                </tr>
              ) : (
                sortedPayableRows.map((payable) => {
                  const { kind, ref } = payableKind(payable, t);
                  const isDeposit = isCustomerDepositPayable(payable);
                  const rowKey = isDeposit ? payable.virtual_id : payable.id;
                  return (
                  <tr key={rowKey} style={isDeposit ? { backgroundColor: '#f8f4ff' } : undefined}>
                    <td>{isDeposit ? `Order #${payable.order_detail?.id}` : `#${payable.id}`}</td>
                    <td>
                        <span
                          className="status-badge"
                          style={{ background: isDeposit ? '#5e35b1' : '#6c757d', fontSize: '0.75rem' }}
                        >
                          {kind}
                        </span>
                    </td>
                      <td style={{ fontSize: '0.9rem' }}>{ref}</td>
                      <td>{payableCustomerName(payable)}</td>
                    <td>
                      {payable.order_detail?.product_detail
                        ? `${payable.order_detail.product_detail.brand} ${payable.order_detail.product_detail.model}`
                        : payable.dispatch_detail?.sale_detail?.product_detail
                        ? `${payable.dispatch_detail.sale_detail.product_detail.brand} ${payable.dispatch_detail.sale_detail.product_detail.model}`
                            : payable.package_history_detail?.package_detail
                              ? t('payablesTable.packagesType', {
                                  type: payable.package_history_detail.package_detail.package_type,
                                })
                              : payable.return_refund_detail?.product_name
                                ? payable.return_refund_detail.product_name
                                : payable.delivery_change_detail?.product_name
                                  ? payable.delivery_change_detail.product_name
                                  : '—'}
                    </td>
                      <td style={{ fontSize: '0.9rem', maxWidth: '220px' }}>{payableContext(payable, t)}</td>
                    <td style={{ fontWeight: '600', color: isDeposit ? '#5e35b1' : '#dc3545' }}>
                      {formatPayableAmount(payable)}
                      {isDeposit && (
                        <div style={{ fontSize: '0.78em', color: '#666', fontWeight: 400 }}>{t('payablesTable.prepaidByCustomer')}</div>
                      )}
                    </td>
                    <td>{payableCurrencyLabel(payable, uzsLabel, usdLabel)}</td>
                    <td>
                      <span className={`status-badge ${payable.status}`}>
                        {isDeposit ? t('payablesTable.prepaidStatus') : tStatus(payable.status, 'payable')}
                      </span>
                    </td>
                    <td>{formatAppDateTime(payable.created_at)}</td>
                    <td>
                      {payable.paid_date
                        ? formatAppDateTime(payable.paid_date)
                          : '—'}
                      </td>
                      <td>
                        {isDeposit && canRefundDeposit ? (
                          <ActionButton
                            type="button"
                            className="btn-edit"
                            onClick={() => handleRefundCustomerDeposit(payable)}
                          >
                            {t('payablesTable.returnDeposit')}
                          </ActionButton>
                        ) : payable.delivery_change_sale && canPayDispatchFee ? (
                          <button
                            type="button"
                            className="btn-edit"
                            onClick={() =>
                              handleDispatchFeeAction(
                                payable,
                                'reimburse_courier_change',
                                'notifications.confirmReimburseCourierChange',
                                'notifications.reimburseCourierChangeFailed'
                              )
                            }
                          >
                            {t('payablesTable.reimburseCourierChange')}
                          </button>
                        ) : isStrandedDispatchFee(payable) &&
                          (canPayDispatchFee || canCancelDispatchFee) ? (
                          <>
                            {canPayDispatchFee && (
                              <button
                                type="button"
                                className="btn-edit"
                                style={{ marginRight: '5px' }}
                                onClick={() =>
                                  handleDispatchFeeAction(
                                    payable,
                                    'pay_dispatch_fee',
                                    'notifications.confirmPayDispatchFee',
                                    'notifications.payDispatchFeeFailed'
                                  )
                                }
                              >
                                {t('payablesTable.payDispatchFee')}
                              </button>
                            )}
                            {canCancelDispatchFee && (
                              <button
                                type="button"
                                className="btn-delete"
                                onClick={() =>
                                  handleDispatchFeeAction(
                                    payable,
                                    'cancel_dispatch_fee',
                                    'notifications.confirmCancelDispatchFee',
                                    'notifications.cancelDispatchFeeFailed'
                                  )
                                }
                              >
                                {t('payablesTable.cancelDispatchFee')}
                              </button>
                            )}
                          </>
                        ) : payable.finance_record && payable.status === 'pending' ? (
                          <ActionButton type="button" className="btn-edit" onClick={() => handleSettleManualPayable(payable)}>
                            {t('payablesTable.pay')}
                          </ActionButton>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="6" style={{ textAlign: 'right' }}>
                  {t('payablesTable.footerSupplier')}
                </td>
                <td style={{ fontWeight: 600, color: '#dc3545' }}>
                  {formatMultiCurrencyAmounts(supplierPayableTotals)}
                </td>
                <td colSpan="5">—</td>
              </tr>
              {(customerDepositPayableTotals.USD > 0 || customerDepositPayableTotals.UZS > 0) && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'right', color: '#666' }}>
                    {t('payablesTable.footerDeposits')}
                  </td>
                  <td style={{ fontWeight: 600, color: '#5e35b1' }}>
                    {formatMultiCurrencyAmounts(customerDepositPayableTotals)}
                  </td>
                  <td colSpan="5">—</td>
                </tr>
              )}
            </tfoot>
          </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReceivablesPayables;
