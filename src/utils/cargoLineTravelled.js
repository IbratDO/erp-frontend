/**
 * Whether an order line belongs on the freight bill being settled.
 *
 * This is `cargo_allocation_utils.line_travelled` restated for the browser, and the two have to
 * agree: the server decides whose weight is required and who takes a share, while this decides
 * which weight boxes the form shows and what it adds up. When they drifted apart the form asked
 * for a weight the server did not want — and, worse, would have happily let a shipment be split
 * on a different basis than the one it was charged on.
 *
 * The rule, in order:
 *
 * 1. Counted and nothing came → not on the bill. The box arrived empty; there was nothing to
 *    weigh and nothing to carry.
 * 2. The goods are here → on the bill.
 * 3. Still in transit → on the bill only while the whole shipment is. Once part of a group has
 *    landed, that parcel is billed on its own and the lines still travelling are not on it.
 *    Asking for their weight is asking for something nobody can know yet.
 *
 * `received_quantity` cannot answer this on its own, which is what the old version got wrong.
 * A null means "not counted yet" and reads as fully received, so a line still sitting at the
 * supplier looked exactly like one that had arrived intact.
 */

/** Statuses that mean the goods are physically here. Mirrors ARRIVED_STATUSES on the server. */
export const ARRIVED_STATUSES = ['received', 'in_inventory', 'sold'];

/** Whether this line's goods have actually landed. */
export function orderArrived(order) {
  if (!order) return false;
  if (ARRIVED_STATUSES.includes(order.status)) return true;
  return order.received_at != null;
}

/**
 * @param {object} order - the line being judged
 * @param {object[]} [poolMates] - every line the caller knows about; those sharing this line's
 *   cargo pool are what matter. Omit it and a line in transit is treated as being on its own
 *   bill, which is the right answer when there is nothing to compare it against.
 */
export default function orderLineTravelled(order, poolMates) {
  if (!order) return false;

  const counted = order.received_quantity != null;
  if (counted && Number(order.received_quantity) <= 0) return false;

  if (orderArrived(order)) return true;
  if (!order.cargo_pool_id || !Array.isArray(poolMates)) return true;

  const somethingElseLanded = poolMates.some(
    (other) =>
      other
      && other.id !== order.id
      && other.cargo_pool_id === order.cargo_pool_id
      // A cancelled line is out of the pool altogether, so it cannot be the arrival that puts
      // the rest of the shipment onto a bill of its own.
      && other.status !== 'cancelled'
      && orderArrived(other),
  );
  return !somethingElseLanded;
}

/**
 * Items that came in the same delivery as this one and have not paid their freight.
 *
 * Purely for the warning in the cargo card. Paying from a row settles that row alone, so when
 * the carrier gave one bill for the whole delivery these are the items whose share would
 * otherwise have to be worked out by hand — the group button splits it by weight instead.
 *
 * A line already paid for is not listed: its bill is settled and nothing here can change it.
 *
 * @param {object} order - the line whose cargo card is open
 * @param {object[]} all - every line on screen
 */
export function cargoPoolCompanions(order, all) {
  if (!order || !order.cargo_pool_id) return [];
  return (all || []).filter(
    (other) =>
      other
      && other.id !== order.id
      && other.cargo_pool_id === order.cargo_pool_id
      && other.status !== 'cancelled'
      && !other.cargo_is_paid
      && orderLineTravelled(other, all),
  );
}
