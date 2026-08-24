/**
 * Which button a row and a group offer.
 *
 * The case worth pinning is the one reported from the shop as orders #273-275: a three-item
 * order where two had arrived and were waiting on freight while the third was still upstream.
 * The group offered "pay the supplier" — the third item's step — so the two that were ready had
 * no cargo button at all, and their own rows refuse the payment because a bill covering two
 * items needs two weights and a single row carries one. Nothing on screen could settle it.
 */
import {
  availableGroupSteps,
  availableOrderSteps,
} from './orderWorkflowSteps';

let nextId = 1;

/** An order line, defaulting to the very start of the pipeline. */
function line(overrides = {}) {
  return {
    id: nextId++,
    status: 'order_created',
    order_is_paid: false,
    cargo_is_paid: false,
    has_ever_been_received: false,
    received_quantity: null,
    received_at: null,
    cargo_pool_id: 'pool-1',
    ...overrides,
  };
}

/** Ordered, supplier paid, goods counted in — the "Yukni to'lash" stage. */
function awaitingCargo(overrides = {}) {
  return line({
    status: 'received',
    order_is_paid: true,
    has_ever_been_received: true,
    received_quantity: 1,
    received_at: '2026-08-20T10:00:00Z',
    ...overrides,
  });
}

/** Ordered and on its way, nothing paid, nothing here. */
function stillUpstream(overrides = {}) {
  return line({ status: 'ordered', ...overrides });
}

beforeEach(() => {
  nextId = 1;
});

describe('one line at a time', () => {
  test('walks the pipeline one step at a time', () => {
    expect(availableOrderSteps(line())).toEqual(['mark_ordered']);
    expect(availableOrderSteps(stillUpstream())).toEqual(['pay_order']);
    expect(availableOrderSteps(line({ status: 'ordered', order_is_paid: true })))
      .toEqual(['mark_received']);
    expect(availableOrderSteps(awaitingCargo())).toEqual(['pay_cargo']);
  });

  test('a finished line offers nothing', () => {
    expect(availableOrderSteps(line({ status: 'sold' }))).toEqual([]);
    expect(availableOrderSteps(line({ status: 'cancelled' }))).toEqual([]);
    expect(availableOrderSteps(line({ status: 'in_inventory' }))).toEqual([]);
  });

  test('a line where nothing arrived is not offered the shelf', () => {
    const empty = awaitingCargo({ cargo_is_paid: true, received_quantity: 0 });
    expect(availableOrderSteps(empty)).toEqual([]);
  });
});

describe('the reported failure: two arrived, one still upstream', () => {
  const parcel = () => {
    const upstream = stillUpstream();
    return [upstream, awaitingCargo(), awaitingCargo()];
  };

  test('the group offers cargo for the two that landed, not the straggler\'s step', () => {
    const lines = parcel();
    // Before, this answered ['pay_order'] — the upstream line's step — and the arrived pair
    // had no way to pay the freight on goods sitting in the shop.
    expect(availableGroupSteps(lines, lines)).toEqual(['pay_cargo']);
  });

  test('the straggler keeps its own step on its own row', () => {
    const [upstream] = parcel();
    expect(availableOrderSteps(upstream)).toEqual(['pay_order']);
  });

  test('once the parcel is paid for, the group moves it on rather than back to the straggler', () => {
    const upstream = stillUpstream();
    const lines = [
      upstream,
      awaitingCargo({ cargo_is_paid: true }),
      awaitingCargo({ cargo_is_paid: true }),
    ];
    // The pair is in the shop with both bills settled, so the next thing to do with them is put
    // them on the shelf. The group speaks for the goods in hand, and the straggler keeps its own
    // "pay the supplier" on its own row — which is the point of not letting it speak for these.
    expect(availableGroupSteps(lines, lines)).toEqual(['finalize']);
    expect(availableOrderSteps(upstream)).toEqual(['pay_order']);
  });
});

describe('what must not change', () => {
  test('a shipment wholly in transit is still one step for all of it', () => {
    const lines = [stillUpstream(), stillUpstream(), stillUpstream()];
    // Nothing has landed, so every line is travelling together and the earliest outstanding
    // step across all of them is the group's step, exactly as before.
    expect(availableGroupSteps(lines, lines)).toEqual(['pay_order']);
  });

  test('a group waiting to be received is not offered cargo', () => {
    const lines = [
      line({ status: 'ordered', order_is_paid: true }),
      line({ status: 'ordered', order_is_paid: true }),
    ];
    expect(availableGroupSteps(lines, lines)).toEqual(['mark_received']);
  });

  test('a group fully in hand behaves as one shipment', () => {
    const lines = [awaitingCargo(), awaitingCargo()];
    expect(availableGroupSteps(lines, lines)).toEqual(['pay_cargo']);
  });

  test('a fully finished group offers nothing', () => {
    const lines = [line({ status: 'sold' }), line({ status: 'in_inventory' })];
    expect(availableGroupSteps(lines, lines)).toEqual([]);
  });
});

describe('edges', () => {
  test('a cancelled line does not speak for the group', () => {
    const lines = [
      line({ status: 'cancelled' }),
      awaitingCargo(),
      awaitingCargo(),
    ];
    expect(availableGroupSteps(lines, lines)).toEqual(['pay_cargo']);
  });

  test('a cancelled line is not the arrival that splits the shipment', () => {
    const lines = [
      line({ status: 'cancelled', received_at: '2026-08-20T10:00:00Z' }),
      stillUpstream(),
      stillUpstream(),
    ];
    // Nothing really landed, so the two in transit are still one shipment together.
    expect(availableGroupSteps(lines, lines)).toEqual(['pay_order']);
  });

  test('a line that arrived empty does not put the rest onto its own bill', () => {
    const empty = awaitingCargo({ received_quantity: 0 });
    const lines = [empty, stillUpstream(), stillUpstream()];
    // The empty line took no share and is off the bill; the two still coming are unaffected.
    expect(availableGroupSteps(lines, lines)).toEqual(['pay_order']);
  });

  test('no lines, no steps', () => {
    expect(availableGroupSteps([], [])).toEqual([]);
    expect(availableGroupSteps(null)).toEqual([]);
    expect(availableGroupSteps(undefined)).toEqual([]);
  });

  test('the group\'s own lines are enough when nothing else is passed', () => {
    const lines = [stillUpstream(), awaitingCargo(), awaitingCargo()];
    expect(availableGroupSteps(lines)).toEqual(['pay_cargo']);
  });
});
