import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import selectedFirst from '../utils/selectedFirst';
import dropdownPanelPosition from '../utils/dropdownPanelPosition';

function normalizeOptions(options) {
  return (options || []).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value },
  );
}

/**
 * Filter-toolbar dropdown: click to open, type to narrow options (same UX as customer filter picker).
 */
export default function FilterSearchableSelect({
  value = '',
  onChange,
  options = [],
  emptyLabel = '',
  placeholder,
  allowFreeText = false,
  freeTextApplyLabel,
  'aria-label': ariaLabel,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPos, setPanelPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const selected = useMemo(
    () => normalized.find((o) => String(o.value) === String(value)),
    [normalized, value],
  );

  // The chosen row sits at the top. Picking closes the panel, so the move is only ever seen on the
  // next open — nothing shifts under the cursor while the list is in front of you.
  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    const matches = !q
      ? normalized
      : normalized.filter((o) => String(o.label || '').toLowerCase().includes(q));
    return selectedFirst(matches, (o) => String(o.value) === String(value));
  }, [normalized, query, value]);

  const showEmptyOption = useMemo(() => {
    if (!emptyLabel) return false;
    const q = String(query || '').trim().toLowerCase();
    return !q || emptyLabel.toLowerCase().includes(q);
  }, [emptyLabel, query]);

  const updatePanelPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    setPanelPos(dropdownPanelPosition(el.getBoundingClientRect(), {
      minWidth: 200,
      gap: 4,
      maxHeight: 340,
    }));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    updatePanelPos();
    const onScrollResize = () => updatePanelPos();
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [open, updatePanelPos]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const display = selected
    ? selected.label
    : value
      ? String(value)
      : emptyLabel || '';
  const resolvedPlaceholder = placeholder || emptyLabel || '—';

  const handlePick = (nextValue) => {
    onChange(nextValue === '' ? '' : String(nextValue));
    setOpen(false);
    setQuery('');
  };

  const applyFreeText = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    onChange(trimmed);
    setOpen(false);
    setQuery('');
  };

  const trimmedQuery = String(query || '').trim();
  const freeTextHint =
    allowFreeText && trimmedQuery
      ? (freeTextApplyLabel || `Search: "${trimmedQuery}"`).replace(/\{\{query\}\}/g, trimmedQuery)
      : '';

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: 'fixed',
              // Exactly one of these is a number: `bottom` on a phone (panel above the trigger),
              // `top` everywhere else. See `dropdownPanelPosition`.
              top: panelPos.top,
              bottom: panelPos.bottom,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 10050,
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: panelPos.maxHeight,
            }}
          >
            <div style={{ padding: 8, borderBottom: '1px solid #eee', flexShrink: 0 }}>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={resolvedPlaceholder}
                autoComplete="off"
                aria-label={ariaLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && allowFreeText && trimmedQuery) {
                    e.preventDefault();
                    applyFreeText(trimmedQuery);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setOpen(false);
                    setQuery('');
                    triggerRef.current?.focus();
                  }
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  fontSize: 14,
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 4,
                overflowY: 'auto',
                flex: 1,
                minHeight: 0,
              }}
            >
              {allowFreeText && trimmedQuery ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={String(value) === trimmedQuery}
                    onClick={() => applyFreeText(trimmedQuery)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: 'none',
                      background: String(value) === trimmedQuery ? '#e8f5e9' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      color: '#2e7d32',
                      borderRadius: 4,
                      fontWeight: 500,
                    }}
                  >
                    {freeTextHint}
                  </button>
                </li>
              ) : null}
              {showEmptyOption ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === ''}
                    onClick={() => handlePick('')}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: 'none',
                      background: value === '' ? '#e3f2fd' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      color: '#666',
                      borderRadius: 4,
                      fontStyle: 'italic',
                    }}
                  >
                    {emptyLabel}
                  </button>
                </li>
              ) : null}
              {filtered.length === 0 && !showEmptyOption ? (
                <li style={{ padding: '12px 10px', color: '#666', fontSize: 14 }}>—</li>
              ) : (
                filtered.map((o) => {
                  const isSel = String(o.value) === String(value);
                  return (
                    <li key={String(o.value)}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        onClick={() => handlePick(o.value)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 10px',
                          border: 'none',
                          background: isSel ? '#e3f2fd' : 'transparent',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontFamily: 'inherit',
                          color: '#2c3e50',
                          borderRadius: 4,
                        }}
                      >
                        {o.label}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="filter-searchable-select">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => {
            const next = !o;
            if (next) {
              const q = String(value || '');
              const hasExact = normalized.some((opt) => String(opt.value) === q);
              setQuery(allowFreeText && q && !hasExact ? q : '');
            }
            return next;
          });
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="filter-searchable-select__trigger"
        style={{
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: display ? '#212529' : '#6c757d',
        }}
      >
        {display || resolvedPlaceholder}
      </button>
      {panel}
    </div>
  );
}
