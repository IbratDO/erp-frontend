/** Build grouped display rows for the Orders table (multi-item order = one row). */

/** Total cargo cost for the whole shipment (cargo pool) this order belongs to —
 * same value for every line sharing that pool. Falls back to this line's own
 * allocated cost when it isn't pooled with any sibling. */
export function cargoPoolTotals(order, allOrders) {
  const poolId = order.cargo_pool_id;
  if (!poolId) {
    return {
      uzs: parseFloat(order.allocated_cargo_cost_uzs) || 0,
      usd: parseFloat(order.allocated_cargo_cost_usd) || 0,
      lineCount: 1,
    };
  }
  const members = (allOrders || []).filter(
    (o) => o.cargo_pool_id === poolId && o.status !== 'cancelled',
  );
  return {
    uzs: members.reduce((sum, o) => sum + (parseFloat(o.allocated_cargo_cost_uzs) || 0), 0),
    usd: members.reduce((sum, o) => sum + (parseFloat(o.allocated_cargo_cost_usd) || 0), 0),
    lineCount: members.length || 1,
  };
}

/** This line's own cargo cost per unit and per kg, from its allocated share
 * (already split by weight — or per-unit as a fallback — across the pool).
 *
 * Per unit divides by the quantity actually RECEIVED, matching the backend
 * (cargo_allocation_utils.cargo_unit_costs_from_order) — freight is weighed on arrival, so
 * it only ever paid to move the goods that came. Dividing by the ordered count instead made
 * a short delivery print a lower per-unit cost than the one really carried into inventory
 * and COGS ($40 over 5 ordered = $8.00, where the 4 that arrived each carry $10.00).
 * received_quantity is null on lines predating short-delivery tracking, and those were
 * always all-or-nothing, so they read as fully received. */
export function cargoUnitCosts(order) {
  const received = parseFloat(order.received_quantity);
  const qty = Number.isFinite(received) ? received : parseFloat(order.ordered_quantity) || 0;
  const weight = parseFloat(order.weight) || 0;
  const uzsTotal = parseFloat(order.allocated_cargo_cost_uzs) || 0;
  const usdTotal = parseFloat(order.allocated_cargo_cost_usd) || 0;
  return {
    unitUzs: qty > 0 ? uzsTotal / qty : 0,
    unitUsd: qty > 0 ? usdTotal / qty : 0,
    kgUzs: weight > 0 ? uzsTotal / weight : 0,
    kgUsd: weight > 0 ? usdTotal / weight : 0,
  };
}

export function buildOrderDisplayRows(filteredOrders, allOrders) {
  const seenGroupIds = new Set();
  const rows = [];

  for (const order of filteredOrders) {
    const gid = order.order_group;
    if (!gid) {
      rows.push({ type: 'single', key: `order-${order.id}`, order });
      continue;
    }
    if (seenGroupIds.has(gid)) continue;
    seenGroupIds.add(gid);
    const groupOrders = allOrders
      .filter((o) => Number(o.order_group) === Number(gid))
      .sort((a, b) => Number(a.id) - Number(b.id));
    rows.push({ type: 'group', key: `group-${gid}`, groupId: gid, orders: groupOrders });
  }

  return rows;
}

