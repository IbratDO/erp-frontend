/**
 * How a notice becomes words.
 *
 * The server sends both a finished sentence and the pieces it was built from. This is the rule
 * for choosing between them, and it is worth pinning because the failure is silent: get it
 * wrong and a notice the frontend has not been taught about renders as an empty row — a bell
 * that says there is something to see and then shows nothing.
 */
import { renderNotice } from './NotificationBell';

/** A stand-in for i18next's `t`: returns what the given dictionary holds, else `defaultValue`. */
const translator = (dict) => (key, opts = {}) => {
  const template = dict[key];
  if (template == null) return opts.defaultValue ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(opts[name] ?? ''));
};

const overdue = {
  id: 1,
  kind: 'credit_overdue',
  level: 'danger',
  title: 'Ali — qarz muddati o‘tdi',
  body: '$20.00 · 3 kun kechikkan · sotuv #77',
  context: {
    customer: 'Ali',
    amount: '$20.00',
    days: 3,
    due_date: '2026-08-14',
    sale_id: 77,
    credit_sale_id: 5,
  },
};

describe('rendering a notice', () => {
  test('uses the reader\'s own translation when this build knows the kind', () => {
    const t = translator({
      'kinds.credit_overdue.title': '{{customer}} — payment overdue',
      'kinds.credit_overdue.body': '{{amount}} · {{days}} days late · sale #{{saleId}}',
    });

    expect(renderNotice(overdue, t)).toEqual({
      title: 'Ali — payment overdue',
      body: '$20.00 · 3 days late · sale #77',
    });
  });

  test('falls back to the server\'s sentence for a kind it has never heard of', () => {
    // The case that matters: the backend gains a notice type before the frontend does. It must
    // still say something, not render an empty row under a badge that says there is one.
    const t = translator({});
    const unknown = { ...overdue, kind: 'stock_running_out' };

    expect(renderNotice(unknown, t)).toEqual({
      title: overdue.title,
      body: overdue.body,
    });
  });

  test('a due date is offered already formatted, so translations need no date logic', () => {
    const t = translator({ 'kinds.credit_overdue.title': 'due {{dueDate}}' });
    const { title } = renderNotice(overdue, t);

    expect(title).toMatch(/^due .+/);
    expect(title).not.toBe('due ');
    // 14 August, not 13 — the string must not be re-read as UTC on the way through.
    expect(title).toContain('14');
  });

  test('survives a notice that arrives with no context at all', () => {
    const t = translator({});
    const bare = { id: 2, kind: 'whatever', title: 'Something happened', body: '' };

    expect(renderNotice(bare, t)).toEqual({ title: 'Something happened', body: '' });
  });
});
