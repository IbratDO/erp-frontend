/**
 * "Kategoriya turi" labels.
 *
 * The shop invents its own types, so most values that reach this function will never be in a
 * locale file. That is the normal case, not the edge case, and it is the case that broke: i18next
 * answers a missing key with the key, and nothing is configured to soften that, so a bare `t()`
 * printed `categoryTypes.Классика` on the Sales page while every other page read correctly.
 *
 * These tests pin the two things that stop it coming back — the fallback to the typed value, and
 * the fact that a caller who forgets `t` degrades instead of throwing.
 */
import { categoryTypeLabel } from './productCategoryTypes';

/** Stands in for i18next: knows the two seeded keys, honours `defaultValue`, else returns the key. */
const t = (key, opts) => {
  const known = { 'categoryTypes.sports': 'Sport', 'categoryTypes.casual': 'Kundalik' };
  if (key in known) return known[key];
  return opts && 'defaultValue' in opts ? opts.defaultValue : key;
};

describe('a type the locale files know', () => {
  test('is translated', () => {
    expect(categoryTypeLabel('sports', t)).toBe('Sport');
    expect(categoryTypeLabel('casual', t)).toBe('Kundalik');
  });
});

describe('a type the shop invented', () => {
  test('is shown exactly as it was typed, not as the lookup key', () => {
    expect(categoryTypeLabel('Классика', t)).toBe('Классика');
  });

  test('never leaks the `categoryTypes.` prefix — the whole bug in one assertion', () => {
    expect(categoryTypeLabel('Сумки', t)).not.toMatch(/^categoryTypes\./);
  });

  test('a value that happens to look like a key is still shown as typed', () => {
    expect(categoryTypeLabel('sports.casual', t)).toBe('sports.casual');
  });
});

describe('nothing to label', () => {
  test.each([undefined, null, '', '   '])('%p gives an empty string, so the caller can show a dash', (value) => {
    expect(categoryTypeLabel(value, t)).toBe('');
  });

  test('surrounding whitespace is trimmed rather than looked up as-is', () => {
    expect(categoryTypeLabel('  sports  ', t)).toBe('Sport');
  });
});

describe('a caller who forgot to pass t', () => {
  // Returns.js wraps the helper to bind `t`; the other pages pass it directly. Getting that wrong
  // used to throw, which turned a translation slip into a blank page.
  test('gets the typed value instead of an exception', () => {
    expect(() => categoryTypeLabel('Классика')).not.toThrow();
    expect(categoryTypeLabel('Классика')).toBe('Классика');
  });

  test('still gets an empty string for an empty value', () => {
    expect(categoryTypeLabel('')).toBe('');
  });

  test('a seeded type falls back to its raw value rather than blowing up', () => {
    expect(categoryTypeLabel('sports')).toBe('sports');
  });
});
