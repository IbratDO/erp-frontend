/**
 * Registering a customer without leaving the form you were filling in.
 *
 * The Qarzdorlik create form needs this because a customer being lent money is often one the
 * shop has only just met. Leaving the page to add them throws away the amount and the due date
 * already typed, so the dialog opens on top and hands the new customer straight back.
 *
 * What is worth pinning is the handover: name and phone are the two the server insists on, and
 * the caller must receive the created customer — the id is what selects them in the picker, and
 * without it the user adds someone and then has to find them by hand, which is the whole problem
 * the button was meant to solve.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import CustomerQuickAddModal from './CustomerQuickAddModal';
import api from '../utils/api';

jest.mock('../utils/api', () => ({ __esModule: true, default: { post: jest.fn() } }));

let container;
let root;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

beforeEach(() => {
  api.post.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = '';
});

function open(props = {}) {
  const state = {
    created: null,
    closed: false,
    messages: [],
  };
  act(() => {
    root.render(
      <CustomerQuickAddModal
        open
        onClose={() => { state.closed = true; }}
        onCreated={(c) => { state.created = c; }}
        showNotification={(message, type) => state.messages.push({ message, type })}
        {...props}
      />,
    );
  });
  return state;
}

const field = (label) =>
  Array.from(document.querySelectorAll('.form-group')).find((g) =>
    (g.querySelector('label')?.textContent || '').toLowerCase().includes(label),
  );

const type = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value',
  ).set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const submit = async () => {
  await act(async () => {
    document.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
};

describe('the fields it offers', () => {
  test('name, phone, instagram and region — the four Mijozlar asks for', () => {
    open();
    const labels = Array.from(document.querySelectorAll('.form-group label')).map(
      (l) => l.textContent.toLowerCase(),
    );
    expect(labels).toHaveLength(4);
    expect(labels.some((l) => l.includes('instagram'))).toBe(true);
  });

  test('the phone starts on the country code, so nobody types it', () => {
    open();
    const phone = field('telefon') || field('phone');
    expect(phone.querySelector('input').value).toBe('+998');
  });
});

describe('what it refuses', () => {
  test('a customer with no name is not sent', async () => {
    const state = open();
    await submit();

    expect(api.post).not.toHaveBeenCalled();
    expect(state.messages[0].type).toBe('error');
  });

  test('a customer with no phone is not sent', async () => {
    const state = open();
    type((field('ism') || field('name')).querySelector('input'), 'Ali');
    type((field('telefon') || field('phone')).querySelector('input'), '   ');
    await submit();

    expect(api.post).not.toHaveBeenCalled();
    expect(state.messages[0].type).toBe('error');
  });
});

describe('a customer added', () => {
  test('is handed back to the caller, and the dialog closes', async () => {
    api.post.mockResolvedValue({ data: { id: 42, name: 'Ali', telephone: '+998901234567' } });
    const state = open();
    type((field('ism') || field('name')).querySelector('input'), '  Ali  ');
    type((field('telefon') || field('phone')).querySelector('input'), '+998901234567');
    await submit();

    // Trimmed, because a name with a stray space reads as a second customer on every later list.
    expect(api.post).toHaveBeenCalledWith(
      '/customers/',
      expect.objectContaining({ name: 'Ali', telephone: '+998901234567' }),
    );
    // The id is the point: it is what selects the new customer in the picker behind.
    expect(state.created).toEqual(expect.objectContaining({ id: 42 }));
    expect(state.closed).toBe(true);
    expect(state.messages.some((m) => m.type === 'success')).toBe(true);
  });

  test('a server refusal is shown and nothing is handed back', async () => {
    api.post.mockRejectedValue({ response: { data: { error: 'Phone already used' } } });
    const state = open();
    type((field('ism') || field('name')).querySelector('input'), 'Ali');
    type((field('telefon') || field('phone')).querySelector('input'), '+998901234567');
    await submit();

    expect(state.created).toBeNull();
    expect(state.closed).toBe(false);
    expect(state.messages.some((m) => m.message === 'Phone already used')).toBe(true);
  });
});
