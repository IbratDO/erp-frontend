import i18n from '../i18n';

/** Uzbekistan locale for numbers/dates in UI (backend values unchanged). */
export function getAppLocale() {
  return i18n.language === 'uz' ? 'uz-UZ' : 'en-US';
}

export function formatAppNumber(value, options = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(getAppLocale(), options);
}

export function formatAppDate(date, options = {}) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getAppLocale(), options);
}

/**
 * A plain `YYYY-MM-DD` as a local `Date`, with no timezone shift.
 *
 * `new Date('2026-09-01')` reads the string as UTC midnight, so a browser west of Greenwich
 * renders it as 31 August — a due date that moves by a day depending on where you open the
 * page. The parts constructor is local, which is what a calendar date means.
 */
export function dateOnlyToLocalDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

/** Fixed app-wide date/time format: DD/MM/YYYY, HH:MM:SS (24h) — deliberately not
 * locale-dependent, so it stays identical across every page regardless of UI language
 * or browser locale (unlike `toLocaleString`, which flips to MM/DD/YYYY + AM/PM under
 * an en-US locale). */
export function formatAppDateTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

/** Month filter options for dashboards (value 1-12 or ''). */
export function getMonthFilterOptions(t) {
  return [
    { value: '', label: t('months.all', { ns: 'common' }) },
    ...Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: t(`months.${i + 1}`, { ns: 'common' }),
    })),
  ];
}
