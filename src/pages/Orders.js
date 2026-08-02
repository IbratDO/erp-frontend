import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { formatDisplayAmount, cashBalanceTotalByCurrency, formatInsufficientLedgerMessage } from '../utils/currencyFormat';
import {
  isOperationalSenior,
  isPurchasingAgent,
  PURCHASING_AGENT_SUPPLIER_COUNTRY,
} from '../utils/permissions';
import { uniqueSupplierCountriesFromOrdersAndProducts } from '../utils/supplierCountries';
import { uniqueSupplierCargosFromOrders } from '../utils/supplierCargo';
import { prefillPayOrderSimpleTotals } from '../utils/orderPayPrefill';
import { getCachedProducts } from '../utils/catalogCache';
import {
  numOrZero,
  plannedSellingSummary,
  plannedSupplierPerUnit,
  plannedSupplierTotal,
  plannedSupplierPaymentTotals,
} from '../utils/orderPlannedPricing';
import './TablePage.css';
import SortableTh from '../components/SortableTh';
import { usePermissions } from '../hooks/usePermissions';
import ProductCatalogFilterFields from '../components/ProductCatalogFilterFields';
import FormSearchableSelect from '../components/FormSearchableSelect';
import { matchesProductCatalogFilters, getCascadedFilterOptions, getCascadedDateOptions } from '../utils/productFilterUtils';
import CustomerSearchableSelect from '../components/CustomerSearchableSelect';
import { useClientTableSort, compareForSort } from '../utils/tableSort';
import { buildOrderDisplayRows, aggregateGroupOrders, orderLikeForDisplayRow, cargoPoolTotals, cargoUnitCosts } from '../utils/orderGroupDisplay';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import { formatAppDateTime, formatAppNumber } from '../utils/localeFormat';

const PRODUCT_CATEGORY_TYPE_VALUES = ['sports', 'casual'];

const categoryTypeLabel = (value, t) =>
  value ? t(`categoryTypes.${value}`, { ns: 'orders', defaultValue: '' }) : '';

const orderTypeShortLabel = (orderType, t) => {
  if (orderType === 'stock') return t('types.stock_short', { ns: 'orders' });
  if (orderType === 'on_demand') return t('types.on_demand_short', { ns: 'orders' });
  return orderType || '—';
};

function formatOrderStatus(status, tStatus) {
  if (tStatus) return tStatus(status, 'order');
  return String(status ?? '').replace(/_/g, ' ');
}

function showMarkAsOrderedAction(order) {
  return order.status === 'order_created';
}

function showMarkAsReceivedAction(order) {
  return (
    (order.status === 'ordered' || order.status === 'order_paid') &&
    !order.has_ever_been_received
  );
}

function orderReadyForInventoryActions(order) {
  return (
    (order.status === 'received' || order.status === 'order_paid') &&
    order.order_is_paid &&
    order.cargo_is_paid
  );
}

/** Pipeline order of the workflow steps a row can be waiting on. */
const ORDER_STEP_SEQUENCE = [
  'mark_ordered',
  'pay_order',
  'mark_received',
  'pay_cargo',
  'finalize',
];

/**
 * The single workflow step an order line is waiting on, or null when it is finished.
 *
 * The supplier is paid *before* the goods are counted, because that is the real sequence:
 * the eShop takes the money when the order is placed. Recording it in that order means the
 * system already knows the order is paid at the moment a short delivery is discovered, so
 * money the supplier sends back is recorded as a genuine refund rather than silently
 * shrinking a bill that was never raised.
 *
 * Cargo stays after receiving — freight is weighed on arrival, so its cost is not known
 * until the shipment is in hand.
 *
 * Corrections and exceptions — cancel, editing cargo cost, resolving a short delivery — are
 * not steps and keep their own independent visibility.
 */
function availableOrderSteps(order) {
  if (ORDER_TERMINAL_STATUSES.has(order.status)) return [];
  if (showMarkAsOrderedAction(order)) return ['mark_ordered'];
  if (!order.order_is_paid) return ['pay_order'];
  if (showMarkAsReceivedAction(order)) return ['mark_received'];
  if (!order.cargo_is_paid) return ['pay_cargo'];
  if (orderReadyForInventoryActions(order)) return ['finalize'];
  return [];
}

/**
 * Earliest step still outstanding anywhere in a multi-item order, so a group never offers
 * to pay cargo while some of its lines have not been received.
 */
function availableGroupSteps(groupOrders) {
  const open = new Set();
  (groupOrders || []).forEach((o) => availableOrderSteps(o).forEach((s) => open.add(s)));
  const earliest = ORDER_STEP_SEQUENCE.find((s) => open.has(s));
  return earliest ? [earliest] : [];
}

/** Colour of the "9 / 10" quantity badge, by how the short delivery ended up. */
const SHORTFALL_BADGE_COLORS = {
  pending: '#ff9800',
  refunded: '#4caf50',
  written_off: '#f44336',
};

/**
 * Quantity cell: plain count normally, "received / ordered" plus a badge when a delivery
 * came up short, so an under-delivered line is obvious without opening anything.
 */
function renderQuantityCell(ordered, received, shortfallStatus, t) {
  const orderedNum = parseInt(ordered, 10) || 0;
  const receivedNum = received === null || received === undefined ? null : parseInt(received, 10);
  if (receivedNum === null || receivedNum === orderedNum) {
    return <>{orderedNum}</>;
  }
  const missing = orderedNum - receivedNum;
  const color = SHORTFALL_BADGE_COLORS[shortfallStatus] || SHORTFALL_BADGE_COLORS.pending;
  const titleKey = {
    pending: 'batch.shortfallPending',
    refunded: 'batch.shortfallRefunded',
    written_off: 'batch.shortfallWrittenOff',
  }[shortfallStatus] || 'batch.shortfallPending';
  return (
    <span title={t(titleKey, { ns: 'orders', count: missing })}>
      <strong>{receivedNum}</strong>
      <span style={{ color: '#999' }}> / {orderedNum}</span>
      <span
        style={{
          marginLeft: '6px',
          padding: '1px 5px',
          borderRadius: '8px',
          backgroundColor: color,
          color: '#fff',
          fontSize: '0.75em',
          whiteSpace: 'nowrap',
        }}
      >
        {t('batch.shortfallBadge', { ns: 'orders', count: missing })}
      </span>
    </span>
  );
}

/** Open pipeline first; finished rows (inventory / sold / cancelled) sink to the bottom. */
const ORDER_TERMINAL_STATUSES = new Set(['in_inventory', 'sold', 'cancelled']);

const ORDER_OPEN_STATUS_RANK = {
  order_created: 0,
  ordered: 1,
  order_paid: 2,
  received: 3,
};

function compareActiveOrdersFirst(a, b) {
  const aDone = ORDER_TERMINAL_STATUSES.has(a.status) ? 1 : 0;
  const bDone = ORDER_TERMINAL_STATUSES.has(b.status) ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;
  if (!aDone) {
    const ra = ORDER_OPEN_STATUS_RANK[a.status] ?? 99;
    const rb = ORDER_OPEN_STATUS_RANK[b.status] ?? 99;
    if (ra !== rb) return ra - rb;
  }
  return 0;
}

function payTotalsMatchPlanned(expUzs, expUsd, uzsCash, uzsCard, usdCash, usdCard) {
  const inUzs = (uzsCash || 0) + (uzsCard || 0);
  const inUsd = (usdCash || 0) + (usdCard || 0);
  const tolUzs = 0.501;
  const tolUsd = 0.015;
  return (
    Math.abs(expUzs - inUzs) <= tolUzs && Math.abs(expUsd - inUsd) <= tolUsd
  );
}

/** Planned cargo amounts on the order (before this payment). */
function plannedCargoPaymentTotals(order) {
  if (!order) return { uzs: 0, usd: 0 };
  const uzs = numOrZero(order.cargo_cost_uzs);
  const usd = numOrZero(order.cargo_cost_usd);
  return { uzs, usd };
}

/**
 * Cargo pay form: single UZS field + single USD field (Option A rolls into *_cash buckets).
 * @returns {false} if user cancels.
 */
function confirmCargoPaymentIfNeeded(order, uzsEntered, usdEntered, t) {
  const uz = Number(uzsEntered) || 0;
  const us = Number(usdEntered) || 0;
  const { uzs: expZ, usd: expD } = plannedCargoPaymentTotals(order);

  if (payTotalsMatchPlanned(expZ, expD, uz, 0, us, 0)) {
    return true;
  }

  if (uz + us === 0) {
    const hadPlannedCargo = expZ + expD > 0;
    const msg = hadPlannedCargo
      ? t('confirm.cargoZeroWithPlanned', {
          uzs: formatDisplayAmount(expZ, 'UZS'),
          usd: formatDisplayAmount(expD, 'USD'),
        })
      : t('confirm.cargoZeroNoPlanned');

    return window.confirm(msg);
  }

  return window.confirm(
    t('confirm.cargoMismatch', {
      plannedUzs: formatDisplayAmount(expZ, 'UZS'),
      plannedUsd: formatDisplayAmount(expD, 'USD'),
      enteredUzs: formatDisplayAmount(uz, 'UZS'),
      enteredUsd: formatDisplayAmount(us, 'USD'),
    }),
  );
}

/**
 * “Pay for the order” / supplier cost: compares form UZS + USD totals to planned supplier legs.
 * @returns {false} if user cancels.
 */
function confirmOrderPayTotalsIfMismatch(order, uzsEntered, usdEntered, t) {
  const uz = Number(uzsEntered) || 0;
  const us = Number(usdEntered) || 0;
  const { uzs: expZ, usd: expD } = plannedSupplierPaymentTotals(order);
  if (payTotalsMatchPlanned(expZ, expD, uz, 0, us, 0)) {
    return true;
  }

  return window.confirm(
    t('confirm.orderPayMismatch', {
      plannedUzs: formatDisplayAmount(expZ, 'UZS'),
      plannedUsd: formatDisplayAmount(expD, 'USD'),
      enteredUzs: formatDisplayAmount(uz, 'UZS'),
      enteredUsd: formatDisplayAmount(us, 'USD'),
    }),
  );
}

function formatOrderPaymentAmounts(uzs, usd) {
  if (uzs <= 0 && usd <= 0) return '$0.00';
  const parts = [];
  if (uzs > 0) parts.push(formatDisplayAmount(uzs, 'UZS'));
  if (usd > 0) parts.push(formatDisplayAmount(usd, 'USD'));
  return parts.length ? parts.join(' + ') : '$0.00';
}

function formatOrderDueAmount(order, t) {
  const { uzs, usd } = plannedSupplierPaymentTotals(order);
  if (uzs <= 0 && usd <= 0) {
    return t('confirm.noPlannedSupplierCost');
  }
  return formatOrderPaymentAmounts(uzs, usd);
}

function orderDueUnitDetail(order, t) {
  const qi = parseInt(order?.ordered_quantity, 10) || 0;
  if (qi <= 0) return '';
  const { uzs, usd } = plannedSupplierPaymentTotals(order);
  if (uzs > 0) {
    return t('confirm.unitDetailUzs', {
      perUnit: formatDisplayAmount(uzs / qi, 'UZS'),
      qty: qi,
    });
  }
  if (usd > 0) {
    const pu = parseFloat(order.cost_per_unit);
    if (Number.isFinite(pu) && pu > 0) {
      return t('confirm.unitDetailUsd', {
        perUnit: formatDisplayAmount(pu, 'USD'),
        qty: qi,
      });
    }
  }
  return '';
}

/** Client eShop orders: always confirm before paying (due vs entered). @returns {false} if user cancels. */
function confirmClientOrderPay(order, uzsEntered, usdEntered, t) {
  const uz = Number(uzsEntered) || 0;
  const us = Number(usdEntered) || 0;
  const productLabel = order?.product_detail
    ? productOrderPickerLabel(order.product_detail, t)
    : t('confirm.productFallback', { id: order?.product ?? '?' });
  const customerLine = order?.customer_detail?.name
    ? t('confirm.customerLine', { name: order.customer_detail.name })
    : '';
  const notesRaw = String(order?.client_eshop_notes || '').trim();
  const notesLine = notesRaw
    ? t('confirm.clientNotesLine', {
        notes: notesRaw.length > 120 ? `${notesRaw.slice(0, 120)}…` : notesRaw,
      })
    : '';

  return window.confirm(
    t('confirm.clientPay', {
      id: order?.id ?? '?',
      product: productLabel,
      qty: order?.ordered_quantity ?? '—',
      customer: customerLine,
      notes: notesLine,
      due: formatOrderDueAmount(order, t),
      unitDetail: orderDueUnitDetail(order, t),
      paying: formatOrderPaymentAmounts(uz, us),
    }),
  );
}

function productOrderPickerLabel(p, t) {
  if (!p) return '';
  const bits = [
    p.brand,
    p.model,
    p.size ? t('form.sizeLabel', { size: p.size }) : null,
    p.color,
  ].filter(Boolean);
  return bits.join(' · ');
}

const BUILTIN_ESHOP_SLUGS = new Set([
  'zalando',
  'best_secret',
  'adidas',
  'unidays',
  'nike',
  'asos',
  'other',
  'client',
]);

function isClientEshopSlug(eshop) {
  return String(eshop || '').trim().toLowerCase() === 'client';
}

/** Built-in slug → table / display label */
const KNOWN_ESHOP_LABELS = {
  zalando: 'Zalando',
  best_secret: 'Best Secret',
  adidas: 'Adidas',
  unidays: 'UniDays',
  nike: 'Nike',
  asos: 'ASOS',
  other: 'Other',
  client: 'Client',
};

function formatEshopDisplay(eshop, t) {
  const raw = String(eshop ?? '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (KNOWN_ESHOP_LABELS[key]) {
    return t(`eshops.${key}`, { ns: 'orders', defaultValue: KNOWN_ESHOP_LABELS[key] });
  }
  return raw;
}

function orderSellingUsdPerUnitForSort(order) {
  const qi = parseInt(order.ordered_quantity, 10) || 0;
  const ud = numOrZero(order.selling_usd_cash) + numOrZero(order.selling_usd_card);
  if (qi > 0 && ud > 0) return ud / qi;
  const legacyPu = parseFloat(order.selling_price);
  const hasLegacy =
    order.selling_price != null &&
    order.selling_price !== '' &&
    !Number.isNaN(legacyPu) &&
    legacyPu > 0;
  return hasLegacy ? legacyPu : 0;
}

function orderCostPerUnitForSort(order) {
  const qi = parseInt(order.ordered_quantity, 10) || 1;
  const uzs = numOrZero(order.supplier_cost_uzs_cash) + numOrZero(order.supplier_cost_uzs_card);
  const usdTot = parseFloat(order.cost_total) || 0;
  const usdPu = parseFloat(order.cost_per_unit) || 0;
  if (usdTot > 0 && uzs <= 0 && !Number.isNaN(usdPu)) return usdPu;
  if (uzs > 0 && usdTot <= 0) return uzs / qi;
  return 0;
}

/** Main orders grid — must match `<SortableTh columnId>` values. Actions excluded. */
const ORDER_SORT_ACCESSORS = {
  id: (o) => Number(o.id) || 0,
  status: (o) => String(o.status ?? '').toLowerCase(),
  category_type: (o) => String(o.product_detail?.category_type ?? '').toLowerCase(),
  category: (o) => String(o.product_detail?.category ?? '').toLowerCase(),
  brand: (o) => String(o.product_detail?.brand ?? '').toLowerCase(),
  model: (o) => String(o.product_detail?.model ?? '').toLowerCase(),
  size: (o) => String(o.product_detail?.size ?? '').toLowerCase(),
  color: (o) => String(o.product_detail?.color ?? '').toLowerCase(),
  supplier_country: (o) => String(o.supplier_country ?? '').toLowerCase(),
  supplier_cargo: (o) => String(o.supplier_cargo ?? '').toLowerCase(),
  eshop: (o) => String(o.eshop ?? '').toLowerCase(),
  order_type: (o) => String(o.order_type ?? '').toLowerCase(),
  customer: (o) => String(o.customer_detail?.name ?? '').toLowerCase(),
  qty: (o) => parseInt(o.ordered_quantity, 10) || 0,
  weight: (o) => parseFloat(o.weight) || 0,
  selling_price_unit: (o) => orderSellingUsdPerUnitForSort(o),
  cost_per_unit: (o) => orderCostPerUnitForSort(o),
  total_cost: (o) => parseFloat(o.cost_total) || 0,
  order_uzs: (o) =>
    (parseFloat(o.order_payment_uzs_cash) || 0) + (parseFloat(o.order_payment_uzs_card) || 0),
  order_usd: (o) =>
    (parseFloat(o.order_payment_usd_cash) || 0) + (parseFloat(o.order_payment_usd_card) || 0),
  cargo_uzs: (o) =>
    (parseFloat(o.cargo_payment_uzs_cash) || 0) + (parseFloat(o.cargo_payment_uzs_card) || 0),
  cargo_usd: (o) =>
    (parseFloat(o.cargo_payment_usd_cash) || 0) + (parseFloat(o.cargo_payment_usd_card) || 0),
  created_by: (o) => String(o.created_by_detail?.username ?? '').toLowerCase(),
  ordered_note: (o) =>
    String(`${o.ordered_note_role || ''} ${o.ordered_note || ''}`).toLowerCase(),
  order_date: (o) => new Date(o.order_date || o.created_at).getTime() || 0,
};

