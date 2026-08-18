/**
 * Collapsing a double-clicked write.
 *
 * The complaint these tests come from: a button that moves money takes a moment to answer, so
 * it looks untouched, so it gets clicked again — and a second request on a money endpoint is a
 * second payment. While the first write is in the air an identical one must not be sent.
 *
 * The tests drive the real axios instance and swap only its adapter, so what is exercised is
 * the wrapper as shipped rather than a re-description of it. Counting adapter calls is the
 * whole point: it is the number of requests that actually left the browser.
 */
import api from './api';

/** Axios runs its interceptors on the microtask queue, so a request has not reached the
 *  adapter on the line after it is fired. Let the queue drain before counting. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Hold every request open until the test decides, and record what was asked for. */
function controllableAdapter() {
  const calls = [];
  const adapter = (config) =>
    new Promise((resolve, reject) => {
      calls.push({
        config,
        resolve: (data = { ok: true }) =>
          resolve({ data, status: 200, statusText: 'OK', headers: {}, config }),
        reject: (err = new Error('boom')) => reject(err),
      });
    });
  adapter.calls = calls;
  return adapter;
}

describe('a write that is already in the air', () => {
  let adapter;

  beforeEach(() => {
    adapter = controllableAdapter();
    api.defaults.adapter = adapter;
    localStorage.clear();
  });

  test('the second identical click sends nothing and waits on the first', async () => {
    const first = api.post('/orders/12/pay_order/', { usd: 100 });
    const second = api.post('/orders/12/pay_order/', { usd: 100 });
    await settled();

    expect(adapter.calls).toHaveLength(1);

    adapter.calls[0].resolve({ message: 'paid' });
    const [a, b] = await Promise.all([first, second]);

    // Both callers get the same answer, so both refresh and both report success — which is
    // correct, because the payment did succeed. Once.
    expect(a.data).toEqual({ message: 'paid' });
    expect(b.data).toEqual({ message: 'paid' });
    expect(adapter.calls).toHaveLength(1);
  });

  test('doing the same thing again afterwards is allowed', async () => {
    const first = api.post('/finance/expense/', { amount: 5 });
    await settled();
    adapter.calls[0].resolve();
    await first;

    // Two identical instalments, two identical expenses — deliberate repeats are ordinary
    // work. The window closes the moment the first request settles.
    const again = api.post('/finance/expense/', { amount: 5 });
    await settled();
    expect(adapter.calls).toHaveLength(2);
    adapter.calls[1].resolve();
    await again;
  });

  test('a failure releases the button too', async () => {
    const first = api.post('/orders/9/pay_cargo/', { usd: 3 });
    await settled();
    adapter.calls[0].reject(new Error('insufficient balance'));
    await expect(first).rejects.toThrow('insufficient balance');

    // Nothing was recorded, so the user must be able to correct the amount and retry.
    const retry = api.post('/orders/9/pay_cargo/', { usd: 3 });
    await settled();
    expect(adapter.calls).toHaveLength(2);
    adapter.calls[1].resolve();
    await retry;
  });

  test('two different payments are never confused for one', async () => {
    const a = api.post('/orders/12/pay_order/', { usd: 100 });
    const b = api.post('/orders/12/pay_order/', { usd: 50 });
    const c = api.post('/orders/13/pay_order/', { usd: 100 });
    await settled();

    expect(adapter.calls).toHaveLength(3);
    adapter.calls.forEach((call) => call.resolve());
    await Promise.all([a, b, c]);
  });

  test('put, patch and delete are held to the same rule', async () => {
    const puts = [api.put('/products/1/', { name: 'x' }), api.put('/products/1/', { name: 'x' })];
    const patches = [api.patch('/products/1/', { name: 'y' }), api.patch('/products/1/', { name: 'y' })];
    const deletes = [api.delete('/products/1/'), api.delete('/products/1/')];
    await settled();

    // One of each left the browser, not two.
    expect(adapter.calls).toHaveLength(3);
    adapter.calls.forEach((call) => call.resolve());
    await Promise.all([...puts, ...patches, ...deletes]);
  });

  test('reads are left alone', async () => {
    const a = api.get('/orders/');
    const b = api.get('/orders/');
    await settled();

    // Fetching a list twice wastes a request; it does not spend money. Callers also expect
    // their own response object back, so sharing one would be a surprise for no benefit.
    expect(adapter.calls).toHaveLength(2);
    adapter.calls.forEach((call) => call.resolve());
    await Promise.all([a, b]);
  });

  test('a write with no body at all is still collapsed', async () => {
    const a = api.post('/orders/5/mark_as_ordered/');
    const b = api.post('/orders/5/mark_as_ordered/');
    await settled();

    // Plenty of the shop's actions carry nothing but their URL; they double-click the same.
    expect(adapter.calls).toHaveLength(1);
    adapter.calls[0].resolve();
    await Promise.all([a, b]);
  });
});
