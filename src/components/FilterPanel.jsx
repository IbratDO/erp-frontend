import React, { useId, useMemo, useRef, useState } from 'react';
import useAppTranslation from '../hooks/useAppTranslation';

/**
 * Collapsible wrapper around a page's filter toolbar.
 *
 * Filters used to sit open on every page, which on a phone pushed the actual table below the
 * fold on arrival. They now start **closed** and open from the button on the right.
 *
 * Closing them creates a hazard the old layout could not have: a filter can be narrowing the
 * table while the controls that set it are out of sight. So the button carries a count of how
 * many filters differ from the values the page started with — the state is never silently
 * invisible. That baseline is snapshotted on first render rather than passed in, so no page
 * has to describe its own defaults twice.
 */
const FilterPanel = ({
  title,
  children,
  filters,
  defaultOpen = false,
  style,
  className = '',
}) => {
  const { t } = useAppTranslation(['common']);
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  // The page's own initial filter values. `useRef` holds the first object seen and never
  // updates, which is exactly the baseline wanted: "changed from how the page loaded".
  const baseline = useRef(filters);

  const activeCount = useMemo(() => {
    if (!filters || typeof filters !== 'object') return 0;
    const base = baseline.current || {};
    return Object.keys(filters).filter((key) => {
      const now = filters[key];
      const was = base[key];
      // Arrays are multi-selects; compare by content so a re-created array is not "changed".
      if (Array.isArray(now) || Array.isArray(was)) {
        return JSON.stringify(now ?? []) !== JSON.stringify(was ?? []);
      }
      return (now ?? '') !== (was ?? '');
    }).length;
  }, [filters]);

  const label = open ? t('filters.hide') : t('filters.show');

  return (
    <div className={`form-card filter-card ${open ? '' : 'filter-card--closed'} ${className}`.trim()} style={style}>
      <div className="filter-card__header">
        <h3 className="filter-card__title">{title}</h3>
        <button
          type="button"
          className="filter-card__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={label}
          title={label}
        >
          {!open && activeCount > 0 && (
            <span className="filter-card__badge" aria-hidden="true">{activeCount}</span>
          )}
          {open ? <CloseIcon /> : <FunnelIcon />}
        </button>
      </div>
      {open && (
        <div className="filter-card__body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  );
};

/* Icons are inline so they inherit `currentColor` and need no network request. */
const FunnelIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path
      d="M2 3h12L9.5 8.4V13L6.5 14V8.4L2 3Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path
      d="M4 4l8 8M12 4l-8 8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

export default FilterPanel;
