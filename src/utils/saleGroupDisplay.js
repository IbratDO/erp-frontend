/** Build grouped display rows for the Sales table (multi-item checkout = one row). */

/** Line-item discount (list vs final price) plus completion remainder recorded as discount. */
export function saleDiscountTotalAmount(sale) {
  if (!sale) return 0;
  let total = parseFloat(sale.total_discount_amount) || 0;
  if (sale.balance_shortfall_type === 'discount' && sale.balance_shortfall_amount) {
    total += parseFloat(sale.balance_shortfall_amount) || 0;
  }
  return total;
}

/** Sum discount column amounts for a list of sales (footer totals). */
export function sumSalesDiscountTotals(sales) {
  if (!sales?.length) {
    return { total: 0, currency: null };
  }
  let total = 0;
  const currencies = new Set();
  for (const s of sales) {
    total += saleDiscountTotalAmount(s);
    currencies.add(s.sale_currency || 'USD');
    if (s.balance_shortfall_type === 'discount' && s.balance_shortfall_amount) {
      currencies.add(s.balance_shortfall_currency || s.sale_currency || 'USD');
    }
  }
  return { total, currency: currencies.size === 1 ? [...currencies][0] : null };
}

export function buildSaleDisplayRows(filteredSales, allSales) {
  const seenGroupIds = new Set();
  const rows = [];

  for (const sale of filteredSales) {
    const gid = sale.sale_group_id;
    if (!gid) {
      rows.push({ type: 'single', key: `sale-${sale.id}`, sale });
      continue;
    }
    if (seenGroupIds.has(gid)) continue;
    seenGroupIds.add(gid);
    const groupSales = allSales
      .filter((s) => Number(s.sale_group_id) === Number(gid))
      .sort((a, b) => Number(a.id) - Number(b.id));
    rows.push({ type: 'group', key: `group-${gid}`, groupId: gid, sales: groupSales });
  }

  return rows;
}

export function aggregateGroupSales(groupSales) {
  if (!groupSales?.length) {
    return {
      first: null,
      idsLabel: '',
      quantity: 0,
      totalAmount: 0,
      totalDiscount: 0,
      completionDiscount: 0,
      totalDiscountAll: 0,
      uzsPay: 0,
      usdPay: 0,
      statuses: [],
      activeStatuses: [],
      declinedCount: 0,
      saleCurrency: 'USD',
    };
  }
  const first = groupSales[0];
  const ids = groupSales.map((s) => s.id);
  // Cancelled lines (including declined-at-the-door items) never counted as revenue/quantity —
  // matches P&L/Balance Sheet, which exclude 'cancelled' sales entirely.
  const activeSales = groupSales.filter((s) => s.status !== 'cancelled');
  const quantity = activeSales.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
  const totalAmount = activeSales.reduce((sum, s) => sum + (parseFloat(s.total_amount) || 0), 0);
  const totalDiscount = activeSales.reduce(
    (sum, s) => sum + (parseFloat(s.total_discount_amount) || 0),
    0
  );
  const completionDiscount = activeSales.reduce(
    (sum, s) =>
      s.balance_shortfall_type === 'discount' && s.balance_shortfall_amount
        ? sum + (parseFloat(s.balance_shortfall_amount) || 0)
        : sum,
    0
  );
  const totalDiscountAll = totalDiscount + completionDiscount;
  /** UZS/USD: sum of each line's stored payment (split across items at Complete & Pay). */
  const uzsPay = activeSales.reduce(
    (sum, s) => sum + (parseFloat(s.payment_uzs_cash) || 0) + (parseFloat(s.payment_uzs_card) || 0),
    0
  );
  const usdPay = activeSales.reduce(
    (sum, s) => sum + (parseFloat(s.payment_usd_cash) || 0) + (parseFloat(s.payment_usd_card) || 0),
    0
  );
  const statuses = [...new Set(groupSales.map((s) => s.status))];
  const activeStatuses = [...new Set(activeSales.map((s) => s.status))];
  const declinedCount = groupSales.filter((s) => !!s.delivery_customer_declined_at).length;
  const currencies = [...new Set(groupSales.map((s) => s.sale_currency || 'USD'))];
  return {
    first,
    ids,
    idsLabel:
      ids.length > 1
        ? `#${ids[0]}–${ids[ids.length - 1]}`
        : `#${ids[0]}`,
    quantity,
    totalAmount,
    totalDiscount,
    completionDiscount,
    totalDiscountAll,
    uzsPay,
    usdPay,
    statuses,
    activeStatuses,
    declinedCount,
    saleCurrency: currencies.length === 1 ? currencies[0] : null,
    // Mixed only among still-active lines — a group with one cancelled/declined line and the
    // rest sharing one status should still show that shared status, not a generic "pending".
    hasMixedStatus: activeStatuses.length > 1,
  };
}

/** Synthetic sale object for combined Complete & Pay on a group. */
export function buildCombinedSaleForGroup(groupSales) {
  if (!groupSales?.length) return null;
  const agg = aggregateGroupSales(groupSales);
  const { first, quantity, totalAmount, totalDiscount, completionDiscount } = agg;
  const unit = quantity > 0 ? totalAmount / quantity : 0;
  return {
    ...first,
    id: first.id,
    isSaleGroup: true,
    groupSales,
    quantity,
    selling_price: unit,
    discount_price: null,
    total_amount: totalAmount,
    total_discount_amount: totalDiscount,
    balance_shortfall_type: completionDiscount > 0 ? 'discount' : first.balance_shortfall_type,
    balance_shortfall_amount: completionDiscount > 0 ? completionDiscount : null,
    balance_shortfall_currency: first.balance_shortfall_currency || first.sale_currency,
  };
}

/** Row shape used by table sort accessors. */
export function saleLikeForDisplayRow(row) {
  if (row.type === 'single') return row.sale;
  const agg = aggregateGroupSales(row.sales);
  // Status reflects the still-active lines; only falls back to 'cancelled' when every line in
  // the group is cancelled (declined items excluded from this, per aggregateGroupSales).
  const displayStatus = agg.activeStatuses.length
    ? (agg.hasMixedStatus ? 'pending' : agg.activeStatuses[0])
    : (agg.statuses[0] || 'cancelled');
  return {
    ...agg.first,
    id: agg.first?.id ?? 0,
    status: displayStatus,
    declinedCount: agg.declinedCount,
    quantity: agg.quantity,
    total_amount: agg.totalAmount,
    total_discount_amount: agg.totalDiscountAll,
    payment_uzs_cash: agg.uzsPay,
    payment_uzs_card: 0,
    payment_usd_cash: agg.usdPay,
    payment_usd_card: 0,
    sale_currency: agg.saleCurrency || agg.first?.sale_currency || 'USD',
    product_detail: {
      category: '',
      brand: 'multiple items',
      model: '',
      size: '',
      color: '',
    },
  };
}
