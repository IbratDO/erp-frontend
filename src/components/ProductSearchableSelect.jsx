import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { productSalePickerLabel } from '../utils/productCost';
import { layerMatchesSearch, productMatchesSearch } from '../utils/productSearch';
import useAppTranslation from '../hooks/useAppTranslation';

/**
 * Dropdown product picker with a search field inside the open panel (not a native select).
 * Pass pickerItems for one row per inventory layer ({ value, label, product }).
 */
export default function ProductSearchableSelect({
  products = [],
  pickerItems = null,
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  triggerClassName = '',
  'aria-label': ariaLabel,
  emptyHint = null,
  inventoryRows = null,
}) {
  const { t } = useAppTranslation('products');
  const resolvedPlaceholder = placeholder ?? t('picker.selectProduct');
  const resolvedAriaLabel = ariaLabel ?? t('picker.productsList');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPos, setPanelPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const tableTrigger = typeof triggerClassName === 'string' && triggerClassName.includes('batch-sale-lines__control');
  const useItems = Array.isArray(pickerItems);

  const selected = useMemo(() => {
    if (useItems) return pickerItems.find((item) => String(item.value) === String(value));
    return products.find((p) => String(p.id) === String(value));
  }, [useItems, pickerItems, products, value]);

  const filtered = useMemo(() => {
    if (useItems) {
      // Layer rows carry their own number and barcode; both are searchable, because the
      // number on the row is what staff read off the box in their hand.
      return pickerItems.filter((item) => layerMatchesSearch(item, query));
    }
    return products.filter((p) => productMatchesSearch(p, query));
  }, [useItems, pickerItems, products, query]);

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
      const tEl = triggerRef.current;
      const p = panelRef.current;
      if (tEl?.contains(e.target) || p?.contains(e.target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const display = useItems
    ? selected?.label || ''
    : selected
      ? productSalePickerLabel(selected, inventoryRows)
      : '';
  const optionCount = useItems ? pickerItems.length : products.length;
  const noOptions = optionCount === 0;

  const handleToggle = () => {
    if (disabled || noOptions) return;
    setOpen((o) => {
      const next = !o;
      if (next) setQuery('');
      return next;
    });
  };

  const handlePick = (id) => {
    onChange(String(id));
    setOpen(false);
    setQuery('');
  };

  const panel =
    open && panelPos && !noOptions
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
                placeholder={t('picker.searchProducts')}
                autoComplete="off"
                aria-label={t('picker.searchAria')}
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
              {filtered.length === 0 ? (
                <li style={{ padding: '12px 10px', color: '#666', fontSize: 14 }}>{t('picker.noMatches')}</li>
              ) : (
                filtered.map((entry) => {
                  const entryValue = useItems ? entry.value : entry.id;
                  const entryLabel = useItems ? entry.label : productSalePickerLabel(entry, inventoryRows);
                  const isSel = String(entryValue) === String(value);
                  return (
                    <li key={entryValue}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        onClick={() => handlePick(entryValue)}
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
                        {entryLabel}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )
      : null;

  const triggerStyle = tableTrigger
    ? {
        width: '100%',
        textAlign: 'left',
        cursor: disabled || noOptions ? 'not-allowed' : 'pointer',
        color: display ? '#2c3e50' : '#999',
      }
    : {
        width: '100%',
        textAlign: 'left',
        padding: '10px 12px',
        border: '1px solid #ddd',
        borderRadius: 5,
        fontSize: 14,
        fontFamily: 'inherit',
        background: noOptions ? '#f5f5f5' : '#fff',
        cursor: disabled || noOptions ? 'not-allowed' : 'pointer',
        color: display ? '#2c3e50' : '#999',
      };

  return (
    <div className={className} style={{ position: 'relative', width: '100%' }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || noOptions}
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={resolvedAriaLabel}
        className={triggerClassName || undefined}
        style={triggerStyle}
      >
        {noOptions ? t('picker.noProductsInStock') : display || resolvedPlaceholder}
      </button>
      {panel}
      {emptyHint && noOptions ? (
        <div style={{ marginTop: 6, fontSize: 13 }}>{emptyHint}</div>
      ) : null}
    </div>
  );
}
