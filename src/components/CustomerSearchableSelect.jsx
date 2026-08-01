import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import apiGetAll from '../utils/fetchAllPages';
import useAppTranslation from '../hooks/useAppTranslation';

function customerLabel(c) {
  if (!c) return '';
  return c.telephone ? `${c.name} — ${c.telephone}` : c.name;
}

function customerMatchesSearch(c, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = `${c.name ?? ''} ${c.telephone ?? ''}`.toLowerCase();
  return haystack.includes(q);
}

/**
 * Dropdown customer picker with a search field inside the open panel.
 */
export default function CustomerSearchableSelect({
  customers,
  value,
  onChange,
  placeholder,
  emptyLabel,
  allowEmpty = false,
  extraOptions = [],
  variant = 'default',
  disabled = false,
  className = '',
  triggerClassName = '',
  asyncSearch = false,
  searchDebounceMs = 300,
  'aria-label': ariaLabel,
}) {
  const { t } = useAppTranslation('customers');
  const resolvedPlaceholder = placeholder ?? t('select.placeholder');
  const resolvedEmptyLabel = emptyLabel ?? t('select.emptyLabel');
  const resolvedAriaLabel = ariaLabel || t('select.ariaLabel');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPos, setPanelPos] = useState(null);
  const [asyncCustomers, setAsyncCustomers] = useState([]);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const isFilter = variant === 'filter';

  const extraSelected = useMemo(
    () => extraOptions.find((o) => String(o.value) === String(value)),
    [extraOptions, value],
  );

  const sourceCustomers = asyncSearch ? asyncCustomers : customers;

  const selected = useMemo(
    () => sourceCustomers.find((c) => String(c.id) === String(value))
      || customers.find((c) => String(c.id) === String(value)),
    [sourceCustomers, customers, value],
  );

  const filtered = useMemo(
    () => (asyncSearch ? sourceCustomers : sourceCustomers.filter((c) => customerMatchesSearch(c, query))),
    [asyncSearch, sourceCustomers, query],
  );

  useEffect(() => {
    if (!asyncSearch || !open) return undefined;
    const q = String(query || '').trim();
    const timer = setTimeout(async () => {
      setAsyncLoading(true);
      try {
        const res = await apiGetAll('/customers/', {
          params: { search: q, limit: 50, lite: 1 },
        });
        setAsyncCustomers(res.data.results || res.data);
      } catch {
        setAsyncCustomers([]);
      } finally {
        setAsyncLoading(false);
      }
    }, searchDebounceMs);
    return () => clearTimeout(timer);
  }, [asyncSearch, open, query, searchDebounceMs]);

  const filteredExtraOptions = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    return extraOptions.filter((o) => !q || String(o.label || '').toLowerCase().includes(q));
  }, [extraOptions, query]);

  const showEmptyOption = useMemo(() => {
    if (!allowEmpty) return false;
    const q = String(query || '').trim().toLowerCase();
    return !q || resolvedEmptyLabel.toLowerCase().includes(q);
  }, [allowEmpty, resolvedEmptyLabel, query]);

  const updatePanelPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const w = Math.max(r.width, 280);
    const width = Math.min(w, vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const top = r.bottom + 4;
    setPanelPos({ top, left, width });
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
      const t = triggerRef.current;
      const p = panelRef.current;
      if (t?.contains(e.target) || p?.contains(e.target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const display = extraSelected
    ? extraSelected.label
    : selected
      ? customerLabel(selected)
      : allowEmpty && value === ''
        ? resolvedEmptyLabel
        : '';
  const noCustomers = !asyncSearch && !customers.length && !allowEmpty && !extraOptions.length;

  const rootClassName = [className, isFilter ? 'filter-searchable-select' : ''].filter(Boolean).join(' ');
  const mergedTriggerClassName = [triggerClassName, isFilter ? 'filter-searchable-select__trigger' : '']
    .filter(Boolean)
    .join(' ');

  const handleToggle = () => {
    if (disabled) return;
    setOpen((o) => {
      const next = !o;
      if (next) setQuery('');
      return next;
    });
  };

  const handlePick = (id) => {
    onChange(id === '' ? '' : String(id));
    setOpen(false);
    setQuery('');
  };

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={resolvedAriaLabel}
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 10050,
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 'min(340px, calc(100vh - 96px))',
            }}
          >
            <div style={{ padding: 8, borderBottom: '1px solid #eee', flexShrink: 0 }}>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('select.searchPlaceholder')}
                autoComplete="off"
                aria-label={t('select.searchAria')}
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
                      lineHeight: 1.35,
                      fontStyle: 'italic',
                    }}
                  >
                    {resolvedEmptyLabel}
                  </button>
                </li>
              ) : null}
              {filteredExtraOptions.map((opt) => {
                const isSel = String(opt.value) === String(value);
                return (
                  <li key={String(opt.value)}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      onClick={() => handlePick(opt.value)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        border: 'none',
                        background: isSel ? '#e3f2fd' : 'transparent',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        color: '#666',
                        borderRadius: 4,
                        lineHeight: 1.35,
                        fontStyle: 'italic',
                      }}
                    >
                      {opt.label}
                    </button>
                  </li>
                );
              })}
              {asyncLoading ? (
                <li style={{ padding: '12px 10px', color: '#666', fontSize: 14 }}>{t('select.loading')}</li>
              ) : null}
              {!asyncLoading && filtered.length === 0 && !showEmptyOption && filteredExtraOptions.length === 0 ? (
                <li style={{ padding: '12px 10px', color: '#666', fontSize: 14 }}>No matches</li>
              ) : (
                filtered.map((c) => {
                  const isSel = String(c.id) === String(value);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        onClick={() => handlePick(c.id)}
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
                          lineHeight: 1.35,
                        }}
                      >
                        {customerLabel(c)}
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

  const triggerStyle = isFilter
    ? {
        width: '100%',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: display ? '#212529' : '#6c757d',
      }
    : {
        width: '100%',
        textAlign: 'left',
        padding: '10px 12px',
        border: '1px solid #ddd',
        borderRadius: 5,
        fontSize: 14,
        fontFamily: 'inherit',
        background: disabled ? '#f5f5f5' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: display ? '#2c3e50' : '#999',
      };

  return (
    <div
      className={rootClassName || undefined}
      style={{ position: 'relative', width: isFilter ? 'auto' : '100%' }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={resolvedAriaLabel}
        className={mergedTriggerClassName || undefined}
        style={triggerStyle}
      >
        {display || resolvedPlaceholder}
      </button>
      {panel}
      {noCustomers && !allowEmpty ? (
        <div style={{ marginTop: 6, fontSize: 13, color: '#666' }}>{t('select.noCustomers')}</div>
      ) : null}
    </div>
  );
}
