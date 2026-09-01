import React from 'react';
import { useTranslation } from 'react-i18next';

import { setAppLanguage } from '../i18n';
import { SUPPORTED_LANGUAGES } from '../utils/appLanguage';

/**
 * UZ / RU, in the top bar.
 *
 * Two buttons rather than a dropdown: there are only two, and a dropdown hides the one you are
 * not in behind a click. It also shows at a glance which language is active, which a closed
 * select does not.
 *
 * Labelled with the language codes themselves rather than translated words — `UZ` and `RU` read
 * the same in both languages, so the control never renames itself when pressed, and somebody who
 * has switched by accident can always find the way back.
 */
const LABELS = { uz: 'UZ', ru: 'RU' };
const NAMES = { uz: "O'zbekcha", ru: 'Русский' };

export default function LanguageToggle() {
  // Subscribed through the hook so this re-renders on a change made anywhere, not only here.
  const { i18n } = useTranslation();
  const active = SUPPORTED_LANGUAGES.includes(i18n.language) ? i18n.language : 'uz';

  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {SUPPORTED_LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          className={`lang-toggle__btn${code === active ? ' lang-toggle__btn--active' : ''}`}
          onClick={() => setAppLanguage(code)}
          aria-pressed={code === active}
          title={NAMES[code]}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  );
}