function formatOrderedNoteDisplay(order) {
  const note = String(order?.ordered_note || '').trim();
  if (!note) return '';
  const role = String(order?.ordered_note_role || '').trim();
  return role ? `${role} - ${note}` : note;
}
const Orders = () => {
  const { t, tStatus, monthOptions } = useAppTranslation(['orders', 'common', 'status', 'sales']);
  const uzsLabel = t('currency.uzs', { ns: 'common' });

  const productCategoryTypes = useMemo(
    () =>
      PRODUCT_CATEGORY_TYPE_VALUES.map((value) => ({
        value,
        label: t(`categoryTypes.${value}`, { ns: 'orders' }),
      })),
    [t],
  );

  const regionChoices = useMemo(
    () =>
      [
        'andijan',
        'bukhara',
        'fergana',
        'jizzakh',
        'kashkadarya',
        'khorezm',
        'namangan',
        'navoi',
        'samarkand',
        'surkhandarya',
        'syrdarya',
        'tashkent_region',
        'karakalpakstan',
        'tashkent_city',
      ].map((value) => ({
        value,
        label: t(`regions.${value}`, { ns: 'sales' }),
      })),
    [t],
  );

  const orderStatusFilterOptions = useMemo(
    () => [
      { value: 'order_created', label: tStatus('order_created', 'order') },
      { value: 'ordered', label: tStatus('ordered', 'order') },
      { value: 'order_paid', label: tStatus('order_paid', 'order') },
      { value: 'received', label: tStatus('received', 'order') },
      { value: 'in_inventory', label: tStatus('in_inventory', 'order') },
      { value: 'cancelled', label: tStatus('cancelled', 'order') },
    ],
    [tStatus],
  );

  const { user, refreshUser, hasPermission, hasAnyPermission } = usePermissions();
  const canCreateOrder = hasPermission('orders.create');
  const canPayOrder = hasPermission('orders.pay_order');
  const canPayCargo = hasPermission('orders.pay_cargo');
  const canMoveInventory = hasPermission('orders.move_to_inventory');
  const canSellProduct = hasPermission('orders.sell_product');
  const canUpdateStatus = hasPermission('orders.update_status');
  const canMarkAsOrdered = hasPermission('orders.mark_as_ordered');
  const canCancelOrder = hasPermission('orders.cancel');
  const canPostOrderStatus = hasAnyPermission(['orders.update_status', 'orders.move_to_inventory']);
  const canManageStockOrders = canUpdateStatus || isOperationalSenior(user);
  // Purchasing Agent must see stock + on-demand rows to mark Ordered.
  // Sales managers without stock workflow still see on-demand only.
  const canSeeStockOrders = canManageStockOrders || canMarkAsOrdered;
  const orderTableColumnCount = canSeeStockOrders ? 28 : 27;
  const orderFooterLabelColSpan = canSeeStockOrders ? 15 : 14;
  /** Ledger totals for pay flows and move-to-inventory advance refunds (not bare status updates). */
  const needsLedgerForPayments = canPayOrder || canPayCargo || canMoveInventory;

  useEffect(() => {
    if (user && (!Array.isArray(user.permissions) || user.permissions.length === 0)) {
      refreshUser();
    }
  }, [user, refreshUser]);
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [balances, setBalances] = useState([]);
  const [balancesLoaded, setBalancesLoaded] = useState(false);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    category_type: '',
    category: [],
    brand: [],
    model: [],
    sizes: [],
    color: [],
    order_type: '',
    status: '',
    shortfall: '',
    customer: '',
    year: '',
    month: '',
  });
  const newBatchLine = useCallback(() => ({
    key: `${Date.now()}-${Math.random()}`,
    category_type: '',
    category: '',
    product: '',
    ordered_quantity: '1',
    cost_usd_per_unit: '',
    selling_usd_per_unit: '',
    eshop: '',
    client_eshop_notes: '',
    advance_payment_amount: '',
    advance_payment_currency: 'USD',
  }), []);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchCreating, setBatchCreating] = useState(false);
  const [batchShared, setBatchShared] = useState({
    order_type: 'stock',
    supplier_country: '',
    supplier_cargo: '',
    customer: '',
  });
  const [batchLines, setBatchLines] = useState([]);

  const [paymentFormData, setPaymentFormData] = useState({
    orderId: null,
    uzs: '',
    usd: '',
    is_pay_order: false,
    is_received_and_pay: false,
    status_notes: '',
  });
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  
  const [cargoFormData, setCargoFormData] = useState({
    orderId: null,
    uzs: '',
    usd: '',
    weight: '',
  });
  const [showCargoForm, setShowCargoForm] = useState(false);
  const [markOrderedFormData, setMarkOrderedFormData] = useState({
    orderId: null,
    notes: '',
  });
  const [showMarkOrderedForm, setShowMarkOrderedForm] = useState(false);
  const markOrderedFormRef = useRef(null);

  const [showMarkOrderedGroupForm, setShowMarkOrderedGroupForm] = useState(false);
  const [markOrderedGroupData, setMarkOrderedGroupData] = useState({
    groupId: null,
    notes: '',
  });
  const markOrderedGroupFormRef = useRef(null);

  const [showCargoGroupForm, setShowCargoGroupForm] = useState(false);
  const [cargoGroupData, setCargoGroupData] = useState({ groupId: null, uzs: '', usd: '', weightTotal: '', lines: [] });
  const cargoGroupFormRef = useRef(null);

  const [showPayOrderGroupForm, setShowPayOrderGroupForm] = useState(false);
  const [payOrderGroupData, setPayOrderGroupData] = useState({ groupId: null, lines: [] });
  const payOrderGroupFormRef = useRef(null);

  // Mark-as-received: the physical count happens here, so the quantity is captured per line
  // rather than assumed equal to what was ordered. `groupId` is set for a whole-shipment
  // receipt, otherwise a single line is counted.
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [receiveData, setReceiveData] = useState({
    groupId: null,
    lines: [],
    note: '',
  });
  const receiveFormRef = useRef(null);

  const [showMoveToInventoryForm, setShowMoveToInventoryForm] = useState(false);
  const paymentFormRef = useRef(null);
  const cargoFormRef = useRef(null);
  const moveToInventoryFormRef = useRef(null);
  const [moveToInventoryData, setMoveToInventoryData] = useState({
    orderId: null,
    return_advance: false,
    /** Which cash ledger leg to debit when refunding advance (UZS vs USD buckets). */
    return_payment_currency: 'USD',
    /** Editable refund amount when returning advance (defaults to booked advance when opening modal). */
    return_advance_amount: '',
  });
  
  const [customers, setCustomers] = useState([]);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    name: '',
    telephone: '+998',
    instagram: '',
    region: 'tashkent_city',
    notes: '',
  });
  
  // Notification state
  const [notification, setNotification] = useState({
    show: false,
    message: '',
    type: 'success', // 'success', 'error', 'info'
  });
  
  // Show notification helper
  const showNotification = (message, type = 'success') => {
    setNotification({ show: true, message, type });
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' });
    }, 5000);
  };
  
  const canViewCash = hasPermission('cash.view');
  const canViewProducts = hasPermission('products.view');
  const canViewCustomers = hasPermission('customers.view');

  useEffect(() => {
    fetchOrders();
    // Purchasing Agent (and similar) may use Orders without products/customers grants.
    // Catalog filters already use nested product_detail / customer_detail on each order.
    if (canViewProducts || canCreateOrder) {
      fetchProducts();
    }
    if (canViewCustomers || canCreateOrder) {
      fetchCustomers();
    }
    if (canViewCash || needsLedgerForPayments) {
      fetchBalances();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const fetchBalances = async () => {
    try {
      const response = await apiGetAll('/cash-balance/');
      setBalances(response.data.results || response.data);
      setBalancesLoaded(true);
    } catch (error) {
      console.error('Error fetching balances:', error);
      setBalancesLoaded(false);
    }
  };

  const getAvailableBalance = (currency) => cashBalanceTotalByCurrency(balances, currency);

  /** Skip client-side ledger check when balances could not be loaded (e.g. no cash.view). */
  const ledgerHasFunds = (currency, required) => {
    if (!required || required <= 0) return true;
    if (!balancesLoaded) return true;
    return getAvailableBalance(currency) >= required;
  };

  const fetchCustomers = async () => {
    try {
      const response = await apiGetAll('/customers/', { params: { lite: 1 } });
      setCustomers(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };
  
  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    if (!newCustomerData.telephone.trim()) {
      showNotification(t('notifications.telephoneRequired'), 'error');
      return;
    }
    try {
      const response = await api.post('/customers/', { ...newCustomerData });
      await fetchCustomers();
      setBatchShared((prev) => ({ ...prev, customer: response.data.id }));
      setShowCustomerForm(false);
      setNewCustomerData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city', notes: '' });
    } catch (error) {
      console.error('Error creating customer:', error);
      showNotification(error.response?.data?.error || t('notifications.createCustomerError'), 'error');
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await apiGetAll('/orders/');
      const ordersList = response.data.results || response.data;
      setOrders(ordersList);
      applyFilters(ordersList);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };



  const eshopOptions = useMemo(() => [
    { value: 'zalando', label: t('eshops.zalando', { ns: 'orders' }) },
    { value: 'best_secret', label: t('eshops.best_secret', { ns: 'orders' }) },
    { value: 'adidas', label: t('eshops.adidas', { ns: 'orders' }) },
    { value: 'unidays', label: t('eshops.unidays', { ns: 'orders' }) },
    { value: 'nike', label: t('eshops.nike', { ns: 'orders' }) },
    { value: 'asos', label: t('eshops.asos', { ns: 'orders' }) },
    ...[...new Set(
      orders
        .map((o) => o.eshop)
        .filter((e) => e && !BUILTIN_ESHOP_SLUGS.has(String(e).toLowerCase()))
    )].sort().map((eshop) => ({ value: eshop, label: eshop })),
    { value: 'client', label: t('eshops.client', { ns: 'orders' }) },
    { value: 'other', label: t('eshops.other', { ns: 'orders' }) },
  ], [orders, t]);

  const customerFilterOptions = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      if (c?.id != null) map.set(c.id, c);
    }
    for (const o of orders) {
      const d = o.customer_detail;
      if (d?.id != null && !map.has(d.id)) map.set(d.id, d);
    }
    return [...map.values()].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
    );
  }, [customers, orders]);

  const applyFilters = (ordersList) => {
    let filtered = ordersList;

    // Purchasing Agent: only orders with exact supplier country "Yaponiya".
    if (isPurchasingAgent(user)) {
      filtered = filtered.filter(
        (order) => order.supplier_country === PURCHASING_AGENT_SUPPLIER_COUNTRY,
      );
    }

    if (!canSeeStockOrders) {
      filtered = filtered.filter((order) => order.order_type !== 'stock');
    }
    
    if (filters.category_type) {
      filtered = filtered.filter(
        (order) => order.product_detail?.category_type === filters.category_type,
      );
    }
    filtered = filtered.filter((order) => matchesProductCatalogFilters(order.product_detail, filters));
    if (filters.order_type) {
      filtered = filtered.filter(order => order.order_type === filters.order_type);
    }
    if (filters.status) {
      filtered = filtered.filter(order => order.status === filters.status);
    }
    if (filters.shortfall === 'pending') {
      filtered = filtered.filter((order) => order.shortfall_status === 'pending');
    }
    if (filters.customer) {
      if (filters.customer === '__none__') {
        filtered = filtered.filter((order) => !order.customer && !order.customer_detail?.id);
      } else {
        const customerId = parseInt(filters.customer, 10);
        filtered = filtered.filter(
          (order) =>
            order.customer === customerId ||
            order.customer_detail?.id === customerId,
        );
      }
    }
    if (filters.year) {
      filtered = filtered.filter(order => {
        const orderYear = new Date(order.order_date || order.created_at).getFullYear();
        return orderYear.toString() === filters.year;
      });
    }
    if (filters.month) {
      filtered = filtered.filter(order => {
        const orderMonth = new Date(order.order_date || order.created_at).getMonth() + 1;
        return orderMonth.toString() === filters.month;
      });
    }
    
    setFilteredOrders(filtered);
  };

  useEffect(() => {
    if (orders.length > 0) {
      applyFilters(orders);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, user?.role_code]);

  const orderSort = useClientTableSort(ORDER_SORT_ACCESSORS);

  const [expandedOrderGroups, setExpandedOrderGroups] = useState(() => new Set());
  const toggleOrderGroup = (groupId) => {
    setExpandedOrderGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const orderDisplayRows = useMemo(
    () => buildOrderDisplayRows(filteredOrders, orders),
    [filteredOrders, orders],
  );

  const sortedFilteredOrders = useMemo(() => {
    const rows = orderDisplayRows;
    if (!rows?.length) return rows;
    // An explicit header click sorts the whole table by that column and nothing else.
    // Grouping open orders above finished ones here would pin the pipeline to the top and
    // leave the click only reordering rows *within* each group, which is not what the
    // header promises. That grouping stays the default view below, for no active sort.
    if (orderSort.sortCol && ORDER_SORT_ACCESSORS[orderSort.sortCol]) {
      const get = ORDER_SORT_ACCESSORS[orderSort.sortCol];
      const sign = orderSort.sortDir === 'desc' ? -1 : 1;
      return [...rows].sort((a, b) => {
        const oa = orderLikeForDisplayRow(a);
        const ob = orderLikeForDisplayRow(b);
        const byColumn = compareForSort(get(oa), get(ob)) * sign;
        if (byColumn !== 0) return byColumn;
        // Ties keep a stable, predictable order instead of drifting between renders.
        return (oa.id ?? 0) - (ob.id ?? 0);
      });
    }
    return [...rows].sort((a, b) => {
      const oa = orderLikeForDisplayRow(a);
      const ob = orderLikeForDisplayRow(b);
      const active = compareActiveOrdersFirst(oa, ob);
      if (active !== 0) return active;
      const ta = new Date(oa.order_date || oa.created_at).getTime() || 0;
      const tb = new Date(ob.order_date || ob.created_at).getTime() || 0;
      return tb - ta;
    });
  }, [orderDisplayRows, orderSort]);

  const orderColumnTotals = useMemo(() => {
    const list = filteredOrders;
    if (!list.length) {
      return {
        quantity: 0,
        weight: 0,
        costTotal: 0,
        avgCostPerUnit: 0,
        avgSellingPerUnitOrdered: 0,
        orderUzsCash: 0,
        orderUzsCard: 0,
        orderUsdCash: 0,
        orderUsdCard: 0,
        cargoUzsCash: 0,
        cargoUzsCard: 0,
        cargoUsdCash: 0,
        cargoUsdCard: 0,
        orderUzs: 0,
        orderUsd: 0,
        cargoUzs: 0,
        cargoUsd: 0,
      };
    }
    let quantity = 0;
    let weight = 0;
    let costTotal = 0;
    let orderUzsCash = 0;
    let orderUzsCard = 0;
    let orderUsdCash = 0;
    let orderUsdCard = 0;
    let cargoUzsCash = 0;
    let cargoUzsCard = 0;
    let cargoUsdCash = 0;
    let cargoUsdCard = 0;
    let qtyUsdSelling = 0;
    let sumUsdPlannedSelling = 0;
    for (const o of list) {
      const qi = parseInt(o.ordered_quantity, 10) || 0;
      quantity += qi;
      weight += parseFloat(o.weight) || 0;
      costTotal += parseFloat(o.cost_total) || 0;
      const ud = numOrZero(o.selling_usd_cash) + numOrZero(o.selling_usd_card);
      const legacyPu = parseFloat(o.selling_price);
      const hasLegacy = o.selling_price != null && o.selling_price !== '' && !Number.isNaN(legacyPu) && legacyPu > 0;
      if (qi > 0 && ud > 0) {
        sumUsdPlannedSelling += ud;
        qtyUsdSelling += qi;
      } else if (qi > 0 && hasLegacy) {
        sumUsdPlannedSelling += legacyPu * qi;
        qtyUsdSelling += qi;
      }
      orderUzsCash += parseFloat(o.order_payment_uzs_cash) || 0;
      orderUzsCard += parseFloat(o.order_payment_uzs_card) || 0;
      orderUsdCash += parseFloat(o.order_payment_usd_cash) || 0;
      orderUsdCard += parseFloat(o.order_payment_usd_card) || 0;
      cargoUzsCash += parseFloat(o.cargo_payment_uzs_cash) || 0;
      cargoUzsCard += parseFloat(o.cargo_payment_uzs_card) || 0;
      cargoUsdCash += parseFloat(o.cargo_payment_usd_cash) || 0;
      cargoUsdCard += parseFloat(o.cargo_payment_usd_card) || 0;
    }
    return {
      quantity,
      weight,
      costTotal,
      avgCostPerUnit: quantity > 0 ? costTotal / quantity : 0,
      avgSellingPerUnitOrdered:
        qtyUsdSelling > 0 && sumUsdPlannedSelling > 0 ? sumUsdPlannedSelling / qtyUsdSelling : 0,
      orderUzsCash,
      orderUzsCard,
      orderUsdCash,
      orderUsdCard,
      cargoUzsCash,
      cargoUzsCard,
      cargoUsdCash,
      cargoUsdCard,
      orderUzs: orderUzsCash + orderUzsCard,
      orderUsd: orderUsdCash + orderUsdCard,
      cargoUzs: cargoUzsCash + cargoUzsCard,
      cargoUsd: cargoUsdCash + cargoUsdCard,
    };
  }, [filteredOrders]);

  const fetchProducts = async () => {
    try {
      const list = await getCachedProducts(api);
      setProducts(list);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const addBatchLine = () => setBatchLines((lines) => [...lines, newBatchLine()]);

  const removeBatchLine = (key) => {
    setBatchLines((lines) => (lines.length <= 1 ? lines : lines.filter((l) => l.key !== key)));
  };

  const updateBatchLine = (key, field, value) => {
    setBatchLines((lines) =>
      lines.map((l) => {
        if (l.key !== key) return l;
        if (field === 'category_type') {
          return { ...l, category_type: value, category: '', product: '' };
        }
        if (field === 'category') {
          return { ...l, category: value, product: '' };
        }
        if (field === 'product') {
          const product = products.find((p) => String(p.id) === String(value));
          const psp = product ? parseFloat(product.selling_price) : NaN;
          return {
            ...l,
            product: value,
            selling_usd_per_unit: psp > 0 && !Number.isNaN(psp) ? psp.toFixed(2) : l.selling_usd_per_unit,
          };
        }
        return { ...l, [field]: value };
      })
    );
  };

  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    if (batchCreating) return;
    const withProduct = batchLines.filter((l) => l.product);
    if (withProduct.length === 0) {
      showNotification(t('notifications.selectProductQty'), 'error');
      return;
    }
    const isOnDemand = batchShared.order_type === 'on_demand';
    if (isOnDemand) {
      const cId = parseInt(batchShared.customer, 10);
      if (!batchShared.customer || Number.isNaN(cId)) {
        showNotification(t('notifications.selectCustomerOnDemand'), 'error');
        return;
      }
    }
    for (const l of withProduct) {
      const qty = parseInt(l.ordered_quantity, 10) || 0;
      if (qty < 1) {
        showNotification(t('notifications.selectProductQty'), 'error');
        return;
      }
      const sellingUsd = parseFloat(l.selling_usd_per_unit) || 0;
      if (!(sellingUsd > 0)) {
        showNotification(t('notifications.sellingPriceRequired'), 'error');
        return;
      }
      if (!String(l.eshop || '').trim()) {
        showNotification(t('notifications.selectEshop'), 'error');
        return;
      }
      if (isClientEshopSlug(l.eshop) && !String(l.client_eshop_notes || '').trim()) {
        showNotification(t('notifications.clientNotesRequired'), 'error');
        return;
      }
      if (isOnDemand) {
        const advanceAmt = parseFloat(l.advance_payment_amount) || 0;
        const advanceCcy = l.advance_payment_currency === 'UZS' ? 'UZS' : 'USD';
        const sellingTotal = sellingUsd * qty;
        if (advanceAmt > 0) {
          if (advanceCcy === 'USD') {
            if (advanceAmt > sellingTotal + 0.01) {
              showNotification(
                t('notifications.advanceExceedsSelling', {
                  total: formatDisplayAmount(sellingTotal, 'USD'),
                }),
                'error',
              );
              return;
            }
          } else {
            const ok = window.confirm(
              t('confirm.advanceUzs', {
                amount: formatDisplayAmount(advanceAmt, 'UZS'),
                selling: formatDisplayAmount(sellingTotal, 'USD'),
              }),
            );
            if (!ok) return;
          }
        }
      }
    }
    if (!batchShared.supplier_country.trim()) {
      showNotification(t('notifications.selectCountry'), 'error');
      return;
    }

    const items = withProduct.map((l) => {
      const qty = parseInt(l.ordered_quantity, 10) || 0;
      const sellingUsd = parseFloat(l.selling_usd_per_unit) || 0;
      const costUsd = parseFloat(l.cost_usd_per_unit) || 0;
      return {
        product: parseInt(l.product, 10),
        ordered_quantity: qty,
        eshop: l.eshop || '',
        client_eshop_notes: isClientEshopSlug(l.eshop) ? String(l.client_eshop_notes || '').trim() : '',
        selling_uzs_cash: 0,
        selling_uzs_card: 0,
        selling_usd_cash: sellingUsd * qty,
        selling_usd_card: 0,
        supplier_cost_uzs_cash: 0,
        supplier_cost_uzs_card: 0,
        supplier_cost_usd_cash: costUsd * qty,
        supplier_cost_usd_card: 0,
        ...(isOnDemand ? {
          advance_payment_amount: parseFloat(l.advance_payment_amount) || 0,
          advance_payment_currency: l.advance_payment_currency || 'USD',
          advance_payment_type: 'cash',
        } : {}),
      };
    });

    try {
      setBatchCreating(true);
      const { data } = await api.post('/orders/batch_create/', {
        order_type: batchShared.order_type,
        supplier_country: batchShared.supplier_country || null,
        supplier_cargo: batchShared.supplier_cargo?.trim() || null,
        ...(isOnDemand ? { customer: parseInt(batchShared.customer, 10) } : {}),
        items,
      });
      showNotification(data.message || t('batch.created', { ns: 'orders', count: data.count }), 'success');
      setShowBatchForm(false);
      setBatchShared({ order_type: canManageStockOrders ? 'stock' : 'on_demand', supplier_country: '', supplier_cargo: '', customer: '' });
      setBatchLines([newBatchLine()]);
      fetchOrders();
    } catch (error) {
      console.error('Error batch-creating orders:', error);
      const d = error.response?.data;
      showNotification(d?.error || t('notifications.createError'), 'error');
    } finally {
      setBatchCreating(false);
    }
  };

  const handleStatusUpdate = async (orderId, newStatus) => {
    try {
      if (!canPostOrderStatus) {
        showNotification(t('notifications.noStatusPermission'), 'error');
        return;
      }
      await api.post(`/orders/${orderId}/update_status/`, {
        status: newStatus,
        notes: '',
      });
      await fetchOrders();
      showNotification(t('notifications.statusUpdated'), 'success');
    } catch (error) {
      console.error('Error updating status:', error);
      showNotification(error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'), 'error');
    }
  };

  /**
   * Per-unit supplier cost of an order line, as (usd, uzs).
   *
   * Mirrors the backend's `supplier_unit_cost_from_order`: the amounts actually paid once
   * the order is settled, the planned buckets before that. Divided by the ORDERED quantity,
   * because that is what the money bought.
   */
  const orderSupplierUnitCost = (order) => {
    const ordered = parseInt(order.ordered_quantity, 10) || 0;
    if (ordered <= 0) return { usd: 0, uzs: 0 };
    if (order.order_is_paid) {
      return {
        usd: (numOrZero(order.order_payment_usd_cash) + numOrZero(order.order_payment_usd_card)) / ordered,
        uzs: (numOrZero(order.order_payment_uzs_cash) + numOrZero(order.order_payment_uzs_card)) / ordered,
      };
    }
    const plannedUsd = numOrZero(order.supplier_cost_usd_cash) + numOrZero(order.supplier_cost_usd_card);
    const plannedUzs = numOrZero(order.supplier_cost_uzs_cash) + numOrZero(order.supplier_cost_uzs_card);
    return {
      usd: (plannedUsd > 0 ? plannedUsd : numOrZero(order.cost_total)) / ordered,
      uzs: plannedUzs / ordered,
    };
  };

  const round2 = (n) => Math.round(n * 100) / 100;

  /** One editable row of the receive modal, pre-filled with the full ordered quantity. */
  const buildReceiveLine = (order) => ({
    orderId: order.id,
    label: `#${order.id} ${order.product_detail?.brand || ''} ${order.product_detail?.model || ''}`.trim(),
    ordered: parseInt(order.ordered_quantity, 10) || 0,
    received: String(parseInt(order.ordered_quantity, 10) || 0),
    unitCost: orderSupplierUnitCost(order),
    // Nothing has been handed over yet on an unpaid order, so there is nothing to refund —
    // the missing units simply come off the bill instead.
    orderIsPaid: Boolean(order.order_is_paid),
    refunded: false,
    refundUzs: '',
    refundUsd: '',
    // Once the amount is typed by hand, autofill stops overwriting it.
    refundTouched: false,
  });

  /**
   * Fill the refund with what the missing units cost, matching the backend's own default
   * (`_shortfall_supplier_value`) so the pre-filled figure is the one it would have used
   * anyway. Left alone once the user has edited the amount themselves.
   */
  const withRefundAutofill = (line) => {
    if (line.refundTouched || !line.refunded) return line;
    const received = parseInt(line.received, 10);
    const missing = Number.isInteger(received) ? line.ordered - received : 0;
    if (missing <= 0) return line;
    const usd = round2((line.unitCost?.usd || 0) * missing);
    const uzs = round2((line.unitCost?.uzs || 0) * missing);
    return {
      ...line,
      refundUsd: usd > 0 ? String(usd) : '',
      refundUzs: uzs > 0 ? String(uzs) : '',
    };
  };

  const openReceiveForm = (ordersToReceive, groupId = null) => {
    if (!canPostOrderStatus) {
      showNotification(t('notifications.noStatusPermission'), 'error');
      return;
    }
    if (!ordersToReceive.length) {
      showNotification(t('notifications.statusUpdateError'), 'error');
      return;
    }
    setReceiveData({ groupId, lines: ordersToReceive.map(buildReceiveLine), note: '' });
    setShowReceiveForm(true);
    setTimeout(
      () => receiveFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    );
  };

  const handleMarkReceived = (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    openReceiveForm(order ? [order] : []);
  };

  const updateReceiveLine = (orderId, patch) => {
    // A hand-typed amount marks the line as touched so the autofill below backs off.
    const touched =
      patch.refundUzs !== undefined || patch.refundUsd !== undefined
        ? { refundTouched: true }
        : {};
    setReceiveData((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        l.orderId === orderId ? withRefundAutofill({ ...l, ...patch, ...touched }) : l,
      ),
    }));
  };

  /** Shortfall fields for one line, or {} when everything arrived. */
  const receiveLinePayload = (line) => {
    const received = parseInt(line.received, 10);
    const payload = { received_quantity: received };
    if (received < line.ordered && line.refunded) {
      payload.shortfall_refunded = true;
      payload.shortfall_refund_uzs = line.refundUzs || 0;
      payload.shortfall_refund_usd = line.refundUsd || 0;
    }
    return payload;
  };

  const handleReceiveSubmit = async (e) => {
    e.preventDefault();
    for (const line of receiveData.lines) {
      const received = parseInt(line.received, 10);
      if (!Number.isInteger(received) || received < 0 || received > line.ordered) {
        showNotification(t('batch.errReceivedQty', { ns: 'orders' }), 'error');
        return;
      }
      // A ticked refund box with no amount would silently close the shortfall for nothing.
      if (received < line.ordered && line.refunded) {
        const uzs = parseFloat(line.refundUzs) || 0;
        const usd = parseFloat(line.refundUsd) || 0;
        if (uzs <= 0 && usd <= 0) {
          showNotification(t('batch.errRefundAmount', { ns: 'orders' }), 'error');
          return;
        }
      }
    }

    try {
      const note = String(receiveData.note || '').trim();
      if (receiveData.groupId) {
        const lines = {};
        receiveData.lines.forEach((line) => {
          lines[String(line.orderId)] = { ...receiveLinePayload(line), shortfall_note: note };
        });
        await api.post('/orders/update_status_group/', {
          order_group: receiveData.groupId,
          status: 'received',
          lines,
        });
      } else {
        const line = receiveData.lines[0];
        await api.post(`/orders/${line.orderId}/update_status/`, {
          status: 'received',
          notes: '',
          shortfall_note: note,
          ...receiveLinePayload(line),
        });
      }
      setShowReceiveForm(false);
      setReceiveData({ groupId: null, lines: [], note: '' });
      await fetchOrders();
      showNotification(t('notifications.receivedSuccess'), 'success');
    } catch (error) {
      console.error('Error recording receipt:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'),
        'error',
      );
    }
  };

  const handleReceiveRemaining = async (order) => {
    const outstanding = parseInt(order.shortfall_quantity, 10) || 0;
    if (!window.confirm(t('confirm.receiveRemaining', { id: order.id, count: outstanding }))) return;
    try {
      await api.post(`/orders/${order.id}/receive_remaining/`, { quantity: outstanding });
      await fetchOrders();
      showNotification(t('notifications.receiveRemainingSuccess'), 'success');
    } catch (error) {
      console.error('Error receiving remaining items:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.shortfallError'),
        'error',
      );
    }
  };

  const handleResolveShortfall = async (order, resolution) => {
    const body = { resolution };
    // Nothing was paid, so neither closure moves money — both simply drop the missing units
    // off the bill. Promising a refund here would be a lie.
    if (!order.order_is_paid) {
      if (!window.confirm(t('confirm.dropFromBill', { id: order.id }))) return;
      try {
        await api.post(`/orders/${order.id}/resolve_shortfall/`, { resolution: 'refunded' });
        await fetchOrders();
        showNotification(t('notifications.shortfallResolved'), 'success');
      } catch (error) {
        console.error('Error resolving shortfall:', error);
        showNotification(
          error.response?.data?.error || error.response?.data?.detail || t('notifications.shortfallError'),
          'error',
        );
      }
      return;
    }
    if (resolution === 'refunded') {
      // Default to what the missing units cost; the backend recomputes if left blank.
      const perUnit = parseFloat(order.cost_per_unit) || 0;
      const amount = (perUnit * (parseInt(order.shortfall_quantity, 10) || 0)).toFixed(2);
      if (!window.confirm(t('confirm.markRefunded', { id: order.id, amount: `$${amount}` }))) return;
      body.usd = amount;
    } else if (!window.confirm(t('confirm.writeOff', { id: order.id }))) {
      return;
    }
    try {
      await api.post(`/orders/${order.id}/resolve_shortfall/`, body);
      await fetchOrders();
      showNotification(t('notifications.shortfallResolved'), 'success');
    } catch (error) {
      console.error('Error resolving shortfall:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.shortfallError'),
        'error',
      );
    }
  };

  const handleMarkAsOrdered = (orderId) => {
    if (!canMarkAsOrdered) {
      showNotification(t('notifications.noStatusPermission'), 'error');
      return;
    }
    const order = orders.find((o) => o.id === orderId);
    if (!order || !showMarkAsOrderedAction(order)) {
      showNotification(t('notifications.statusUpdateError'), 'error');
      return;
    }
    setMarkOrderedFormData({
      orderId,
      notes: order.ordered_note || '',
    });
    setShowMarkOrderedForm(true);
    setTimeout(() => markOrderedFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const handleMarkAsOrderedSubmit = async (e) => {
    e.preventDefault();
    const notes = String(markOrderedFormData.notes || '').trim();
    const order = orders.find((o) => o.id === markOrderedFormData.orderId);
    const notesRequired = order?.supplier_country === PURCHASING_AGENT_SUPPLIER_COUNTRY;
    if (notesRequired && !notes) {
      showNotification(t('notifications.orderedNoteRequired'), 'error');
      return;
    }
    try {
      if (!canMarkAsOrdered) {
        showNotification(t('notifications.noStatusPermission'), 'error');
        return;
      }
      await api.post(`/orders/${markOrderedFormData.orderId}/mark_as_ordered/`, {
        notes,
      });
      setShowMarkOrderedForm(false);
      setMarkOrderedFormData({ orderId: null, notes: '' });
      await fetchOrders();
      showNotification(t('notifications.statusUpdated'), 'success');
    } catch (error) {
      console.error('Error marking order as ordered:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'),
        'error',
      );
    }
  };

  const handlePayOrder = async (orderOrId) => {
    const orderId = typeof orderOrId === 'object' && orderOrId != null ? orderOrId.id : orderOrId;
    let order =
      (typeof orderOrId === 'object' && orderOrId != null ? orderOrId : null) ||
      orders.find((o) => Number(o.id) === Number(orderId));
    if (!order || ORDER_TERMINAL_STATUSES.has(order.status)) {
      showNotification(t('notifications.orderTerminalReadonly'), 'error');
      return;
    }
    // Refresh from API so prefill uses latest supplier / cost fields (list can be stale).
    try {
      const res = await api.get(`/orders/${orderId}/`);
      if (res?.data) order = res.data;
    } catch (err) {
      console.warn('Pay order: could not refresh order detail, using list row', err);
    }
    const pref = prefillPayOrderSimpleTotals(order);
    setPaymentFormData({
      orderId: order.id,
      uzs: pref.uzs,
      usd: pref.usd,
      is_pay_order: true,
      is_received_and_pay: false,
      status_notes: '',
    });
    setShowPaymentForm(true);
    setTimeout(() => paymentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const handlePayCargo = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || ORDER_TERMINAL_STATUSES.has(order.status)) {
      showNotification(t('notifications.orderTerminalReadonly'), 'error');
      return;
    }
    // Prefill from planned cargo cost (set via mark-as-ordered / edit cargo).
    // Do not gate on cargo_payment_currency — that is only set after a successful pay.
    const uzsNum = Number(order?.cargo_cost_uzs);
    const usdNum = Number(order?.cargo_cost_usd);
    const weightNum = Number(order?.weight);
    setCargoFormData({
      orderId: orderId,
      uzs: Number.isFinite(uzsNum) && uzsNum > 0 ? String(uzsNum) : '',
      usd: Number.isFinite(usdNum) && usdNum > 0 ? String(usdNum) : '',
      weight: Number.isFinite(weightNum) && weightNum > 0 ? String(weightNum) : '',
    });
    setShowCargoForm(true);
    setTimeout(() => cargoFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const handleMarkAsOrderedGroup = (groupOrders) => {
    if (!canMarkAsOrdered) {
      showNotification(t('notifications.noStatusPermission'), 'error');
      return;
    }
    setMarkOrderedGroupData({ groupId: groupOrders[0].order_group, notes: '' });
    setShowMarkOrderedGroupForm(true);
    setTimeout(() => markOrderedGroupFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const handleMarkAsOrderedGroupSubmit = async (e) => {
    e.preventDefault();
    const notes = String(markOrderedGroupData.notes || '').trim();
    const groupOrder = orders.find((o) => o.order_group === markOrderedGroupData.groupId);
    const notesRequired = groupOrder?.supplier_country === PURCHASING_AGENT_SUPPLIER_COUNTRY;
    if (notesRequired && !notes) {
      showNotification(t('notifications.orderedNoteRequired'), 'error');
      return;
    }
    try {
      await api.post('/orders/mark_as_ordered_group/', {
        order_group: markOrderedGroupData.groupId,
        notes,
      });
      setShowMarkOrderedGroupForm(false);
      setMarkOrderedGroupData({ groupId: null, notes: '' });
      await fetchOrders();
      showNotification(t('notifications.statusUpdated'), 'success');
    } catch (error) {
      console.error('Error marking group as ordered:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'),
        'error',
      );
    }
  };

  const handleMarkReceivedGroup = (groupId, groupOrders) => {
    openReceiveForm(groupOrders.filter((o) => showMarkAsReceivedAction(o)), groupId);
  };

  const handleSellProductGroup = async (groupId) => {
    if (!window.confirm(t('confirm.sellProductGroup'))) return;
    try {
      const { data } = await api.post('/orders/sell_product_group/', { order_group: groupId });
      await fetchOrders();
      showNotification(
        t('notifications.sellGroupSuccess', { count: data?.sale_ids?.length ?? 0 }),
        'success',
      );
    } catch (error) {
      console.error('Error selling group from order:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'),
        'error',
      );
    }
  };

  const handleMoveToInventoryGroupFromOrder = async (groupId) => {
    if (!window.confirm(t('confirm.moveGroupToInventory'))) return;
    try {
      const { data } = await api.post('/orders/move_to_inventory_from_order_group/', {
        order_group: groupId,
      });
      await fetchOrders();
      showNotification(
        t('notifications.moveGroupSuccess', { count: data?.order_ids?.length ?? 0 }),
        'success',
      );
    } catch (error) {
      console.error('Error moving group to inventory:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'),
        'error',
      );
    }
  };

  const handleCancelGroup = async (groupId) => {
    if (!canCancelOrder) {
      showNotification(t('notifications.noStatusPermission'), 'error');
      return;
    }
    if (!window.confirm(t('confirm.cancelGroup'))) return;
    try {
      await api.post('/orders/cancel_group/', { order_group: groupId, notes: '' });
      await fetchOrders();
      showNotification(t('notifications.groupCancelled'), 'success');
    } catch (error) {
      console.error('Error cancelling group:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.orderCancelError'),
        'error',
      );
    }
  };

  const handleMoveToInventoryGroup = async (groupId) => {
    try {
      await api.post('/orders/update_status_group/', { order_group: groupId, status: 'in_inventory' });
      await fetchOrders();
      showNotification(t('notifications.statusUpdated'), 'success');
    } catch (error) {
      console.error('Error moving group to inventory:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'),
        'error',
      );
    }
  };

  const handlePayCargoGroup = (groupOrders) => {
    // Cancelled lines never shipped, so they neither need a weight nor take a share of the
    // freight bill — showing them here only invites entering a weight for a phantom parcel.
    const shipped = groupOrders.filter((o) => o.status !== 'cancelled');
    if (!shipped.length) {
      showNotification(t('notifications.statusUpdateError'), 'error');
      return;
    }
    const groupId = shipped[0].order_group;
    const uzsNum = shipped.reduce((sum, o) => sum + (Number(o.cargo_cost_uzs) || 0), 0);
    const usdNum = shipped.reduce((sum, o) => sum + (Number(o.cargo_cost_usd) || 0), 0);
    const lines = shipped.map((o) => ({
      orderId: o.id,
      product_detail: o.product_detail,
      ordered_quantity: o.ordered_quantity,
      received_quantity: o.received_quantity,
      shortfall_status: o.shortfall_status,
      // Settled lines still belong to the shipment and still count toward the weight split,
      // but their weight is history now — shown, not editable.
      cargoIsPaid: Boolean(o.cargo_is_paid),
      paidUzs:
        (Number(o.cargo_payment_uzs_cash) || 0) + (Number(o.cargo_payment_uzs_card) || 0),
      paidUsd:
        (Number(o.cargo_payment_usd_cash) || 0) + (Number(o.cargo_payment_usd_card) || 0),
      weight: o.weight != null ? String(o.weight) : '',
    }));
    setCargoGroupData({
      groupId,
      uzs: uzsNum > 0 ? String(uzsNum) : '',
      usd: usdNum > 0 ? String(usdNum) : '',
      weightTotal: weightToInputValue(sumLineWeights(lines)),
      lines,
    });
    setShowCargoGroupForm(true);
    setTimeout(() => cargoGroupFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const sumLineWeights = (lines) =>
    lines.reduce((sum, l) => sum + (parseFloat(l.weight) || 0), 0);

  /** Trailing zeros in a controlled numeric field are noise; keep it short. */
  const weightToInputValue = (n) => (n > 0 ? String(Number(n.toFixed(2))) : '');

  const updateCargoGroupLineWeight = (orderId, value) => {
    setCargoGroupData((prev) => {
      const lines = prev.lines.map((l) => (l.orderId === orderId ? { ...l, weight: value } : l));
      // Editing a line drives the total, so the two can never disagree.
      return { ...prev, lines, weightTotal: weightToInputValue(sumLineWeights(lines)) };
    });
  };

  /**
   * Typing the shipment's total weight spreads it back down over the lines, keeping the
   * total and the per-line figures in agreement whichever end you type at.
   *
   * Lines whose cargo is already settled keep their recorded weight — it is history, and
   * the backend still counts it in the split — so only the remainder is shared out, in
   * proportion to whatever the editable lines already hold (evenly when they are blank).
   * The last editable line absorbs the rounding remainder so the column adds up exactly.
   */
  const updateCargoGroupTotalWeight = (value) => {
    setCargoGroupData((prev) => {
      const total = parseFloat(value);
      if (!Number.isFinite(total) || total <= 0) {
        // Mid-edit (empty or partial input): leave the lines alone rather than wiping
        // weights the user may have typed by hand.
        return { ...prev, weightTotal: value };
      }

      const editable = prev.lines.filter((l) => !cargoGroupLineLocked(l));
      if (!editable.length) return { ...prev, weightTotal: value };

      const lockedSum = sumLineWeights(prev.lines.filter((l) => cargoGroupLineLocked(l)));
      const available = total - lockedSum;
      if (available <= 0) {
        // Total can't go below what the settled lines already weigh; flag it on submit.
        return { ...prev, weightTotal: value };
      }

      const currentSum = sumLineWeights(editable);
      const round2 = (n) => Math.round(n * 100) / 100;
      const shares = new Map();
      let used = 0;
      editable.forEach((l, i) => {
        const isLast = i === editable.length - 1;
        const share = isLast
          ? round2(available - used)
          : round2(
              currentSum > 0
                ? (available * (parseFloat(l.weight) || 0)) / currentSum
                : available / editable.length,
            );
        shares.set(l.orderId, share);
        used += share;
      });

      return {
        ...prev,
        weightTotal: value,
        lines: prev.lines.map((l) =>
          shares.has(l.orderId) ? { ...l, weight: weightToInputValue(shares.get(l.orderId)) } : l,
        ),
      };
    });
  };

  /** A settled line's weight is history: shown, not editable (only if it has one to show). */
  const cargoGroupLineLocked = (line) => line.cargoIsPaid && (parseFloat(line.weight) || 0) > 0;

  /**
   * Live preview of how cargo will be divided, mirroring the backend's weight split
   * (cargo_allocation_utils.allocate_cargo_for_pool). Shown before submitting so the
   * per-line landed cost is never a surprise after the money has moved.
   *
   * The divided figure is the whole shipment's freight — what you enter here *plus* what
   * was already paid on individual lines — because the backend re-splits the entire pool
   * by weight. That is why an already-paid line's share can still shift here. The last
   * line absorbs the rounding remainder so the column always adds up to the total exactly.
   */
  const cargoGroupSplit = useMemo(() => {
    const lines = cargoGroupData.lines || [];
    const enteredUzs = parseFloat(cargoGroupData.uzs) || 0;
    const enteredUsd = parseFloat(cargoGroupData.usd) || 0;
    const alreadyPaidUzs = lines.reduce((sum, l) => sum + (l.cargoIsPaid ? l.paidUzs || 0 : 0), 0);
    const alreadyPaidUsd = lines.reduce((sum, l) => sum + (l.cargoIsPaid ? l.paidUsd || 0 : 0), 0);
    const totalUzs = enteredUzs + alreadyPaidUzs;
    const totalUsd = enteredUsd + alreadyPaidUsd;

    const weights = lines.map((l) => parseFloat(l.weight) || 0);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    const round2 = (n) => Math.round(n * 100) / 100;
    const perLine = lines.map(() => ({ uzs: 0, usd: 0 }));

    if (totalWeight > 0) {
      let usedUzs = 0;
      let usedUsd = 0;
      lines.forEach((_, i) => {
        const isLast = i === lines.length - 1;
        perLine[i] = isLast
          ? { uzs: round2(totalUzs - usedUzs), usd: round2(totalUsd - usedUsd) }
          : {
              uzs: round2((totalUzs * weights[i]) / totalWeight),
              usd: round2((totalUsd * weights[i]) / totalWeight),
            };
        usedUzs += perLine[i].uzs;
        usedUsd += perLine[i].usd;
      });
    }

    return {
      perLine,
      totalWeight,
      totalUzs,
      totalUsd,
      hasAlreadyPaid: alreadyPaidUzs > 0 || alreadyPaidUsd > 0,
    };
  }, [cargoGroupData]);

  /**
   * True while the typed total and the per-line weights disagree. Normally impossible —
   * editing either end syncs the other — but it surfaces the two cases that cannot be
   * reconciled automatically: a half-typed total, and a total lower than what the
   * already-settled lines weigh.
   */
  const cargoGroupWeightMismatch = useMemo(() => {
    if (!showCargoGroupForm) return false;
    const typed = parseFloat(cargoGroupData.weightTotal);
    if (!Number.isFinite(typed)) {
      // A blank total on a shipment nobody has weighed yet is just an empty form; the
      // "weight is required" check covers that. Only complain once weights exist to contradict.
      return cargoGroupSplit.totalWeight > 0;
    }
    return Math.abs(typed - cargoGroupSplit.totalWeight) > 0.005;
  }, [showCargoGroupForm, cargoGroupData, cargoGroupSplit]);

  const handlePayCargoGroupSubmit = async (e) => {
    e.preventDefault();
    // Locked lines already carry a stored weight, so they can never be the missing one.
    const missingWeight = cargoGroupData.lines.some(
      (l) => !cargoGroupLineLocked(l) && !(l.weight !== '' && l.weight != null && Number(l.weight) > 0),
    );
    if (missingWeight) {
      showNotification(t('batch.errWeightRequiredForCargo', { ns: 'orders' }), 'error');
      return;
    }
    if (cargoGroupWeightMismatch) {
      showNotification(
        t('batch.errWeightTotalMismatch', {
          ns: 'orders',
          sum: formatAppNumber(cargoGroupSplit.totalWeight),
        }),
        'error',
      );
      return;
    }
    try {
      const weights = {};
      for (const l of cargoGroupData.lines) {
        weights[l.orderId] = Number(l.weight);
      }
      await api.post('/orders/pay_cargo_group/', {
        order_group: cargoGroupData.groupId,
        uzs: cargoGroupData.uzs === '' ? 0 : Number(cargoGroupData.uzs) || 0,
        usd: cargoGroupData.usd === '' ? 0 : Number(cargoGroupData.usd) || 0,
        weights,
      });
      setShowCargoGroupForm(false);
      setCargoGroupData({ groupId: null, uzs: '', usd: '', weightTotal: '', lines: [] });
      await fetchOrders();
      showNotification(t('notifications.statusUpdated'), 'success');
    } catch (error) {
      console.error('Error paying group cargo:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'),
        'error',
      );
    }
  };

  const handlePayOrderGroup = async (groupOrders) => {
    const groupId = groupOrders[0].order_group;
    const lines = await Promise.all(
      groupOrders.map(async (o) => {
        let order = o;
        try {
          const res = await api.get(`/orders/${o.id}/`);
          if (res?.data) order = res.data;
        } catch (err) {
          console.warn('Pay order group: could not refresh order detail, using list row', err);
        }
        const pref = prefillPayOrderSimpleTotals(order);
        return {
          orderId: order.id,
          product_detail: order.product_detail,
          ordered_quantity: order.ordered_quantity,
          received_quantity: order.received_quantity,
          shortfall_status: order.shortfall_status,
          uzs: pref.uzs,
          usd: pref.usd,
        };
      }),
    );
    setPayOrderGroupData({ groupId, lines });
    setShowPayOrderGroupForm(true);
    setTimeout(() => payOrderGroupFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const updatePayOrderGroupLine = (orderId, field, value) => {
    setPayOrderGroupData((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.orderId === orderId ? { ...l, [field]: value } : l)),
    }));
  };

  const handlePayOrderGroupSubmit = async (e) => {
    e.preventDefault();
    try {
      await fetchBalances();
      let totalUzs = 0;
      let totalUsd = 0;
      for (const l of payOrderGroupData.lines) {
        totalUzs += parseFloat(l.uzs) || 0;
        totalUsd += parseFloat(l.usd) || 0;
      }
      if (totalUzs > 0 && !ledgerHasFunds('UZS', totalUzs)) {
        showNotification(formatInsufficientLedgerMessage('UZS', getAvailableBalance('UZS'), totalUzs), 'error');
        return;
      }
      if (totalUsd > 0 && !ledgerHasFunds('USD', totalUsd)) {
        showNotification(formatInsufficientLedgerMessage('USD', getAvailableBalance('USD'), totalUsd), 'error');
        return;
      }
      await api.post('/orders/pay_order_group/', {
        order_group: payOrderGroupData.groupId,
        lines: payOrderGroupData.lines.map((l) => ({
          order_id: l.orderId,
          uzs: parseFloat(l.uzs) || 0,
          usd: parseFloat(l.usd) || 0,
        })),
      });
      setShowPayOrderGroupForm(false);
      setPayOrderGroupData({ groupId: null, lines: [] });
      await fetchOrders();
      showNotification(t('notifications.statusUpdated'), 'success');
    } catch (error) {
      console.error('Error paying group order cost:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.statusUpdateError'),
        'error',
      );
    }
  };

  const handleCancelOrder = async (orderId) => {
    if (!canCancelOrder) {
      showNotification(t('notifications.noCancelPermission'), 'error');
      return;
    }
    if (!window.confirm(t('confirm.cancelOrder', { id: orderId }))) {
      return;
    }
    try {
      await api.post(`/orders/${orderId}/cancel/`, { notes: '' });
      await fetchOrders();
      showNotification(t('notifications.orderCancelled'), 'success');
    } catch (error) {
      console.error('Error cancelling order:', error);
      showNotification(
        error.response?.data?.error || error.response?.data?.detail || t('notifications.orderCancelError'),
        'error',
      );
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    if (!paymentFormData.is_pay_order && !String(paymentFormData.status_notes || '').trim()) {
      showNotification(t('notifications.notesRequired'), 'error');
      return;
    }
    try {
      // Check if this is for paying order separately
      if (paymentFormData.is_pay_order) {
        const uzs = parseFloat(paymentFormData.uzs) || 0;
        const usd = parseFloat(paymentFormData.usd) || 0;
        const orderForPay = orders.find((o) => o.id === paymentFormData.orderId);
        const isClientPay = orderForPay && isClientEshopSlug(orderForPay.eshop);
        if (uzs + usd === 0 && !isClientPay) {
          showNotification(t('notifications.paymentAmountRequired'), 'error');
          return;
        }
        await fetchBalances();
        if (uzs > 0 && !ledgerHasFunds('UZS', uzs)) {
          showNotification(formatInsufficientLedgerMessage('UZS', getAvailableBalance('UZS'), uzs), 'error');
          return;
        }
        if (usd > 0 && !ledgerHasFunds('USD', usd)) {
          showNotification(formatInsufficientLedgerMessage('USD', getAvailableBalance('USD'), usd), 'error');
          return;
        }
        if (orderForPay) {
          const confirmed = isClientPay
            ? confirmClientOrderPay(orderForPay, uzs, usd, t)
            : confirmOrderPayTotalsIfMismatch(orderForPay, uzs, usd, t);
          if (!confirmed) {
            return;
          }
        }
        const paidOrderId = paymentFormData.orderId;
        const res = await api.post(`/orders/${paidOrderId}/pay_order/`, { uzs, usd });
        const paidStatus = res.data?.status || 'order_paid';
        setOrders((prev) => {
          const next = prev.map((o) =>
            o.id === paidOrderId
              ? {
                  ...o,
                  status: paidStatus,
                  order_is_paid: true,
                  has_ever_been_received:
                    o.has_ever_been_received || o.status === 'received',
                }
              : o,
          );
          applyFilters(next);
          return next;
        });
        setShowPaymentForm(false);
        setPaymentFormData({ orderId: null, uzs: '', usd: '', is_pay_order: false, is_received_and_pay: false, status_notes: '' });
        await fetchOrders();
        showNotification(t('notifications.orderPaidSuccess'), 'success');
        return;
      }
      
      // Otherwise, handle status update with payment (for "Move to Inventory & Pay")
      const order = orders.find(o => o.id === paymentFormData.orderId);
      const targetStatus = paymentFormData.is_received_and_pay ? 'received' : 'in_inventory';
      
      // Check if order is already paid - if so, don't send payment info again
      const isAlreadyPaid = order?.order_is_paid;

      // Check balances before submitting (only if not already paid)
      if (!isAlreadyPaid) {
        const uzs = parseFloat(paymentFormData.uzs) || 0;
        const usd = parseFloat(paymentFormData.usd) || 0;
        if (uzs + usd === 0) {
          showNotification(t('notifications.paymentAmountRequired'), 'error');
          return;
        }
        await fetchBalances();
        if (uzs > 0 && !ledgerHasFunds('UZS', uzs)) {
          showNotification(formatInsufficientLedgerMessage('UZS', getAvailableBalance('UZS'), uzs), 'error');
          return;
        }
        if (usd > 0 && !ledgerHasFunds('USD', usd)) {
          showNotification(formatInsufficientLedgerMessage('USD', getAvailableBalance('USD'), usd), 'error');
          return;
        }
      }

      // Build update payload
      const updatePayload = {
        status: targetStatus,
        notes: String(paymentFormData.status_notes).trim(),
      };

      // Only send payment info if order is not already paid
      if (!isAlreadyPaid) {
        updatePayload.uzs = parseFloat(paymentFormData.uzs) || 0;
        updatePayload.usd = parseFloat(paymentFormData.usd) || 0;
        updatePayload.order_is_paid = true;
      }

      // Update order status
      await api.post(`/orders/${paymentFormData.orderId}/update_status/`, updatePayload);

      // Refresh orders to get updated status
      await fetchOrders();

      setShowPaymentForm(false);
      setPaymentFormData({ orderId: null, uzs: '', usd: '', is_pay_order: false, is_received_and_pay: false, status_notes: '' });
      showNotification(t('notifications.paymentSuccess'), 'success');
    } catch (error) {
      console.error('Error updating order payment:', error);
      showNotification(error.response?.data?.error || error.response?.data?.detail || t('notifications.paymentUpdateError'), 'error');
    }
  };

  const handleCargoPaymentSubmit = async (e) => {
    e.preventDefault();
    try {
      const uzs = parseFloat(cargoFormData.uzs) || 0;
      const usd = parseFloat(cargoFormData.usd) || 0;
      const weight = parseFloat(cargoFormData.weight) || 0;
      if (weight <= 0) {
        showNotification(t('notifications.cargoWeightRequired'), 'error');
        return;
      }

      await fetchBalances();
      if (uzs > 0 && !ledgerHasFunds('UZS', uzs)) {
        showNotification(
          formatInsufficientLedgerMessage('UZS', getAvailableBalance('UZS'), uzs, { topUpSuffix: true }),
          'error',
        );
        return;
      }
      if (usd > 0 && !ledgerHasFunds('USD', usd)) {
        showNotification(
          formatInsufficientLedgerMessage('USD', getAvailableBalance('USD'), usd, { topUpSuffix: true }),
          'error',
        );
        return;
      }

      const cargoOrder = orders.find((o) => o.id === cargoFormData.orderId);
      if (!confirmCargoPaymentIfNeeded(cargoOrder, uzs, usd, t)) {
        return;
      }

      const res = await api.post(`/orders/${cargoFormData.orderId}/pay_cargo/`, { uzs, usd, weight });
      setShowCargoForm(false);
      setCargoFormData({ orderId: null, uzs: '', usd: '', weight: '' });
      await fetchOrders();
      showNotification(res.data?.message || t('notifications.cargoPaidSuccess'), 'success');
    } catch (error) {
      console.error('Error paying cargo:', error);
      showNotification(error.response?.data?.error || error.response?.data?.detail || t('notifications.cargoPayError'), 'error');
    }
  };

  /**
   * Creates pending sale from on-demand order (table “Sell the Product” button only).
   * @returns {Promise<boolean>}
   */
  const sellProductFromOrder = async (orderId, { confirm: showConfirm = true } = {}) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return false;

    if (!order.order_is_paid) {
      showNotification(t('notifications.payOrderBeforeSell'), 'error');
      return false;
    }
    if (!order.cargo_is_paid) {
      showNotification(t('notifications.payCargoBeforeSell'), 'error');
      return false;
    }

    if (showConfirm) {
      const ok = window.confirm(t('confirm.sellProduct', { id: orderId }));
      if (!ok) return false;
    }

    try {
      const response = await api.post(`/orders/${orderId}/sell_product/`);
      showNotification(
        response.data.message || t('notifications.saleCreated'),
        'success',
      );
      await fetchOrders();
      return true;
    } catch (error) {
      console.error('Error selling product:', error);
      showNotification(error.response?.data?.error || error.response?.data?.detail || t('notifications.sellError'), 'error');
      return false;
    }
  };

  const handleSellProduct = async (orderId) => {
    await sellProductFromOrder(orderId, { confirm: true });
  };

  const handleMoveToInventoryFromOrder = async (orderId) => {
    const order = orders.find(o => o.id === orderId);

    if (!order?.order_is_paid) {
      showNotification(t('notifications.payBeforeInventory'), 'error');
      return;
    }

    if (!order?.cargo_is_paid) {
      showNotification(t('notifications.cargoBeforeInventory'), 'error');
      return;
    }
    
    if (order && order.advance_payment_amount && order.advance_payment_amount > 0) {
      const advCur = order.advance_payment_currency
        ? String(order.advance_payment_currency).toUpperCase()
        : 'USD';
      setMoveToInventoryData({
        orderId: orderId,
        return_advance: true,
        return_payment_currency: advCur === 'UZS' ? 'UZS' : 'USD',
        return_advance_amount:
          order.advance_payment_amount != null && order.advance_payment_amount !== ''
            ? String(Number(order.advance_payment_amount))
            : '',
      });
      setShowMoveToInventoryForm(true);
      setTimeout(() => moveToInventoryFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } else {
      // No advance payment, just move to inventory
      await moveToInventoryFromOrder(orderId, { return_advance: false });
    }
  };

  const moveToInventoryFromOrder = async (orderId, options = {}) => {
    const returnAdvance = !!options.return_advance;
    try {
      const payload = { return_advance: returnAdvance };
      if (returnAdvance) {
        const ccy = String(options.return_payment_currency || 'USD').toUpperCase();
        payload.return_payment_currency = ccy === 'UZS' ? 'UZS' : 'USD';
        if (options.return_advance_amount != null && Number.isFinite(options.return_advance_amount)) {
          payload.return_advance_amount = options.return_advance_amount;
        }
      }
      await api.post(`/orders/${orderId}/move_to_inventory_from_order/`, payload);
      setShowMoveToInventoryForm(false);
      setMoveToInventoryData({
        orderId: null,
        return_advance: false,
        return_payment_currency: 'USD',
        return_advance_amount: '',
      });
      await fetchOrders();
      showNotification(t('notifications.movedToInventory'), 'success');
    } catch (error) {
      console.error('Error moving to inventory:', error);
      showNotification(error.response?.data?.error || error.response?.data?.detail || t('notifications.moveInventoryError'), 'error');
    }
  };

  const handleMoveToInventorySubmit = async (e) => {
    e.preventDefault();

    const invOrder = orders.find((o) => o.id === moveToInventoryData.orderId);
    if (invOrder && invOrder.advance_payment_amount > 0) {
      const booked = parseFloat(invOrder.advance_payment_amount) || 0;
      const amt = parseFloat(String(moveToInventoryData.return_advance_amount ?? '').trim()) || 0;
      if (!(amt > 0)) {
        showNotification(t('notifications.advanceReturnRequired'), 'error');
        return;
      }
      const ccy = moveToInventoryData.return_payment_currency === 'UZS' ? 'UZS' : 'USD';
      const bookedCur = invOrder.advance_payment_currency
        ? String(invOrder.advance_payment_currency).toUpperCase()
        : 'USD';
      if (ccy === bookedCur && amt > booked) {
        showNotification(t('notifications.advanceReturnExceeds', { booked }), 'error');
        return;
      }
      if (!ledgerHasFunds(ccy, amt)) {
        showNotification(formatInsufficientLedgerMessage(ccy, getAvailableBalance(ccy), amt), 'error');
        return;
      }
      const bookedAdvLabel = formatDisplayAmount(
        booked,
        invOrder.advance_payment_currency ? String(invOrder.advance_payment_currency).toUpperCase() : 'USD',
      );
      const payingLabel = formatDisplayAmount(amt, ccy);
      const ok = window.confirm(
        t('confirm.returnAdvance', {
          id: invOrder.id,
          booked: bookedAdvLabel,
          paying: payingLabel,
        }),
      );
      if (!ok) return;
    }
    await moveToInventoryFromOrder(moveToInventoryData.orderId, {
      return_advance: true,
      return_payment_currency: moveToInventoryData.return_payment_currency,
      return_advance_amount:
        parseFloat(String(moveToInventoryData.return_advance_amount ?? '').trim()) || undefined,
    });
  };

  /**
   * Context strip for the per-line action forms.
   *
   * These forms are opened from a single row, and since every workflow button is now
   * available per line inside an expanded multi-item order, the form alone gave no clue
   * which item you were about to spend money on. Shows what you need to sanity-check the
   * amount before submitting: the item, how much of it actually arrived, what was planned,
   * and what has already been settled.
   */
  const renderOrderContextCard = (orderId, { showCargo = false } = {}) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;

    const plannedSupplier = plannedSupplierTotal(order);
    const plannedCargoUzs = parseFloat(order.cargo_cost_uzs) || 0;
    const plannedCargoUsd = parseFloat(order.cargo_cost_usd) || 0;
    const weight = parseFloat(order.weight) || 0;

    const badge = (label, ok) => (
      <span
        style={{
          padding: '1px 6px',
          borderRadius: '8px',
          backgroundColor: ok ? '#4caf50' : '#bdbdbd',
          color: '#fff',
          fontSize: '0.78em',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    );

    const row = (label, value) => (
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ color: '#777' }}>{label}:</span>
        <span>{value}</span>
      </div>
    );

    return (
      <div
        style={{
          border: '1px solid #e0e0e0',
          borderLeft: '4px solid #1976d2',
          borderRadius: '4px',
          padding: '10px 12px',
          marginBottom: '16px',
          backgroundColor: '#fafafa',
          fontSize: '0.9em',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ fontWeight: 'bold' }}>
          #{order.id} — {productOrderPickerLabel(order.product_detail, t)}
        </div>
        {order.product_detail?.category
          ? row(t('form.category'), order.product_detail.category)
          : null}
        {row(
          t('batch.qty', { ns: 'orders' }),
          renderQuantityCell(
            order.ordered_quantity,
            order.received_quantity,
            order.shortfall_status,
            t,
          ),
        )}
        {showCargo
          ? row(
              t('context.plannedCargo', { ns: 'orders' }),
              plannedCargoUzs > 0 || plannedCargoUsd > 0 ? (
                [
                  plannedCargoUzs > 0 ? formatDisplayAmount(plannedCargoUzs, 'UZS') : null,
                  plannedCargoUsd > 0 ? formatDisplayAmount(plannedCargoUsd, 'USD') : null,
                ]
                  .filter(Boolean)
                  .join(' + ')
              ) : (
                <span style={{ color: '#999' }}>—</span>
              ),
            )
          : row(
              t('context.plannedCost', { ns: 'orders' }),
              plannedSupplier || <span style={{ color: '#999' }}>—</span>,
            )}
        {showCargo && weight > 0
          ? row(t('batch.weightKgTotal', { ns: 'orders' }), `${formatAppNumber(weight)} kg`)
          : null}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
          {badge(
            order.order_is_paid
              ? t('context.orderPaid', { ns: 'orders' })
              : t('context.orderUnpaid', { ns: 'orders' }),
            order.order_is_paid,
          )}
          {badge(
            order.cargo_is_paid
              ? t('context.cargoPaid', { ns: 'orders' })
              : t('context.cargoUnpaid', { ns: 'orders' }),
            order.cargo_is_paid,
          )}
        </div>
      </div>
    );
  };

  // Every workflow button is per-line, including inside an expanded multi-item order: one
  // item can be paid, received short, or cancelled without waiting on its siblings. The
  // group row's buttons are a convenience for doing the same thing to all of them at once.
  const renderOrderRow = (order, rowKey, extraClassName) => {
    const plannedSellingLabel = plannedSellingSummary(order);
    const plannedSupplierTotalLabel = plannedSupplierTotal(order);
    const eshopLabel = formatEshopDisplay(order.eshop, t);
    const cargoPool = cargoPoolTotals(order, orders);
    const cargoUnits = cargoUnitCosts(order);
    const lineCargoUzs = parseFloat(order.allocated_cargo_cost_uzs) || 0;
    const lineCargoUsd = parseFloat(order.allocated_cargo_cost_usd) || 0;
    const steps = availableOrderSteps(order);
    return (
      <tr key={rowKey ?? order.id} className={extraClassName}>
        <td>#{order.id}</td>
        <td>{formatAppDateTime(order.order_date || order.created_at)}</td>
        <td>
          {/* `availableOrderSteps` decides which workflow buttons this row is waiting on —
              one at a time, except receiving and paying the supplier which are offered
              together. Corrections below (edit cargo, short delivery, cancel) are not steps
              and stay independently visible. */}
          {steps.includes('mark_ordered') && canMarkAsOrdered && (
            <button
              className="btn-status"
              onClick={() => handleMarkAsOrdered(order.id)}
              style={{ marginRight: '5px' }}
            >
              {t('actions.markAsOrdered', { ns: 'orders' })}
            </button>
          )}
          {steps.includes('mark_received') && canUpdateStatus && (
            <button
              className="btn-status"
              onClick={() => handleMarkReceived(order.id)}
              style={{ marginRight: '5px' }}
            >
              {t('actions.markReceived', { ns: 'orders' })}
            </button>
          )}
          {steps.includes('pay_order') && canPayOrder && (
            <button
              className="btn-status"
              onClick={() => handlePayOrder(order)}
              style={{ marginRight: '5px' }}
            >
              {t('actions.payOrder', { ns: 'orders' })}
            </button>
          )}
          {steps.includes('pay_cargo') && canPayCargo && (
            <button
              className="btn-status"
              onClick={() => handlePayCargo(order.id)}
              style={{ marginRight: '5px' }}
            >
              {t('actions.payCargo', { ns: 'orders' })}
            </button>
          )}
          {order.shortfall_status === 'pending' && canUpdateStatus && (
            <button
              className="btn-status"
              onClick={() => handleReceiveRemaining(order)}
              style={{ marginRight: '5px' }}
            >
              {t('actions.receiveRemaining', { ns: 'orders' })}
            </button>
          )}
          {/* Unpaid: refund and write-off are the same act — stop billing for what never
              came — so a single neutral button avoids a false choice. */}
          {order.shortfall_status === 'pending' && canPayOrder && !order.order_is_paid && (
            <button
              className="btn-status"
              onClick={() => handleResolveShortfall(order, 'refunded')}
              style={{ marginRight: '5px' }}
            >
              {t('actions.dropFromBill', { ns: 'orders' })}
            </button>
          )}
          {order.shortfall_status === 'pending' && canPayOrder && order.order_is_paid && (
            <>
              <button
                className="btn-status"
                onClick={() => handleResolveShortfall(order, 'refunded')}
                style={{ marginRight: '5px' }}
              >
                {t('actions.markRefunded', { ns: 'orders' })}
              </button>
              <button
                className="btn-status"
                onClick={() => handleResolveShortfall(order, 'written_off')}
                style={{ marginRight: '5px', backgroundColor: '#f44336' }}
              >
                {t('actions.writeOff', { ns: 'orders' })}
              </button>
            </>
          )}
          {canCancelOrder && !ORDER_TERMINAL_STATUSES.has(order.status) && (
            <button
              className="btn-edit"
              onClick={() => handleCancelOrder(order.id)}
              style={{ marginRight: '5px', backgroundColor: '#f44336', color: 'white' }}
            >
              {t('actions.cancelOrder', { ns: 'orders' })}
            </button>
          )}
          {steps.includes('finalize') &&
            order.order_type === 'stock' &&
            canMoveInventory && (
            <button
              className="btn-status"
              onClick={() => handleStatusUpdate(order.id, 'in_inventory')}
              style={{ marginRight: '5px' }}
            >
              {t('actions.moveToInventory', { ns: 'orders' })}
            </button>
          )}
          {/* Still per-line as well as group-wide: a customer can buy some items from a
              multi-item on_demand order and decline others. */}
          {steps.includes('finalize') &&
            order.order_type === 'on_demand' &&
            !order.has_sale && (
            <>
              {canSellProduct && (
              <button
                className="btn-status"
                onClick={() => handleSellProduct(order.id)}
                style={{ marginRight: '5px', backgroundColor: '#4caf50', color: 'white' }}
              >
                {t('actions.sellProduct', { ns: 'orders' })}
              </button>
              )}
              {canMoveInventory && (
              <button
                className="btn-status"
                onClick={() => handleMoveToInventoryFromOrder(order.id)}
                style={{ backgroundColor: '#2196f3', color: 'white' }}
              >
                {t('actions.moveToInventory', { ns: 'orders' })}
              </button>
              )}
            </>
          )}
        </td>
        <td>
          <span className={`status-badge ${order.status}`}>
            {formatOrderStatus(order.status, tStatus)}
          </span>
        </td>
        <td>
          {categoryTypeLabel(order.product_detail?.category_type, t) || (
            <span style={{ color: '#999' }}>—</span>
          )}
        </td>
        <td>{order.product_detail?.category || <span style={{ color: '#999' }}>—</span>}</td>
        <td>{order.product_detail?.brand || '-'}</td>
        <td>{order.product_detail?.model || '-'}</td>
        <td><strong>{order.product_detail?.size || '-'}</strong></td>
        <td><strong>{order.product_detail?.color || '-'}</strong></td>
        <td>{order.supplier_country || <span style={{ color: '#999' }}>—</span>}</td>
        <td>{order.supplier_cargo || <span style={{ color: '#999' }}>—</span>}</td>
        <td title={order.client_eshop_notes ? String(order.client_eshop_notes) : eshopLabel || ''}>
          {eshopLabel ? (
            <span>{eshopLabel}</span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        {canSeeStockOrders && (
        <td>
          <span className={`status-badge ${order.order_type === 'stock' ? 'confirmed' : 'pending'}`}>
            {orderTypeShortLabel(order.order_type, t)}
          </span>
        </td>
        )}
        <td>
          {order.order_type === 'on_demand' ? (
            order.customer_detail ? (
              <div>
                <strong>{order.customer_detail.name}</strong>
                {order.customer_detail.telephone && (
                  <div style={{ fontSize: '0.82em', color: '#666' }}>{order.customer_detail.telephone}</div>
                )}
                {order.advance_payment_amount > 0 && (
                  <div style={{ fontSize: '0.82em', color: '#4caf50' }}>
                    {t('table.advance', { ns: 'orders' })}{' '}
                    {formatDisplayAmount(
                      order.advance_payment_amount,
                      order.advance_payment_currency || 'USD',
                    )}
                  </div>
                )}
              </div>
            ) : (
              <span style={{ color: '#f44336', fontSize: '0.85em' }}>{t('table.noCustomer', { ns: 'orders' })}</span>
            )
          ) : (
            <span style={{ color: '#aaa' }}>—</span>
          )}
        </td>
        <td>
          {renderQuantityCell(
            order.ordered_quantity,
            order.received_quantity,
            order.shortfall_status,
            t,
          )}
        </td>
        <td>
          {parseFloat(order.weight) > 0 ? (
            `${formatAppNumber(parseFloat(order.weight))} kg`
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td title={plannedSellingLabel || ''}>
          {plannedSellingLabel ? (
            <span>{plannedSellingLabel}</span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td>{plannedSupplierPerUnit(order)}</td>
        <td title={plannedSupplierTotalLabel || ''}>
          {plannedSupplierTotalLabel ? (
            <span>{plannedSupplierTotalLabel}</span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td>
          {(() => {
            const v = (parseFloat(order.order_payment_uzs_cash) || 0) + (parseFloat(order.order_payment_uzs_card) || 0);
            return v > 0 ? <span style={{ color: order.order_is_paid ? '#4caf50' : 'inherit' }}>{formatAppNumber(v)} {uzsLabel}</span> : <span style={{ color: '#bbb' }}>—</span>;
          })()}
        </td>
        <td>
          {(() => {
            const v = (parseFloat(order.order_payment_usd_cash) || 0) + (parseFloat(order.order_payment_usd_card) || 0);
            return v > 0 ? <span style={{ color: order.order_is_paid ? '#4caf50' : 'inherit' }}>${v.toFixed(2)}</span> : <span style={{ color: '#bbb' }}>—</span>;
          })()}
        </td>
        <td>
          {lineCargoUzs > 0 ? (
            <span style={{ color: order.cargo_is_paid ? '#4caf50' : 'inherit' }}>
              {formatAppNumber(lineCargoUzs)} {uzsLabel}
              {cargoPool.lineCount > 1 && (
                <div style={{ fontSize: '0.78em', color: '#888', fontWeight: 400 }}>
                  {t('table.cargoPoolTotalLabel', { ns: 'orders' })}: {formatAppNumber(cargoPool.uzs)} {uzsLabel}
                </div>
              )}
            </span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td>
          {lineCargoUsd > 0 ? (
            <span style={{ color: order.cargo_is_paid ? '#4caf50' : 'inherit' }}>
              ${lineCargoUsd.toFixed(2)}
              {cargoPool.lineCount > 1 && (
                <div style={{ fontSize: '0.78em', color: '#888', fontWeight: 400 }}>
                  {t('table.cargoPoolTotalLabel', { ns: 'orders' })}: ${cargoPool.usd.toFixed(2)}
                </div>
              )}
            </span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td>
          {lineCargoUzs > 0 ? (
            <span>
              {formatAppNumber(cargoUnits.unitUzs)} {uzsLabel}/{t('table.perUnitSuffix', { ns: 'orders' })}
              {cargoUnits.kgUzs > 0 && (
                <div style={{ color: '#888' }}>
                  {formatAppNumber(cargoUnits.kgUzs)} {uzsLabel}/kg
                </div>
              )}
            </span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td>
          {lineCargoUsd > 0 ? (
            <span>
              ${cargoUnits.unitUsd.toFixed(2)}/{t('table.perUnitSuffix', { ns: 'orders' })}
              {cargoUnits.kgUsd > 0 && (
                <div style={{ color: '#888' }}>
                  ${cargoUnits.kgUsd.toFixed(2)}/kg
                </div>
              )}
            </span>
          ) : (
            <span style={{ color: '#bbb' }}>—</span>
          )}
        </td>
        <td>{order.created_by_detail?.username || '-'}</td>
        <td>
          {(() => {
            const label = formatOrderedNoteDisplay(order);
            return label ? (
              <span title={label}>{label}</span>
            ) : (
              <span style={{ color: '#bbb' }}>—</span>
            );
          })()}
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
        <PageTitle ns="orders" />
        {(canManageStockOrders || canCreateOrder) && (
          <button
            className="btn-primary"
            onClick={() => {
              const next = !showBatchForm;
              setShowBatchForm(next);
              if (next) {
                setBatchShared({
                  order_type: canManageStockOrders ? 'stock' : 'on_demand',
                  supplier_country: '', supplier_cargo: '', customer: '',
                });
                setBatchLines([newBatchLine()]);
              }
            }}
          >
            {showBatchForm ? t('actions.cancel', { ns: 'common' }) : t('batch.newButton', { ns: 'orders' })}
          </button>
        )}
      </div>

      {/* Notification */}
      {notification.show && (
        <div
          style={{
            position: 'fixed',
            top: '80px',
            right: '20px',
            zIndex: 9999,
            padding: '15px 25px',
            borderRadius: '8px',
            backgroundColor: notification.type === 'success' ? '#4caf50' : notification.type === 'error' ? '#f44336' : '#2196f3',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxWidth: '400px',
            animation: 'slideIn 0.3s ease-out',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          <span style={{ fontSize: '20px' }}>
            {notification.type === 'success' ? '✓' : notification.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification({ show: false, message: '', type: 'success' })}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '0',
              lineHeight: '1',
            }}
          >
            ×
          </button>
        </div>
      )}

      {showPaymentForm && (
        <div
          className="form-card"
          style={{ marginBottom: '20px' }}
          ref={paymentFormRef}
          key={`pay-form-${paymentFormData.orderId}-${paymentFormData.is_pay_order}`}
        >
          <h2>
            {paymentFormData.is_pay_order
              ? t('paymentForm.payOrderTitle')
              : paymentFormData.is_received_and_pay
                ? t('paymentForm.receivedAndPayTitle')
                : t('paymentForm.moveAndPayTitle')}
          </h2>
          {renderOrderContextCard(paymentFormData.orderId)}
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('paymentForm.intro')}
          </p>
          <form onSubmit={handlePaymentSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{uzsLabel}</label>
                <input type="number" step="0.01" min="0" placeholder="0"
                  value={paymentFormData.uzs}
                  onChange={(e) => setPaymentFormData({ ...paymentFormData, uzs: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t('currency.usd', { ns: 'common' })}</label>
                <input type="number" step="0.01" min="0" placeholder="0"
                  value={paymentFormData.usd}
                  onChange={(e) => setPaymentFormData({ ...paymentFormData, usd: e.target.value })} />
              </div>
              {!paymentFormData.is_pay_order && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>{t('paymentForm.notes')} *</label>
                  <textarea
                    rows={3}
                    value={paymentFormData.status_notes}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, status_notes: e.target.value })}
                    required
                  />
                </div>
              )}
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {paymentFormData.is_pay_order
                  ? t('actions.payOrder', { ns: 'orders' })
                  : paymentFormData.is_received_and_pay
                    ? t('actions.markReceivedAndPay', { ns: 'orders' })
                    : t('actions.confirmMoveToInventory', { ns: 'orders' })}
              </button>
              <button type="button" className="btn-edit"
                onClick={() => {
                  setShowPaymentForm(false);
                  setPaymentFormData({ orderId: null, uzs: '', usd: '', is_pay_order: false, is_received_and_pay: false, status_notes: '' });
                }}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {showMoveToInventoryForm && (
        <div className="form-card" style={{ marginBottom: '20px' }} ref={moveToInventoryFormRef}>
          <h2>{t('moveForm.title', { id: moveToInventoryData.orderId })}</h2>
          {renderOrderContextCard(moveToInventoryData.orderId)}
          <form onSubmit={handleMoveToInventorySubmit}>
            <div className="form-grid">
              {(() => {
                const invOrder = orders.find((o) => o.id === moveToInventoryData.orderId);
                if (invOrder && invOrder.advance_payment_amount > 0) {
                  return (
                    <>
                      <p style={{ gridColumn: '1 / -1', color: '#555', margin: 0, fontSize: '0.92em' }}>
                        {t('moveForm.returnAdvance')}{' '}
                        <strong>
                          {formatDisplayAmount(
                            invOrder.advance_payment_amount,
                            invOrder.advance_payment_currency || 'USD',
                          )}
                        </strong>
                      </p>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <div
                          style={{
                            display: 'inline-flex',
                            flexWrap: 'wrap',
                            gap: '14px',
                            alignItems: 'flex-end',
                          }}
                        >
                          <div className="form-group" style={{ marginBottom: 0, width: '11rem', maxWidth: '100%' }}>
                            <label htmlFor="move-inv-return-amt">{t('moveForm.amount')}</label>
                            <input
                              id="move-inv-return-amt"
                              type="number"
                              step="0.01"
                              min="0"
                              style={{ width: '100%', boxSizing: 'border-box', display: 'block', marginTop: '4px' }}
                              value={moveToInventoryData.return_advance_amount}
                              onChange={(e) =>
                                setMoveToInventoryData({ ...moveToInventoryData, return_advance_amount: e.target.value })
                              }
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, minWidth: '7rem', width: '7.5rem' }}>
                            <label htmlFor="move-inv-return-ccy">{t('moveForm.currency')}</label>
                            <select
                              id="move-inv-return-ccy"
                              value={moveToInventoryData.return_payment_currency}
                              onChange={(e) =>
                                setMoveToInventoryData({
                                  ...moveToInventoryData,
                                  return_payment_currency: e.target.value === 'UZS' ? 'UZS' : 'USD',
                                })
                              }
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                boxSizing: 'border-box',
                                marginTop: '4px',
                              }}
                            >
                              <option value="USD">USD</option>
                              <option value="UZS">UZS</option>
                            </select>
                          </div>
                        </div>
                        <p style={{ margin: '8px 0 0', fontSize: '0.82em', color: '#666' }}>
                          {t('moveForm.advanceHint')}
                        </p>
                      </div>
                    </>
                  );
                }
                return null;
              })()}
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('actions.moveToInventory', { ns: 'orders' })}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowMoveToInventoryForm(false);
                  setMoveToInventoryData({
                    orderId: null,
                    return_advance: false,
                    return_payment_currency: 'USD',
                    return_advance_amount: '',
                  });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {showCargoForm && (
        <div className="form-card" style={{ marginBottom: '20px' }} ref={cargoFormRef}>
          <h2>{t('cargoForm.title', { id: cargoFormData.orderId })}</h2>
          {renderOrderContextCard(cargoFormData.orderId, { showCargo: true })}
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('cargoForm.intro')}
          </p>
          <form onSubmit={handleCargoPaymentSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{uzsLabel}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  value={cargoFormData.uzs}
                  onChange={(e) => setCargoFormData({ ...cargoFormData, uzs: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('currency.usd', { ns: 'common' })}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  value={cargoFormData.usd}
                  onChange={(e) => setCargoFormData({ ...cargoFormData, usd: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>
                  {t('batch.weightKgTotal', { ns: 'orders' })} <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={cargoFormData.weight}
                  onChange={(e) => setCargoFormData({ ...cargoFormData, weight: e.target.value })}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('actions.payCargo', { ns: 'orders' })}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowCargoForm(false);
                  setCargoFormData({ orderId: null, uzs: '', usd: '', weight: '' });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {showMarkOrderedForm && canMarkAsOrdered && (() => {
        const markOrderedOrder = orders.find((o) => o.id === markOrderedFormData.orderId);
        const markOrderedNotesRequired = markOrderedOrder?.supplier_country === PURCHASING_AGENT_SUPPLIER_COUNTRY;
        return (
        <div className="form-card" style={{ marginBottom: '20px' }} ref={markOrderedFormRef}>
          <h2>{t('markOrderedForm.title', { id: markOrderedFormData.orderId })}</h2>
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('markOrderedForm.intro')}
          </p>
          <form onSubmit={handleMarkAsOrderedSubmit}>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('markOrderedForm.notes')}{markOrderedNotesRequired ? ' *' : ''}</label>
                <textarea
                  rows={3}
                  required={markOrderedNotesRequired}
                  value={markOrderedFormData.notes}
                  onChange={(e) => setMarkOrderedFormData({ ...markOrderedFormData, notes: e.target.value })}
                  placeholder={t('markOrderedForm.notesPlaceholder')}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('actions.markAsOrdered', { ns: 'orders' })}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowMarkOrderedForm(false);
                  setMarkOrderedFormData({ orderId: null, notes: '' });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
        );
      })()}

      {showMarkOrderedGroupForm && canMarkAsOrdered && (() => {
        const markOrderedGroupOrder = orders.find((o) => o.order_group === markOrderedGroupData.groupId);
        const markOrderedGroupNotesRequired = markOrderedGroupOrder?.supplier_country === PURCHASING_AGENT_SUPPLIER_COUNTRY;
        return (
        <div className="form-card" style={{ marginBottom: '20px' }} ref={markOrderedGroupFormRef}>
          <h2>{t('batch.markOrderedGroupTitle', { ns: 'orders' })}</h2>
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('markOrderedForm.intro')}
          </p>
          <form onSubmit={handleMarkAsOrderedGroupSubmit}>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('markOrderedForm.notes')}{markOrderedGroupNotesRequired ? ' *' : ''}</label>
                <textarea
                  rows={3}
                  required={markOrderedGroupNotesRequired}
                  value={markOrderedGroupData.notes}
                  onChange={(e) => setMarkOrderedGroupData({ ...markOrderedGroupData, notes: e.target.value })}
                  placeholder={t('markOrderedForm.notesPlaceholder')}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('actions.markAsOrdered', { ns: 'orders' })}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowMarkOrderedGroupForm(false);
                  setMarkOrderedGroupData({ groupId: null, notes: '' });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
        );
      })()}

      {showCargoGroupForm && (
        <div className="form-card" style={{ marginBottom: '20px' }} ref={cargoGroupFormRef}>
          <h2>{t('batch.payCargoGroupTitle', { ns: 'orders' })}</h2>
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('batch.payCargoGroupIntro', { ns: 'orders' })}
          </p>
          <form onSubmit={handlePayCargoGroupSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{uzsLabel}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  value={cargoGroupData.uzs}
                  onChange={(e) => setCargoGroupData({ ...cargoGroupData, uzs: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('currency.usd', { ns: 'common' })}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  value={cargoGroupData.usd}
                  onChange={(e) => setCargoGroupData({ ...cargoGroupData, usd: e.target.value })}
                />
              </div>
            </div>
            <p style={{ color: '#666', margin: '4px 0 8px', fontSize: '0.9em' }}>
              {t('batch.cargoWeightIntro', { ns: 'orders' })}
            </p>
            <p style={{ color: '#666', margin: '0 0 8px', fontSize: '0.9em' }}>
              {t('batch.weightTotalHint', { ns: 'orders' })}
            </p>
            <p style={{ color: '#666', margin: '0 0 8px', fontSize: '0.9em' }}>
              {t('batch.cargoSplitHint', { ns: 'orders' })}
            </p>
            {cargoGroupSplit.hasAlreadyPaid && (
              <p style={{ color: '#b26a00', margin: '0 0 8px', fontSize: '0.9em' }}>
                {t('batch.cargoAlreadyPaidNote', { ns: 'orders' })}
              </p>
            )}
            <div className="batch-sale-lines-wrap batch-sale-lines-wrap--scroll" style={{ marginBottom: 16 }}>
              <table className="batch-sale-lines" role="table">
                <thead>
                  <tr>
                    <th scope="col">{t('batch.product', { ns: 'orders' })}</th>
                    <th scope="col">{t('form.category')}</th>
                    <th className="batch-sale-lines__th--num">{t('batch.qty', { ns: 'orders' })}</th>
                    <th className="batch-sale-lines__th--num">
                      {t('batch.weightKgTotal', { ns: 'orders' })} <span style={{ color: '#e53e3e' }}>*</span>
                    </th>
                    <th className="batch-sale-lines__th--num">
                      {t('batch.cargoShareUzs', { ns: 'orders' })}
                    </th>
                    <th className="batch-sale-lines__th--num">
                      {t('batch.cargoShareUsd', { ns: 'orders' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cargoGroupData.lines.map((line, index) => (
                    <tr key={line.orderId}>
                      <td>
                        #{line.orderId} — {productOrderPickerLabel(line.product_detail, t)}
                      </td>
                      <td>{line.product_detail?.category || <span style={{ color: '#999' }}>—</span>}</td>
                      <td className="batch-sale-lines__td--num">
                        {renderQuantityCell(
                          line.ordered_quantity,
                          line.received_quantity,
                          line.shortfall_status,
                          t,
                        )}
                      </td>
                      <td className="batch-sale-lines__td--num">
                        {cargoGroupLineLocked(line) ? (
                          <span>
                            {formatAppNumber(parseFloat(line.weight) || 0)}
                            <span
                              style={{
                                marginLeft: '6px',
                                padding: '1px 5px',
                                borderRadius: '8px',
                                backgroundColor: '#4caf50',
                                color: '#fff',
                                fontSize: '0.75em',
                                whiteSpace: 'nowrap',
                              }}
                              title={t('batch.cargoAlreadyPaidHint', { ns: 'orders' })}
                            >
                              {t('batch.cargoAlreadyPaid', { ns: 'orders' })}
                            </span>
                          </span>
                        ) : (
                          <input
                            className="batch-sale-lines__control"
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            placeholder="0.00"
                            value={line.weight ?? ''}
                            onChange={(e) => updateCargoGroupLineWeight(line.orderId, e.target.value)}
                          />
                        )}
                      </td>
                      <td className="batch-sale-lines__td--num">
                        {formatAppNumber(cargoGroupSplit.perLine[index]?.uzs || 0)}
                      </td>
                      <td className="batch-sale-lines__td--num">
                        {formatAppNumber(cargoGroupSplit.perLine[index]?.usd || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 'bold', borderTop: '2px solid #ddd' }}>
                    <td colSpan={3}>{t('table.total', { ns: 'orders' })}</td>
                    <td className="batch-sale-lines__td--num">
                      <input
                        className="batch-sale-lines__control"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={cargoGroupData.weightTotal ?? ''}
                        onChange={(e) => updateCargoGroupTotalWeight(e.target.value)}
                        aria-label={t('batch.weightKgTotal', { ns: 'orders' })}
                      />
                      {cargoGroupWeightMismatch && (
                        <div style={{ color: '#e53e3e', fontSize: '0.8em', marginTop: '2px' }}>
                          {t('batch.errWeightTotalMismatch', {
                            ns: 'orders',
                            sum: formatAppNumber(cargoGroupSplit.totalWeight),
                          })}
                        </div>
                      )}
                    </td>
                    <td className="batch-sale-lines__td--num">
                      {formatAppNumber(cargoGroupSplit.totalUzs)}
                    </td>
                    <td className="batch-sale-lines__td--num">
                      {formatAppNumber(cargoGroupSplit.totalUsd)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('actions.payCargo', { ns: 'orders' })}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowCargoGroupForm(false);
                  setCargoGroupData({ groupId: null, uzs: '', usd: '', weightTotal: '', lines: [] });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {showReceiveForm && (
        <div className="form-card" style={{ marginBottom: '20px' }} ref={receiveFormRef}>
          <h2>{t('batch.receiveTitle', { ns: 'orders' })}</h2>
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('batch.receiveIntro', { ns: 'orders' })}
          </p>
          <form onSubmit={handleReceiveSubmit}>
            <div className="batch-sale-lines-wrap batch-sale-lines-wrap--scroll" style={{ marginBottom: 16 }}>
              <table className="batch-sale-lines" role="table">
                <thead>
                  <tr>
                    <th scope="col">{t('batch.product', { ns: 'orders' })}</th>
                    <th className="batch-sale-lines__th--num">{t('batch.orderedQty', { ns: 'orders' })}</th>
                    <th className="batch-sale-lines__th--num">
                      {t('batch.receivedQty', { ns: 'orders' })} <span style={{ color: '#e53e3e' }}>*</span>
                    </th>
                    <th scope="col">{t('batch.refundedCheckbox', { ns: 'orders' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {receiveData.lines.map((line) => {
                    const received = parseInt(line.received, 10);
                    const isShort = Number.isInteger(received) && received < line.ordered;
                    return (
                      <tr key={line.orderId}>
                        <td>{line.label}</td>
                        <td className="batch-sale-lines__td--num">{line.ordered}</td>
                        <td className="batch-sale-lines__td--num">
                          <input
                            className="batch-sale-lines__control"
                            type="number"
                            step="1"
                            min="0"
                            max={line.ordered}
                            required
                            value={line.received}
                            onChange={(e) =>
                              updateReceiveLine(line.orderId, { received: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          {isShort && !line.orderIsPaid ? (
                            <span style={{ color: '#777', fontSize: '0.85em' }}>
                              {t('batch.unpaidShortHint', { ns: 'orders' })}
                            </span>
                          ) : isShort ? (
                            <div>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="checkbox"
                                  checked={line.refunded}
                                  onChange={(e) =>
                                    updateReceiveLine(line.orderId, { refunded: e.target.checked })
                                  }
                                />
                                <span>{t('batch.refundedCheckbox', { ns: 'orders' })}</span>
                              </label>
                              {line.refunded ? (
                                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                                  <input
                                    className="batch-sale-lines__control"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder={t('batch.refundUzs', { ns: 'orders' })}
                                    value={line.refundUzs}
                                    onChange={(e) =>
                                      updateReceiveLine(line.orderId, { refundUzs: e.target.value })
                                    }
                                  />
                                  <input
                                    className="batch-sale-lines__control"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder={t('batch.refundUsd', { ns: 'orders' })}
                                    value={line.refundUsd}
                                    onChange={(e) =>
                                      updateReceiveLine(line.orderId, { refundUsd: e.target.value })
                                    }
                                  />
                                </div>
                              ) : (
                                <span style={{ color: '#999', fontSize: '0.85em' }}>
                                  {t('batch.refundedHint', { ns: 'orders' })}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#bbb' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="form-group">
              <label>{t('batch.shortfallNote', { ns: 'orders' })}</label>
              <textarea
                rows="2"
                value={receiveData.note}
                onChange={(e) => setReceiveData({ ...receiveData, note: e.target.value })}
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('batch.confirmReceive', { ns: 'orders' })}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowReceiveForm(false);
                  setReceiveData({ groupId: null, lines: [], note: '' });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {showPayOrderGroupForm && (
        <div className="form-card" style={{ marginBottom: '20px' }} ref={payOrderGroupFormRef}>
          <h2>{t('batch.payOrderGroupTitle', { ns: 'orders' })}</h2>
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>
            {t('batch.payOrderGroupIntro', { ns: 'orders' })}
          </p>
          <form onSubmit={handlePayOrderGroupSubmit}>
            <div className="batch-sale-lines-wrap batch-sale-lines-wrap--scroll" style={{ marginBottom: 16 }}>
              <table className="batch-sale-lines" role="table">
                <thead>
                  <tr>
                    <th scope="col">{t('batch.product', { ns: 'orders' })}</th>
                    <th scope="col">{t('form.category')}</th>
                    <th className="batch-sale-lines__th--num">{t('batch.qty', { ns: 'orders' })}</th>
                    <th className="batch-sale-lines__th--num">{uzsLabel}</th>
                    <th className="batch-sale-lines__th--num">{t('currency.usd', { ns: 'common' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {payOrderGroupData.lines.map((line) => (
                    <tr key={line.orderId}>
                      <td>
                        #{line.orderId} — {productOrderPickerLabel(line.product_detail, t)}
                      </td>
                      <td>{line.product_detail?.category || <span style={{ color: '#999' }}>—</span>}</td>
                      <td className="batch-sale-lines__td--num">
                        {renderQuantityCell(
                          line.ordered_quantity,
                          line.received_quantity,
                          line.shortfall_status,
                          t,
                        )}
                      </td>
                      <td className="batch-sale-lines__td--num">
                        <input
                          className="batch-sale-lines__control"
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.uzs ?? ''}
                          onChange={(e) => updatePayOrderGroupLine(line.orderId, 'uzs', e.target.value)}
                        />
                      </td>
                      <td className="batch-sale-lines__td--num">
                        <input
                          className="batch-sale-lines__control"
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.usd ?? ''}
                          onChange={(e) => updatePayOrderGroupLine(line.orderId, 'usd', e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('actions.payOrder', { ns: 'orders' })}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowPayOrderGroupForm(false);
                  setPayOrderGroupData({ groupId: null, lines: [] });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {showBatchForm && (canManageStockOrders || canCreateOrder) && (
        <div className="form-card" style={{ marginBottom: 20 }}>
          <h2>{t('batch.title', { ns: 'orders' })}</h2>
          <p style={{ color: '#555', fontSize: '0.9em', marginTop: 0, marginBottom: 16 }}>
            {t('batch.intro', { ns: 'orders' })}
          </p>
          <form onSubmit={handleBatchSubmit}>
            <div className="orders-batch-header-row">
              {canManageStockOrders && (
              <div className="form-group">
                <label>{t('form.orderType')}</label>
                <select
                  value={batchShared.order_type}
                  onChange={(e) => setBatchShared({ ...batchShared, order_type: e.target.value })}
                >
                  <option value="stock">{t('types.stock', { ns: 'orders' })}</option>
                  <option value="on_demand">{t('types.on_demand', { ns: 'orders' })}</option>
                </select>
              </div>
              )}
              <div className="form-group">
                <label>{t('form.supplierCountry')} <span style={{ color: '#e53e3e' }}>*</span></label>
                <FormSearchableSelect
                  value={batchShared.supplier_country}
                  onChange={(v) => setBatchShared({ ...batchShared, supplier_country: v })}
                  options={uniqueSupplierCountriesFromOrdersAndProducts(orders, products).map((country) => ({
                    value: country,
                    label: country.charAt(0).toUpperCase() + country.slice(1),
                  }))}
                  emptyLabel={t('form.selectCountry')}
                  placeholder={t('form.enterCountry')}
                  allowFreeText
                  freeTextApplyLabel={t('form.addCountry') + ': "{{query}}"'}
                  aria-label={t('form.supplierCountry')}
                />
              </div>
              <div className="form-group">
                <label>{t('form.supplierCargo')} <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em' }}>({t('form.optional')})</span></label>
                <FormSearchableSelect
                  value={batchShared.supplier_cargo}
                  onChange={(v) => setBatchShared({ ...batchShared, supplier_cargo: v })}
                  options={uniqueSupplierCargosFromOrders(orders).map((cargo) => ({
                    value: cargo,
                    label: cargo.charAt(0).toUpperCase() + cargo.slice(1),
                  }))}
                  emptyLabel={t('form.none')}
                  placeholder={t('form.enterCargo')}
                  allowFreeText
                  freeTextApplyLabel={t('form.addCargo') + ': "{{query}}"'}
                  aria-label={t('form.supplierCargo')}
                />
              </div>
              {batchShared.order_type === 'on_demand' && (
              <div className="form-group">
                <label>{t('form.customer')} <span style={{ color: '#e53e3e' }}>*</span></label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CustomerSearchableSelect
                      customers={customers}
                      value={batchShared.customer}
                      onChange={(customerId) => setBatchShared({ ...batchShared, customer: customerId })}
                      placeholder={t('form.selectCustomer')}
                      aria-label={t('form.customer')}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-edit"
                    onClick={() => setShowCustomerForm(true)}
                    style={{ whiteSpace: 'nowrap', alignSelf: 'center' }}
                  >
                    {t('form.newCustomer')}
                  </button>
                </div>
              </div>
              )}
            </div>
            <div className="batch-sale-lines-block">
              <div className="batch-sale-lines-block__label" id="batch-order-lines-label">
                {t('batch.lineItems', { ns: 'orders' })}
              </div>
              <div className="batch-sale-lines-wrap batch-sale-lines-wrap--scroll">
                <table
                  className="batch-sale-lines batch-order-lines"
                  role="table"
                  aria-labelledby="batch-order-lines-label"
                >
                  <colgroup>
                    <col className="batch-col-category" />
                    <col className="batch-col-category" />
                    <col className="batch-col-product" />
                    <col className="batch-col-qty" />
                    <col className="batch-col-price" />
                    <col className="batch-col-price" />
                    <col className="batch-col-eshop" />
                    {batchShared.order_type === 'on_demand' && <col className="batch-col-advance" />}
                    <col className="batch-col-row" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{t('filters.categoryType')}</th>
                      <th scope="col">{t('form.category')}</th>
                      <th scope="col">{t('batch.product', { ns: 'orders' })}</th>
                      <th className="batch-sale-lines__th--num">{t('batch.qty', { ns: 'orders' })}</th>
                      <th className="batch-sale-lines__th--num">{t('batch.costUsd', { ns: 'orders' })}</th>
                      <th className="batch-sale-lines__th--num">{t('batch.sellingUsd', { ns: 'orders' })}</th>
                      <th scope="col">{t('form.eshop')} <span style={{ color: '#e53e3e' }}>*</span></th>
                      {batchShared.order_type === 'on_demand' && (
                        <th className="batch-sale-lines__th--num">{t('form.advanceAmount')}</th>
                      )}
                      <th className="batch-sale-lines__th--action" aria-label={t('actions.delete', { ns: 'common' })} />
                    </tr>
                  </thead>
                  <tbody>
                    {batchLines.map((line) => {
                      const lineProducts = products.filter(
                        (p) =>
                          (!line.category_type || p.category_type === line.category_type) &&
                          (!line.category || p.category === line.category),
                      );
                      return (
                        <tr key={line.key}>
                          <td>
                            <FormSearchableSelect
                              value={line.category_type || ''}
                              onChange={(v) => updateBatchLine(line.key, 'category_type', v)}
                              options={productCategoryTypes}
                              emptyLabel={t('form.none')}
                              placeholder={t('form.none')}
                              aria-label={t('filters.categoryType')}
                              triggerClassName="batch-sale-lines__control"
                            />
                          </td>
                          <td>
                            <FormSearchableSelect
                              value={line.category || ''}
                              onChange={(v) => updateBatchLine(line.key, 'category', v)}
                              options={[...new Set(
                                products
                                  .filter((p) => !line.category_type || p.category_type === line.category_type)
                                  .map((p) => p.category)
                                  .filter(Boolean),
                              )].sort()}
                              emptyLabel={t('form.selectCategory')}
                              placeholder={t('form.selectCategory')}
                              aria-label={t('form.category')}
                              triggerClassName="batch-sale-lines__control"
                            />
                          </td>
                          <td>
                            <FormSearchableSelect
                              value={line.product || ''}
                              onChange={(v) => updateBatchLine(line.key, 'product', v)}
                              options={lineProducts.map((p) => ({ value: String(p.id), label: productOrderPickerLabel(p, t) }))}
                              emptyLabel={t('form.selectProduct')}
                              placeholder={t('form.selectProduct')}
                              aria-label={t('batch.product', { ns: 'orders' })}
                              triggerClassName="batch-sale-lines__control"
                            />
                          </td>
                          <td className="batch-sale-lines__td--num">
                            <input
                              className="batch-sale-lines__control"
                              type="number"
                              min="1"
                              value={line.ordered_quantity ?? ''}
                              onChange={(e) => updateBatchLine(line.key, 'ordered_quantity', e.target.value)}
                              aria-label={t('batch.qty', { ns: 'orders' })}
                            />
                          </td>
                          <td className="batch-sale-lines__td--num">
                            <input
                              className="batch-sale-lines__control"
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.cost_usd_per_unit ?? ''}
                              onChange={(e) => updateBatchLine(line.key, 'cost_usd_per_unit', e.target.value)}
                              placeholder="0.00"
                              aria-label={t('batch.costUsd', { ns: 'orders' })}
                            />
                          </td>
                          <td className="batch-sale-lines__td--num">
                            <input
                              className="batch-sale-lines__control"
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.selling_usd_per_unit ?? ''}
                              onChange={(e) => updateBatchLine(line.key, 'selling_usd_per_unit', e.target.value)}
                              placeholder="0.00"
                              aria-label={t('batch.sellingUsd', { ns: 'orders' })}
                            />
                          </td>
                          <td>
                            <FormSearchableSelect
                              value={line.eshop || ''}
                              onChange={(v) => updateBatchLine(line.key, 'eshop', v)}
                              options={eshopOptions}
                              emptyLabel={t('form.selectEshop')}
                              placeholder={t('form.enterEshop')}
                              allowFreeText
                              freeTextApplyLabel={t('form.addEshop') + ': "{{query}}"'}
                              aria-label={t('form.eshop')}
                              triggerClassName="batch-sale-lines__control"
                            />
                            {isClientEshopSlug(line.eshop) && (
                              <input
                                className="batch-sale-lines__control"
                                style={{ marginTop: 4 }}
                                type="text"
                                value={line.client_eshop_notes ?? ''}
                                onChange={(e) => updateBatchLine(line.key, 'client_eshop_notes', e.target.value)}
                                placeholder={t('form.clientNotesPlaceholder')}
                                aria-label={t('form.clientNotes')}
                              />
                            )}
                          </td>
                          {batchShared.order_type === 'on_demand' && (
                          <td className="batch-sale-lines__td--num">
                            <div className="batch-order-lines-advance-cell">
                              <input
                                className="batch-sale-lines__control"
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.advance_payment_amount ?? ''}
                                onChange={(e) => updateBatchLine(line.key, 'advance_payment_amount', e.target.value)}
                                placeholder={t('form.advanceNone')}
                                aria-label={t('form.advanceAmount')}
                              />
                              <select
                                value={line.advance_payment_currency || 'USD'}
                                onChange={(e) => updateBatchLine(line.key, 'advance_payment_currency', e.target.value)}
                                aria-label={t('form.advanceCurrency')}
                              >
                                <option value="USD">USD</option>
                                <option value="UZS">UZS</option>
                              </select>
                            </div>
                          </td>
                          )}
                          <td className="batch-sale-lines__td--action">
                            {batchLines.length > 1 ? (
                              <button
                                type="button"
                                className="batch-sale-lines__remove"
                                onClick={() => removeBatchLine(line.key)}
                                title={t('actions.delete', { ns: 'common' })}
                                aria-label={t('actions.delete', { ns: 'common' })}
                              >
                                ×
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="form-actions batch-sale-lines-actions">
              <button type="button" className="btn-edit" onClick={addBatchLine}>
                + {t('batch.addLine', { ns: 'orders' })}
              </button>
              <button type="submit" className="btn-primary" disabled={batchCreating}>
                {batchCreating
                  ? t('creating', { ns: 'orders' })
                  : t('batch.createCount', { ns: 'orders', count: batchLines.filter((l) => l.product).length })}
              </button>
            </div>
          </form>
        </div>
      )}

      {showCustomerForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>{t('customerForm.title')}</h2>
          <form onSubmit={handleCreateCustomer}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('name', { ns: 'common' })} *</label>
                <input
                  type="text"
                  value={newCustomerData.name}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('phone', { ns: 'common' })} *</label>
                <input
                  type="text"
                  value={newCustomerData.telephone}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, telephone: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('customerForm.instagram')}</label>
                <input
                  type="text"
                  value={newCustomerData.instagram}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, instagram: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('customerForm.region')}</label>
                <select
                  value={newCustomerData.region}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, region: e.target.value })}
                >
                  {regionChoices.map((region) => (
                    <option key={region.value} value={region.value}>
                      {region.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {t('customerForm.add')}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowCustomerForm(false);
                  setNewCustomerData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city', notes: '' });
                }}
              >
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      {!showPaymentForm && !showCargoForm && !showMoveToInventoryForm && !showCustomerForm && (
        <div className="form-card filter-card" style={{ marginBottom: '16px' }}>
          <h3 className="filter-card__title">{t('filters.title', { ns: 'orders' })}</h3>
        <div className="filter-toolbar">
          <div className="filter-field">
            <label>{t('filters.categoryType', { ns: 'orders' })}</label>
            <select
              value={filters.category_type}
              onChange={(e) => setFilters({ ...filters, category_type: e.target.value })}
            >
              <option value="">{t('filters.allCategoryTypes', { ns: 'orders' })}</option>
              {productCategoryTypes.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <ProductCatalogFilterFields
            filters={filters}
            onFiltersChange={setFilters}
            options={getCascadedFilterOptions(orders, filters, (o) => o.product_detail, null, (order, _excl) => {
              if (filters.year) {
                const y = new Date(order.order_date).getFullYear().toString();
                if (y !== filters.year) return false;
              }
              if (filters.month) {
                const m = (new Date(order.order_date).getMonth() + 1).toString();
                if (m !== filters.month) return false;
              }
              return true;
            })}
            t={(key, opts) => t(key, { ns: 'orders', ...opts })}
            fieldLabels={{
              category: t('filters.category', { ns: 'orders' }),
              brand: t('filters.brand', { ns: 'orders' }),
              model: t('filters.model', { ns: 'orders' }),
              size: t('filters.size', { ns: 'orders' }),
              color: t('filters.color', { ns: 'orders' }),
            }}
            emptyLabels={{
              category: t('filters.allCategories', { ns: 'orders' }),
              brand: t('filters.allBrands', { ns: 'orders' }),
              model: t('filters.allModels', { ns: 'orders' }),
              size: t('filters.allSizes', { ns: 'orders' }),
              color: t('filters.allColors', { ns: 'orders' }),
            }}
          />
          {canSeeStockOrders && (
          <div className="filter-field">
            <label>{t('filters.orderType', { ns: 'orders' })}</label>
            <select
              value={filters.order_type}
              onChange={(e) => setFilters({ ...filters, order_type: e.target.value })}
            >
              <option value="">{t('filters.allOrderTypes', { ns: 'orders' })}</option>
              <option value="stock">{t('types.stock', { ns: 'orders' })}</option>
              <option value="on_demand">{t('types.on_demand', { ns: 'orders' })}</option>
            </select>
          </div>
          )}
          <div className="filter-field">
            <label>{t('filters.status', { ns: 'orders' })}</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">{t('filters.allStatuses', { ns: 'orders' })}</option>
              {orderStatusFilterOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.shortfall', { ns: 'orders' })}</label>
            <select
              value={filters.shortfall}
              onChange={(e) => setFilters({ ...filters, shortfall: e.target.value })}
            >
              <option value="">{t('filters.allDeliveries', { ns: 'orders' })}</option>
              <option value="pending">{t('filters.shortfallPending', { ns: 'orders' })}</option>
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.customer', { ns: 'orders' })}</label>
            <CustomerSearchableSelect
              variant="filter"
              customers={customerFilterOptions}
              value={filters.customer}
              allowEmpty
              emptyLabel={t('filters.allCustomers', { ns: 'orders' })}
              placeholder={t('filters.allCustomers', { ns: 'orders' })}
              extraOptions={[{ value: '__none__', label: t('filters.noCustomer', { ns: 'orders' }) }]}
              aria-label={t('filters.customer', { ns: 'orders' })}
              onChange={(customerId) => setFilters({ ...filters, customer: customerId })}
            />
          </div>
          {(() => {
            const dateOpts = getCascadedDateOptions(orders, filters, (o) => o.order_date, (o) => o.product_detail);
            return (
              <>
                <div className="filter-field">
                  <label>{t('filters.year', { ns: 'orders' })}</label>
                  <select
                    value={filters.year}
                    onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                  >
                    <option value="">{t('filters.allYears', { ns: 'common' })}</option>
                    {dateOpts.years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <label>{t('filters.month', { ns: 'orders' })}</label>
                  <select
                    value={filters.month}
                    onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                  >
                    <option value="">{monthOptions[0]?.label || t('filters.allMonths', { ns: 'common' })}</option>
                    {dateOpts.months.map((m) => {
                      const mo = monthOptions.find((o) => o.value === m);
                      return (
                        <option key={m} value={m}>{mo ? mo.label : m}</option>
                      );
                    })}
                  </select>
                </div>
              </>
            );
          })()}
          <div className="filter-toolbar__actions">
            <button
              type="button"
              className="btn-edit"
              onClick={() =>
                setFilters({
                  category_type: '',
                  category: [],
                  brand: [],
                  model: [],
                  sizes: [],
                  color: [],
                  order_type: '',
                  status: '',
                  shortfall: '',
                  customer: '',
                  year: '',
                  month: '',
                })
              }
            >
              {t('actions.clearAll', { ns: 'common' })}
            </button>
          </div>
        </div>
        </div>
      )}

      <div className="table-card">
        <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <SortableTh columnId="id" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.id', { ns: 'common' })}</SortableTh>
              <SortableTh columnId="order_date" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.date', { ns: 'orders' })}</SortableTh>
              <th>{t('table.actions', { ns: 'orders' })}</th>
              <SortableTh columnId="status" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.status', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="category_type" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.categoryType', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="category" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.category', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="brand" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.brand', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="model" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.model', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="size" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.size', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="color" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.color', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="supplier_country" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.supplierCountry', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="supplier_cargo" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.supplierCargo', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="eshop" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.eshop', { ns: 'orders' })}</SortableTh>
              {canSeeStockOrders && (
              <SortableTh columnId="order_type" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.orderType', { ns: 'orders' })}</SortableTh>
              )}
              <SortableTh columnId="customer" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.customer', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="qty" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.qty', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="weight" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.weight', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="selling_price_unit" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.sellingPerUnit', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="cost_per_unit" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.costPerUnit', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="total_cost" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.totalCost', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="order_uzs" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.orderUzs', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="order_usd" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.orderUsd', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="cargo_uzs" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.cargoUzs', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="cargo_usd" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.cargoUsd', { ns: 'orders' })}</SortableTh>
              <th>{t('table.cargoUnitUzs', { ns: 'orders' })}</th>
              <th>{t('table.cargoUnitUsd', { ns: 'orders' })}</th>
              <SortableTh columnId="created_by" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.createdBy', { ns: 'orders' })}</SortableTh>
              <SortableTh columnId="ordered_note" sortCol={orderSort.sortCol} sortDir={orderSort.sortDir} onSort={orderSort.onHeaderClick}>{t('table.orderedNote', { ns: 'orders' })}</SortableTh>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={orderTableColumnCount} style={{ textAlign: 'center' }}>
                  {t('table.noOrders', { ns: 'orders' })}
                </td>
              </tr>
            ) : (
              sortedFilteredOrders.map((row) => {
                if (row.type === 'single') {
                  return renderOrderRow(row.order);
                }

                const agg = aggregateGroupOrders(row.orders);
                const first = agg.first;
                const expanded = expandedOrderGroups.has(row.groupId);
                const groupEshopLabel = formatEshopDisplay(first?.eshop, t);
                const openLine = row.orders.find((o) => !ORDER_TERMINAL_STATUSES.has(o.status));
                // One step for the whole shipment: the earliest thing any line still needs.
                const groupSteps = availableGroupSteps(row.orders);

                return (
                  <React.Fragment key={row.key}>
                    <tr
                      className="sale-group-row"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        if (e.target.closest('button')) return;
                        toggleOrderGroup(row.groupId);
                      }}
                    >
                      <td>{agg.idsLabel}</td>
                      <td>{formatAppDateTime(first?.order_date || first?.created_at)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {groupSteps.includes('mark_ordered') && canMarkAsOrdered && (
                          <button
                            className="btn-status"
                            onClick={() => handleMarkAsOrderedGroup(row.orders)}
                            style={{ marginRight: '5px' }}
                          >
                            {t('actions.markAsOrdered', { ns: 'orders' })}
                          </button>
                        )}
                        {groupSteps.includes('mark_received') && canUpdateStatus && (
                          <button
                            className="btn-status"
                            onClick={() => handleMarkReceivedGroup(row.groupId, row.orders)}
                            style={{ marginRight: '5px' }}
                          >
                            {t('actions.markReceived', { ns: 'orders' })}
                          </button>
                        )}
                        {groupSteps.includes('pay_order') && canPayOrder && (
                          <button
                            className="btn-status"
                            onClick={() => handlePayOrderGroup(row.orders.filter(
                              (o) => !o.order_is_paid && o.status !== 'order_created' && !ORDER_TERMINAL_STATUSES.has(o.status),
                            ))}
                            style={{ marginRight: '5px' }}
                          >
                            {t('actions.payOrder', { ns: 'orders' })}
                          </button>
                        )}
                        {groupSteps.includes('pay_cargo') && canPayCargo && (
                          <button
                            className="btn-status"
                            onClick={() => handlePayCargoGroup(row.orders)}
                            style={{ marginRight: '5px' }}
                          >
                            {t('actions.payCargo', { ns: 'orders' })}
                          </button>
                        )}
                        {groupSteps.includes('finalize') && canMoveInventory && row.orders.some(
                          (o) => availableOrderSteps(o).includes('finalize') && o.order_type === 'stock',
                        ) && (
                          <button
                            className="btn-status"
                            onClick={() => handleMoveToInventoryGroup(row.groupId)}
                            style={{ marginRight: '5px' }}
                          >
                            {t('actions.moveToInventory', { ns: 'orders' })}
                          </button>
                        )}
                        {/* On-demand fulfillment for the whole order at once. Each line keeps
                            its own button too, since a customer can take some items and
                            decline others. */}
                        {groupSteps.includes('finalize') && canSellProduct && row.orders.some(
                          (o) => o.order_type === 'on_demand'
                            && availableOrderSteps(o).includes('finalize')
                            && !o.has_sale,
                        ) && (
                          <button
                            className="btn-status"
                            onClick={() => handleSellProductGroup(row.groupId)}
                            style={{ marginRight: '5px' }}
                          >
                            {t('actions.sellProduct', { ns: 'orders' })}
                          </button>
                        )}
                        {groupSteps.includes('finalize') && canMoveInventory && row.orders.some(
                          (o) => o.order_type === 'on_demand'
                            && availableOrderSteps(o).includes('finalize')
                            && !o.has_sale,
                        ) && (
                          <button
                            className="btn-status"
                            onClick={() => handleMoveToInventoryGroupFromOrder(row.groupId)}
                            style={{ marginRight: '5px' }}
                          >
                            {t('actions.moveToInventory', { ns: 'orders' })}
                          </button>
                        )}
                        {/* Cancels every remaining open line; individual lines have their own
                            cancel button inside the expanded group. */}
                        {canCancelOrder && openLine && (
                          <button
                            className="btn-edit"
                            onClick={() => handleCancelGroup(row.groupId)}
                            style={{ backgroundColor: '#f44336', color: 'white' }}
                          >
                            {t('actions.cancelGroup', { ns: 'orders' })}
                          </button>
                        )}
                      </td>
                      <td>
                        <span className={`status-badge ${agg.hasMixedStatus ? 'ordered' : (agg.activeStatuses[0] || agg.statuses[0])}`}>
                          {agg.hasMixedStatus
                            ? t('batch.mixedStatus', { ns: 'orders' })
                            : formatOrderStatus(agg.activeStatuses[0] || agg.statuses[0], tStatus)}
                        </span>
                      </td>
                      <td><span style={{ color: '#999' }}>—</span></td>
                      <td><span style={{ color: '#999' }}>—</span></td>
                      <td>
                        <strong>{t('batch.multipleItems', { ns: 'orders' })}</strong>
                        <span style={{ color: '#666', fontSize: '0.85em' }}> ({row.orders.length})</span>
                      </td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>{first?.supplier_country || <span style={{ color: '#999' }}>—</span>}</td>
                      <td>{first?.supplier_cargo || <span style={{ color: '#999' }}>—</span>}</td>
                      <td title={groupEshopLabel || ''}>
                        {groupEshopLabel ? <span>{groupEshopLabel}</span> : <span style={{ color: '#bbb' }}>—</span>}
                      </td>
                      {canSeeStockOrders && (
                        <td>
                          <span className={`status-badge ${first?.order_type === 'stock' ? 'confirmed' : 'pending'}`}>
                            {orderTypeShortLabel(first?.order_type, t)}
                          </span>
                        </td>
                      )}
                      <td>
                        {first?.order_type === 'on_demand' ? (
                          first?.customer_detail ? (
                            <div>
                              <strong>{first.customer_detail.name}</strong>
                              {first.customer_detail.telephone && (
                                <div style={{ fontSize: '0.82em', color: '#666' }}>{first.customer_detail.telephone}</div>
                              )}
                              {(agg.advanceUsd > 0 || agg.advanceUzs > 0) && (
                                <div style={{ fontSize: '0.82em', color: '#4caf50' }}>
                                  {t('table.advance', { ns: 'orders' })}{' '}
                                  {[
                                    agg.advanceUsd > 0 ? formatDisplayAmount(agg.advanceUsd, 'USD') : null,
                                    agg.advanceUzs > 0 ? formatDisplayAmount(agg.advanceUzs, 'UZS') : null,
                                  ].filter(Boolean).join(' + ')}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#f44336', fontSize: '0.85em' }}>{t('table.noCustomer', { ns: 'orders' })}</span>
                          )
                        ) : (
                          <span style={{ color: '#aaa' }}>—</span>
                        )}
                      </td>
                      <td>
                        {renderQuantityCell(
                          agg.quantity,
                          agg.hasShortfall ? agg.receivedQuantity : null,
                          'pending',
                          t,
                        )}
                      </td>
                      {/* Whole-shipment weight; each line's own weight shows when expanded. */}
                      <td>
                        {agg.weightTotal > 0 ? (
                          `${formatAppNumber(agg.weightTotal)} kg`
                        ) : (
                          <span style={{ color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td>—</td>
                      <td>—</td>
                      <td>{agg.costTotal > 0 ? `$${agg.costTotal.toFixed(2)}` : '—'}</td>
                      <td>
                        {agg.orderUzs > 0 ? (
                          <span style={{ color: agg.allOrderPaid ? '#4caf50' : 'inherit' }}>{formatAppNumber(agg.orderUzs)} {uzsLabel}</span>
                        ) : (
                          <span style={{ color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td>
                        {agg.orderUsd > 0 ? (
                          <span style={{ color: agg.allOrderPaid ? '#4caf50' : 'inherit' }}>${agg.orderUsd.toFixed(2)}</span>
                        ) : (
                          <span style={{ color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td>
                        {agg.cargoUzs > 0 ? (
                          <span style={{ color: agg.allCargoPaid ? '#4caf50' : 'inherit' }}>
                            {formatAppNumber(agg.cargoUzs)} {uzsLabel}
                          </span>
                        ) : (
                          <span style={{ color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td>
                        {agg.cargoUsd > 0 ? (
                          <span style={{ color: agg.allCargoPaid ? '#4caf50' : 'inherit' }}>
                            ${agg.cargoUsd.toFixed(2)}
                          </span>
                        ) : (
                          <span style={{ color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td title={t('table.cargoUnitVariesHint', { ns: 'orders' })}>
                        <span style={{ color: '#999' }}>—</span>
                      </td>
                      <td title={t('table.cargoUnitVariesHint', { ns: 'orders' })}>
                        <span style={{ color: '#999' }}>—</span>
                      </td>
                      <td>{first?.created_by_detail?.username || '-'}</td>
                      <td>—</td>
                    </tr>
                    {expanded &&
                      row.orders.map((o) => renderOrderRow(o, `${row.key}-item-${o.id}`, 'sale-group-detail-row'))}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={orderFooterLabelColSpan} style={{ textAlign: 'right' }}>
                {t('table.total', { ns: 'orders' })}
              </td>
              <td style={{ fontWeight: 600 }}>{formatAppNumber(orderColumnTotals.quantity)}</td>
              <td style={{ fontWeight: 600 }}>
                {orderColumnTotals.weight > 0 ? `${formatAppNumber(orderColumnTotals.weight)} kg` : '—'}
              </td>
              <td
                style={{ fontWeight: 600 }}
                title={t('table.avgSellingHint', { ns: 'orders' })}
              >
                {orderColumnTotals.avgSellingPerUnitOrdered > 0
                  ? `$${orderColumnTotals.avgSellingPerUnitOrdered.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {orderColumnTotals.quantity > 0
                  ? `$${orderColumnTotals.avgCostPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {orderColumnTotals.costTotal > 0
                  ? `$${orderColumnTotals.costTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {orderColumnTotals.orderUzs > 0 ? `${formatAppNumber(orderColumnTotals.orderUzs)} ${uzsLabel}` : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {orderColumnTotals.orderUsd > 0 ? `$${orderColumnTotals.orderUsd.toFixed(2)}` : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {orderColumnTotals.cargoUzs > 0 ? `${formatAppNumber(orderColumnTotals.cargoUzs)} ${uzsLabel}` : '—'}
              </td>
              <td style={{ fontWeight: 600 }}>
                {orderColumnTotals.cargoUsd > 0 ? `$${orderColumnTotals.cargoUsd.toFixed(2)}` : '—'}
              </td>
              <td colSpan="5">—</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
};

export default Orders;
