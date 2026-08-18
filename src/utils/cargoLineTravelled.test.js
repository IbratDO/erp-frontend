/**
 * The browser's copy of the "is this line on the freight bill?" rule.
 *
 * These cases are deliberately the same ones as `test_partial_arrival_cargo.py` on the server.
 * The two implementations exist because the form has to decide which weight boxes to show
 * before it asks the server anything, and the only thing keeping them honest is that they are
 * tested against the same situations. The version this replaced read `received_quantity` alone
 * and so could not tell a line still at the supplier from one that had arrived intact.
 */
import orderLineTravelled, { orderArrived } from './cargoLineTravelled';

const POOL = 'pool-1';

const line = (over = {}) => ({
  id: 1,
  status: 'ordered',
  received_at: null,
  received_quantity: null,
  cargo_pool_id: POOL,
  ...over,
});

describe('orderArrived', () => {
  test('a status past receiving means the goods are here', () => {
    ['received', 'in_inventory', 'sold'].forEach((status) => {
      expect(orderArrived(line({ status }))).toBe(true);
    });
  });

  test('everything before receiving means they are not', () => {
    ['order_created', 'ordered', 'order_paid'].forEach((status) => {
      expect(orderArrived(line({ status }))).toBe(false);
    });
  });

  test('a receipt timestamp counts even on an odd status', () => {
    expect(orderArrived(line({ status: 'ordered', received_at: '2026-08-18T10:00:00Z' }))).toBe(true);
  });
});

describe('orderLineTravelled', () => {
  test('a line that arrived is on the bill', () => {
    const arrived = line({ id: 1, status: 'received', received_quantity: 1 });
    expect(orderLineTravelled(arrived, [arrived])).toBe(true);
  });

  test('a line that arrived empty is not', () => {
    const empty = line({ id: 1, status: 'received', received_quantity: 0 });
    expect(orderLineTravelled(empty, [empty])).toBe(false);
  });

  test('the whole shipment still in transit is one bill, so every line counts', () => {
    const a = line({ id: 1, status: 'ordered' });
    const b = line({ id: 2, status: 'order_paid' });
    expect(orderLineTravelled(a, [a, b])).toBe(true);
    expect(orderLineTravelled(b, [a, b])).toBe(true);
  });

  test('once one parcel lands, the rest are off its bill', () => {
    // The reported case: #341 arrived, #340 is still at the supplier with a null count that
    // used to read as "fully received" and get asked for a weight.
    const arrived = line({ id: 341, status: 'received', received_quantity: 1 });
    const stillComing = line({ id: 340, status: 'order_created' });
    expect(orderLineTravelled(arrived, [arrived, stillComing])).toBe(true);
    expect(orderLineTravelled(stillComing, [arrived, stillComing])).toBe(false);
  });

  test('a cancelled pool-mate is not an arrival', () => {
    const travelling = line({ id: 1, status: 'ordered' });
    const scrapped = line({ id: 2, status: 'cancelled', received_at: '2026-08-18T10:00:00Z' });
    expect(orderLineTravelled(travelling, [travelling, scrapped])).toBe(true);
  });

  test('a line in another pool is none of its business', () => {
    const mine = line({ id: 1, status: 'ordered' });
    const stranger = line({ id: 2, status: 'received', cargo_pool_id: 'pool-2' });
    expect(orderLineTravelled(mine, [mine, stranger])).toBe(true);
  });

  test('an unpooled line is its own shipment', () => {
    const alone = line({ id: 1, status: 'ordered', cargo_pool_id: null });
    expect(orderLineTravelled(alone, [alone])).toBe(true);
  });

  test('with no list to compare against it stays on the bill', () => {
    // The caller could not say what else is in the pool, so the form keeps asking for the
    // weight it has always asked for rather than silently dropping a line from the split.
    expect(orderLineTravelled(line({ status: 'ordered' }))).toBe(true);
  });
});
