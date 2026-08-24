/**
 * Which workflow button an order line — or a whole multi-item order — is waiting on.
 *
 * A line offers one step at a time, and only the step it is actually on, so the Amallar column
 * cannot present a choice the server will refuse. Corrections and exceptions (cancel, editing
 * cargo cost, resolving a short delivery) are not steps and keep their own independent
 * visibility; they are not decided here.
 */
import orderLineTravelled from './cargoLineTravelled';

/** Statuses where a line's journey through the pipeline is over. */
export const ORDER_TERMINAL_STATUSES = new Set(['in_inventory', 'sold', 'cancelled']);

export function showMarkAsOrderedAction(order) {
  return order.status === 'order_created';
}

export function showMarkAsReceivedAction(order) {
  return (
    (order.status === 'ordered' || order.status === 'order_paid') &&
    !order.has_ever_been_received
  );
}

/**
 * Whether anything on this line actually arrived.
 *
 * A null count means "not counted yet" (or a line predating short-delivery tracking), which
 * reads as fully received — same rule the backend uses in `order_shortfall_utils.received_qty`.
 */
export function orderReceivedSomething(order) {
  return order?.received_quantity == null || Number(order.received_quantity) > 0;
}

export function orderReadyForInventoryActions(order) {
  return (
    (order.status === 'received' || order.status === 'order_paid') &&
    order.order_is_paid &&
    order.cargo_is_paid &&
    // Nothing arrived, so there is nothing to shelve and nothing to hand a customer. The
    // line's way out is the shortfall: receive it late, or close it as refunded / written
    // off. Offering "finalize" here produced a dead Sotish button and an Omborda row holding
    // no stock, which then went terminal and locked its own corrections away.
    orderReceivedSomething(order)
  );
}

/** Pipeline order of the workflow steps a row can be waiting on. */
export const ORDER_STEP_SEQUENCE = [
  'mark_ordered',
  'pay_order',
  'mark_received',
  'pay_cargo',
  'finalize',
];

/**
 * The single workflow step an order line is waiting on, or null when it is finished.
 *
 * The supplier is paid *before* the goods are counted, because that is the real sequence: the
 * eShop takes the money when the order is placed. Recording it in that order means the system
 * already knows the order is paid at the moment a short delivery is discovered, so money the
 * supplier sends back is recorded as a genuine refund rather than silently shrinking a bill
 * that was never raised.
 *
 * Cargo stays after receiving — freight is weighed on arrival, so its cost is not known until
 * the shipment is in hand.
 */
export function availableOrderSteps(order) {
  if (ORDER_TERMINAL_STATUSES.has(order.status)) return [];
  if (showMarkAsOrderedAction(order)) return ['mark_ordered'];
  if (!order.order_is_paid) return ['pay_order'];
  if (showMarkAsReceivedAction(order)) return ['mark_received'];
  if (!order.cargo_is_paid) return ['pay_cargo'];
  if (orderReadyForInventoryActions(order)) return ['finalize'];
  return [];
}

/**
 * Earliest step still outstanding on the parcel in hand, so a group never offers to pay cargo
 * while the goods it would be billing have not been received.
 *
 * "In hand" is the part this got wrong. Taking the earliest step across *every* line lets one
 * straggler hold up the rest: reported from the shop as orders #273-275, where two items had
 * arrived and were waiting on freight but the group offered only "pay the supplier", because
 * the third was still upstream and unpaid. The arrived pair had no group button at all — and
 * paying either from its own row is refused, since one row carries one weight and a bill
 * covering two items needs two. There was no way through.
 *
 * So once part of a group has landed, that part is the shipment as far as this is concerned.
 * The lines still upstream are a later delivery on a later bill and keep their own row buttons
 * inside the expanded group. While nothing has arrived every line is still travelling together,
 * `orderLineTravelled` keeps them all, and this behaves exactly as it did before.
 *
 * Note what this deliberately does *not* do: it never regroups anything. The parcel is worked
 * out fresh each render from what has arrived, so there is no split to get wrong, nothing to
 * undo, and no rule needed for where one delivery ends and the next begins — paying settles
 * whatever is here now, and whatever comes later is billed when it comes.
 *
 * @param {object[]} groupOrders - the lines of this multi-item order
 * @param {object[]} [allOrders] - every line on screen, so a cargo pool reaching beyond this
 *   group is still judged against all of it. Defaults to the group's own lines.
 */
export function availableGroupSteps(groupOrders, allOrders) {
  const lines = (groupOrders || []).filter((o) => o && o.status !== 'cancelled');
  const pool = Array.isArray(allOrders) ? allOrders : lines;
  const parcel = lines.filter((o) => orderLineTravelled(o, pool));
  const inPlay = parcel.length ? parcel : lines;
  const open = new Set();
  inPlay.forEach((o) => availableOrderSteps(o).forEach((s) => open.add(s)));
  const earliest = ORDER_STEP_SEQUENCE.find((s) => open.has(s));
  return earliest ? [earliest] : [];
}
