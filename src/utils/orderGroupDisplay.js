/** Build grouped display rows for the Orders table (multi-item order = one row). */

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
