import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';

function normalizeOptions(options) {
  return (options || []).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value },
  );
}

/**
 * Form-field dropdown that looks like a native <select> but opens a
 * searchable panel on click.  Designed to sit inside `.form-group` and
 * inherit the same padding / border / font-size as other form controls.
 */
export default function FormSearchableSelect({
  value = '',
  onChange,
  options = [],
  placeholder = '',
  emptyLabel = '',
  allowFreeText = false,
  freeTextApplyLabel,
  'aria-label': ariaLabel,
  disabled = false,
  triggerClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPos, setPanelPos] = useState(null);
  const listboxId = useRef(`fss-lb-${Math.random().toString(36).slice(2, 9)}`).current;
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const tableTrigger =
    typeof triggerClassName === 'string' && triggerClassName.includes('batch-sale-lines__control');

  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const selected = useMemo(
    () => normalized.find((o) => String(o.value) === String(value)),
    [normalized, value],
  );

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((o) => String(o.label || '').toLowerCase().includes(q));
  }, [normalized, query]);

  const updatePanelPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const w = Math.max(r.width, 200);
    const width = Math.min(w, vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    setPanelPos({ top: r.bottom + 2, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPanelPos(null); return; }
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

  const display = selected ? selected.label : value ? String(value) : (emptyLabel || '');

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
      ? (freeTextApplyLabel || `"${trimmedQuery}"`).replace(/\{\{query\}\}/g, trimmedQuery)
      : '';

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 10050,
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 5,
              boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 'min(300px, calc(100vh - 96px))',
            }}
          >
            <div style={{ padding: 6, borderBottom: '1px solid #eee', flexShrink: 0 }}>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder || ariaLabel || '…'}
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
                      width: '100%', textAlign: 'left', padding: '7px 10px',
                      border: 'none', background: String(value) === trimmedQuery ? '#e8f5e9' : 'transparent',
                      cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                      color: '#2e7d32', borderRadius: 4, fontWeight: 500,
                    }}
                  >
                    {freeTextHint}
                  </button>
                </li>
              ) : null}
              {/* "empty" / deselect option */}
              {(emptyLabel || placeholder) ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === ''}
                    onClick={() => handlePick('')}
                    style={{
                      width: '100%', textAlign: 'left', padding: '7px 10px',
                      border: 'none', background: value === '' ? '#e3f2fd' : 'transparent',
                      cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                      color: '#666', borderRadius: 4, fontStyle: 'italic',
                    }}
                  >
                    {emptyLabel || placeholder}
                  </button>
                </li>
              ) : null}
              {filtered.length === 0 && !placeholder ? (
                <li style={{ padding: '10px', color: '#999', fontSize: 13 }}>—</li>
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
                          width: '100%', textAlign: 'left', padding: '7px 10px',
                          border: 'none', background: isSel ? '#e3f2fd' : 'transparent',
                          cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                          color: '#2c3e50', borderRadius: 4,
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
    <>
      <div
        ref={triggerRef}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        // On a form row this stands in for a `select`, so it takes the shared control height and
        // the one-line clipping that goes with it. Inside a line table it is sized by the cell,
        // and `form-control-trigger`'s `display: block` would undo that variant's flex layout.
        className={[triggerClassName, tableTrigger ? '' : 'form-control-trigger']
          .filter(Boolean)
          .join(' ') || undefined}
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={
          tableTrigger
            ? {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                overflow: 'hidden',
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: display ? '#2c3e50' : '#999',
                userSelect: 'none',
                background: disabled ? '#f5f5f5' : undefined,
              }
            : {
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '5px',
                fontSize: '14px',
                fontFamily: 'inherit',
                background: disabled ? '#f5f5f5' : '#fff',
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: display ? '#333' : '#999',
                position: 'relative',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: '20px',
                boxSizing: 'border-box',
              }
        }
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {display || placeholder || '—'}
        </span>
        <span style={{ color: '#999', fontSize: 10, marginLeft: 8, flexShrink: 0 }}>▼</span>
      </div>
      {panel}
    </>
  );
}