export function aggregateGroupOrders(groupOrders) {
  if (!groupOrders?.length) {
    return {
      first: null,
      ids: [],
      idsLabel: '',
      quantity: 0,
      receivedQuantity: null,
      hasShortfall: false,
      costTotal: 0,
      orderUzs: 0,
      orderUsd: 0,
      cargoUzs: 0,
      cargoUsd: 0,
      weightTotal: 0,
      advanceUsd: 0,
      advanceUzs: 0,
      statuses: [],
      activeStatuses: [],
      cancelledCount: 0,
      hasMixedStatus: false,
      allOrderPaid: false,
      allCargoPaid: false,
    };
  }
  const first = groupOrders[0];
  const ids = groupOrders.map((o) => o.id);
  // Cancelled lines never counted toward quantity/cost rollups — matches Sales' group aggregation.
  const activeOrders = groupOrders.filter((o) => o.status !== 'cancelled');
  const quantity = activeOrders.reduce((sum, o) => sum + (parseInt(o.ordered_quantity, 10) || 0), 0);
  // Uncounted lines contribute their full ordered quantity, so the collapsed row only shows
  // "27 / 30" once something has genuinely arrived short.
  const receivedQuantity = activeOrders.reduce(
    (sum, o) =>
      sum +
      (o.received_quantity === null || o.received_quantity === undefined
        ? parseInt(o.ordered_quantity, 10) || 0
        : parseInt(o.received_quantity, 10) || 0),
    0,
  );
  const hasShortfall = activeOrders.some((o) => (parseInt(o.shortfall_quantity, 10) || 0) > 0);
  const costTotal = activeOrders.reduce((sum, o) => sum + (parseFloat(o.cost_total) || 0), 0);
  const orderUzs = activeOrders.reduce(
    (sum, o) => sum + (parseFloat(o.order_payment_uzs_cash) || 0) + (parseFloat(o.order_payment_uzs_card) || 0),
    0,
  );
  const orderUsd = activeOrders.reduce(
    (sum, o) => sum + (parseFloat(o.order_payment_usd_cash) || 0) + (parseFloat(o.order_payment_usd_card) || 0),
    0,
  );
  const cargoUzs = activeOrders.reduce(
    (sum, o) => sum + (parseFloat(o.cargo_payment_uzs_cash) || 0) + (parseFloat(o.cargo_payment_uzs_card) || 0),
    0,
  );
  const cargoUsd = activeOrders.reduce(
    (sum, o) => sum + (parseFloat(o.cargo_payment_usd_cash) || 0) + (parseFloat(o.cargo_payment_usd_card) || 0),
    0,
  );
  const weightTotal = activeOrders.reduce((sum, o) => sum + (parseFloat(o.weight) || 0), 0);
  const advanceUsd = activeOrders.reduce(
    (sum, o) => sum + ((o.advance_payment_currency || 'USD') === 'USD' ? parseFloat(o.advance_payment_amount) || 0 : 0),
    0,
  );
  const advanceUzs = activeOrders.reduce(
    (sum, o) => sum + (o.advance_payment_currency === 'UZS' ? parseFloat(o.advance_payment_amount) || 0 : 0),
    0,
  );
  const statuses = [...new Set(groupOrders.map((o) => o.status))];
  const activeStatuses = [...new Set(activeOrders.map((o) => o.status))];

  return {
    first,
    ids,
    idsLabel: ids.length > 1 ? `#${ids[0]}–${ids[ids.length - 1]}` : `#${ids[0]}`,
    quantity,
    receivedQuantity,
    hasShortfall,
    costTotal,
    orderUzs,
    orderUsd,
    cargoUzs,
    cargoUsd,
    weightTotal,
    advanceUsd,
    advanceUzs,
    statuses,
    activeStatuses,
    // Cancelled lines are excluded from the badge, so their count is surfaced separately —
    // otherwise a group of three with one cancelled and two sold reads plainly "Sotildi" and
    // the cancelled line disappears. Same treatment Sales gives its declined lines.
    cancelledCount: groupOrders.filter((o) => o.status === 'cancelled').length,
    // Mixed only among still-active lines — matches Sales' aggregateGroupSales behaviour.
    hasMixedStatus: activeStatuses.length > 1,
    allOrderPaid: groupOrders.every((o) => o.order_is_paid),
    allCargoPaid: groupOrders.every((o) => o.cargo_is_paid),
  };
}

/** Row shape used by table sort accessors (mirrors saleLikeForDisplayRow). */
export function orderLikeForDisplayRow(row) {
  if (row.type === 'single') return row.order;
  const agg = aggregateGroupOrders(row.orders);
  const displayStatus = agg.hasMixedStatus
    ? 'ordered'
    : (agg.activeStatuses[0] || agg.statuses[0]);
  return {
    ...agg.first,
    id: agg.first?.id ?? 0,
    status: displayStatus,
    ordered_quantity: agg.quantity,
    // Sorting a collapsed group by weight must use the whole shipment, not the first line.
    weight: agg.weightTotal,
    cost_total: agg.costTotal,
    order_payment_uzs_cash: agg.orderUzs,
    order_payment_uzs_card: 0,
    order_payment_usd_cash: agg.orderUsd,
    order_payment_usd_card: 0,
    cargo_payment_uzs_cash: agg.cargoUzs,
    cargo_payment_uzs_card: 0,
    cargo_payment_usd_cash: agg.cargoUsd,
    cargo_payment_usd_card: 0,
    product_detail: {
      category_type: '',
      category: '',
      brand: 'multiple items',
      model: '',
      size: '',
      color: '',
    },
  };
}
