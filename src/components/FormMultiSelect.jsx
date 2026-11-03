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
 * Form-field multi-select that looks like a native <select> (same border/padding/font
 * as other .form-group inputs) but opens a checkbox dropdown on click.
 * Visually identical to FormSearchableSelect; difference is multiple selection via checkboxes.
 */
export default function FormMultiSelect({
  values = [],
  onChange,
  options = [],
  placeholder = '',
  emptyLabel = '',
  'aria-label': ariaLabel,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPos, setPanelPos] = useState(null);
  const listboxId = useRef(`fms-lb-${Math.random().toString(36).slice(2, 9)}`).current;
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const selectedSet = useMemo(() => new Set((values || []).map(String)), [values]);
  const normalized = useMemo(() => normalizeOptions(options), [options]);

  // What you have ticked is at the top of the list — but the order is taken from the selection as it
  // stood when the panel *opened*, and held there until the panel is opened again.
  //
  // This is the whole reason the seed exists rather than ordering straight off `selectedSet`. Several
  // boxes get ticked in one visit here, and reordering on each tick would slide the next row up into
  // the place the cursor was already travelling to, so the second tick lands on the wrong row. The
  // list has to stand still while it is in front of you.
  const [orderSeed, setOrderSeed] = useState(() => new Set());

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    const matches = !q
      ? normalized
      : normalized.filter((o) => String(o.label || '').toLowerCase().includes(q));
    return selectedFirst(matches, (o) => orderSeed.has(String(o.value)));
  }, [normalized, query, orderSeed]);

  // Both ways in go through here — the trigger and the keyboard — so the order is seeded however the
  // panel was opened.
  const openPanel = useCallback(() => {
    setOrderSeed(new Set(selectedSet));
    setOpen(true);
  }, [selectedSet]);

  const display = useMemo(() => {
    if (!selectedSet.size) return '';
    return normalized
      .filter((o) => selectedSet.has(String(o.value)))
      .map((o) => o.label)
      .join(', ');
  }, [normalized, selectedSet]);

  const updatePanelPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    setPanelPos(dropdownPanelPosition(el.getBoundingClientRect(), {
      minWidth: 200,
      gap: 2,
      maxHeight: 300,
    }));
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

  const toggleValue = (val) => {
    const key = String(val);
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(next));
  };

  const clearAll = () => onChange([]);

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
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
              borderRadius: 5,
              boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: panelPos.maxHeight,
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
              {(emptyLabel || placeholder) ? (
                <li>
                  <label
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', cursor: 'pointer', fontSize: 13,
                      color: '#666', fontStyle: 'italic', borderRadius: 4,
                      background: selectedSet.size === 0 ? '#e3f2fd' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.size === 0}
                      onChange={clearAll}
                      style={{ margin: 0 }}
                    />
                    {emptyLabel || placeholder}
                  </label>
                </li>
              ) : null}
              {filtered.map((o) => {
                const checked = selectedSet.has(String(o.value));
                return (
                  <li key={String(o.value)}>
                    <label
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 10px', cursor: 'pointer', fontSize: 13,
                        color: '#2c3e50', borderRadius: 4,
                        background: checked ? '#e3f2fd' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleValue(o.value)}
                        style={{ margin: 0 }}
                      />
                      {o.label}
                    </label>
                  </li>
                );
              })}
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
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openPanel();
        }}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault();
            openPanel();
          }
        }}
        style={{
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
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {display || emptyLabel || placeholder || '—'}
        </span>
        <span style={{ color: '#999', fontSize: 10, marginLeft: 8, flexShrink: 0 }}>▼</span>
      </div>
      {panel}
    </>
  );
}
