/**
 * Which language the shop is being read in.
 *
 * Two, deliberately: Uzbek and Russian, the languages the staff actually use. English stays
 * loaded as i18next's fallback so a key that has not been translated yet renders words rather
 * than a raw key like `sales.batch.scanHint` — never blank, never broken.
 *
 * The choice belongs to the browser, not the account. A shop terminal is used by whoever is on
 * shift, and the person standing at it should be able to switch without anybody's password.
 */

export const SUPPORTED_LANGUAGES = ['uz', 'ru'];
export const DEFAULT_LANGUAGE = 'uz';

const STORAGE_KEY = 'erp.language';

/**
 * The stored choice, or Uzbek.
 *
 * Every read is guarded: a browser in private mode, or one set to block site data, throws on
 * `localStorage` rather than returning null. A language preference is not worth a blank page.
 */
export function getStoredLanguage() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Remember the choice. Failing to store it is not worth interrupting anyone over. */
export function storeLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Nothing to do: the switch still applies for this session.
  }
}
