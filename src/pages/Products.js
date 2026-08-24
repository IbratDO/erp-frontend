import React, { useState, useEffect, useRef, useMemo } from 'react';
import BusyForm, { SubmitButton } from '../components/BusyForm';
import ActionButton from '../components/ActionButton';
import api from '../utils/api';
import { getCachedProducts, invalidateProductsCache, setProductsCache } from '../utils/catalogCache';
import SortableTh from '../components/SortableTh';
import { useClientTableSort } from '../utils/tableSort';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import PageTitle from '../components/PageTitle';
import FilterSearchableSelect from '../components/FilterSearchableSelect';
import FormSearchableSelect from '../components/FormSearchableSelect';
import ProductCatalogFilterFields from '../components/ProductCatalogFilterFields';
import FilterPanel from '../components/FilterPanel';
import TableDownloadButton from '../components/TableDownloadButton';
import { matchesProductCatalogFilters, getCascadedFilterOptions, getCascadedDateOptions } from '../utils/productFilterUtils';
import './TablePage.css';
import {
  categoryTypeLabel,
  productCategoryTypeOptions,
  useProductCategoryTypes,
} from '../utils/productCategoryTypes';

const PRODUCTS_SORT_ACCESSORS = {
  id: (p) => Number(p.id) || 0,
  category_type: (p) => String(p.category_type ?? '').toLowerCase(),
  category: (p) => String(p.category ?? '').toLowerCase(),
  brand: (p) => String(p.brand ?? '').toLowerCase(),
  model: (p) => String(p.model ?? '').toLowerCase(),
  size: (p) => String(p.size ?? '').toLowerCase(),
  color: (p) => String(p.color ?? '').toLowerCase(),
};

/** Normalize variant fields for duplicate checks (matches backend iexact + strip). */
const variantPart = (v) => String(v ?? '').trim().toLowerCase();

const variantKeyFromBody = (body) =>
  [variantPart(body.brand), variantPart(body.model), variantPart(body.size), variantPart(body.color)].join('|');

/** Letter apparel sizes (shown separately from numeric sizes in pickers). */
const LETTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
/** Typical numeric sizes (e.g. footwear); separate group from LETTER_SIZES in the UI. */
const NUMERIC_SIZES = Array.from({ length: 11 }, (_, i) => (36 + i).toString());
const ALL_EDITOR_SIZE_OPTIONS = [...LETTER_SIZES, ...NUMERIC_SIZES];

/** Normalize size input: comma decimal separators become dot (e.g. 41,5 → 41.5). */
function normalizeSizeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return trimmed;
  if (/^-?\d+,\d+$/.test(trimmed)) {
    return trimmed.replace(',', '.');
  }
  return trimmed;
}

function isNumericSize(value) {
  return /^-?\d+(\.\d+)?$/.test(normalizeSizeValue(value));
}

function sortLetterSizes(values) {
  return [...new Set(values)].filter(Boolean).sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }),
  );
}

function sortNumberSizes(values) {
  return [...new Set(values)].filter(Boolean).sort(
    (a, b) => Number(normalizeSizeValue(a)) - Number(normalizeSizeValue(b)),
  );
}

/** Letters A–Z, then numbers ascending (summary label / filters). */
function sortSizesCanonical(values) {
  const uniq = [...new Set(values)].filter(Boolean);
  const letters = uniq.filter((s) => !isNumericSize(s));
  const nums = uniq.filter(isNumericSize);
  return [...sortLetterSizes(letters), ...sortNumberSizes(nums)];
}

/** Split size list for grouped selects: letter vs number. */
function partitionSizesForUiGroups(sortedSizesFlat) {
  const letters = [];
  const nums = [];
  for (const s of sortedSizesFlat) {
    if (!s) continue;
    if (isNumericSize(s)) nums.push(s);
    else letters.push(s);
  }
  return {
    letters: sortLetterSizes(letters),
    nums: sortNumberSizes(nums),
  };
}

/** Custom sizes from inventory + current selection, excluding preset chips. */
function customSizesFromProductsAndSelection(products, selectedSizes) {
  const fromDb = products
    .map((p) => String(p.size ?? '').trim())
    .filter(Boolean);
  return [...new Set([...fromDb, ...selectedSizes])].filter(
    (s) => !ALL_EDITOR_SIZE_OPTIONS.includes(s),
  );
}

function apiErrorMessage(error, fallback) {
  const data = error.response?.data;
  if (!data) return error.message || fallback;
  if (typeof data === 'string') return data;
  if (typeof data.detail === 'string') return data.detail;
  if (Array.isArray(data.non_field_errors) && data.non_field_errors.length) {
    return data.non_field_errors.join(' ');
  }
  const keys = Object.keys(data);
  if (keys.length && Array.isArray(data[keys[0]])) {
    return `${keys[0]}: ${data[keys[0]][0]}`;
  }
  return fallback;
}

const Products = () => {
  // The rendered table, so the download button can read exactly what is on the screen —
  // current filters, current sort, current columns. See utils/tableCsv.
  const tableRef = useRef(null);
  const { t, monthOptions } = useAppTranslation(['products', 'common']);
  const { hasPermission } = usePermissions();

  const canCreate = hasPermission('products.create');
  const canUpdate = hasPermission('products.update');
  const canDelete = hasPermission('products.delete');
  const [products, setProducts] = useState([]);
  const knownCategoryTypes = useProductCategoryTypes();
  const productCategoryTypes = useMemo(
    () => productCategoryTypeOptions(products, t, undefined, knownCategoryTypes),
    [products, t, knownCategoryTypes],
  );
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState({ message: '', type: '', visible: false });

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type, visible: true });
    setTimeout(() => setNotification({ message: '', type: '', visible: false }), 4000);
  };
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [filters, setFilters] = useState({
    category_type: '',
    category: [],
    brand: [],
    model: [],
    sizes: [],
    color: [],
    year: '',
    month: '',
  });
  const [formData, setFormData] = useState({
    name: '',
    category_type: '',
    category: '',
    brand: '',
    model: '',
    size: '',
    color: '',
  });
  const [selectedSizes, setSelectedSizes] = useState([]);
  const [selectedColors, setSelectedColors] = useState([]);
  const [pendingCustomColor, setPendingCustomColor] = useState('');
  const [pendingCustomSize, setPendingCustomSize] = useState('');
  const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false);
  const [colorDropdownOpen, setColorDropdownOpen] = useState(false);
  const sizeDropdownRef = useRef(null);
  const colorDropdownRef = useRef(null);

  const toggleSize = (size) => {
    setSelectedSizes(prev =>
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
    );
  };

  const toggleColor = (color) => {
    const c = String(color).trim();
    if (!c) return;
    setSelectedColors(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };

  const addPendingCustomColor = () => {
    const c = pendingCustomColor.trim();
    if (!c) return;
    setSelectedColors((prev) => (prev.includes(c) ? prev : [...prev, c]));
    setPendingCustomColor('');
  };

  /** Product.size is CharField(max_length=20); allow free text like colors for new-product flow. */
  const addPendingCustomSize = () => {
    const raw = pendingCustomSize.trim();
    if (!raw) return;
    const normalized = normalizeSizeValue(raw);
    if (normalized.length > 20) {
      showNotification(t('notifications.errSizeMax'), 'error');
      return;
    }
    setSelectedSizes((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    setPendingCustomSize('');
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      const inSize = sizeDropdownRef.current?.contains(e.target);
      const inColor = colorDropdownRef.current?.contains(e.target);
      if (!inSize) setSizeDropdownOpen(false);
      if (!inColor) setColorDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchProducts = async () => {
    try {
      // Always refresh catalog after visiting Products (and after CRUD via callers).
      invalidateProductsCache();
      const productsList = await getCachedProducts(api);
      setProductsCache(productsList);
      setProducts(productsList);
      applyFilters(productsList);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };



  const applyFilters = (productsList) => {
    let filtered = productsList;

    if (filters.category_type) {
      filtered = filtered.filter((p) => p.category_type === filters.category_type);
    }
    filtered = filtered.filter((p) => matchesProductCatalogFilters(p, filters));
    if (filters.year) {
      filtered = filtered.filter(p => {
        const productYear = new Date(p.created_at || p.updated_at).getFullYear();
        return productYear.toString() === filters.year;
      });
    }
    if (filters.month) {
      filtered = filtered.filter(p => {
        const productMonth = new Date(p.created_at || p.updated_at).getMonth() + 1;
        return productMonth.toString() === filters.month;
      });
    }
    
    setFilteredProducts(filtered);
  };

  useEffect(() => {
    if (products.length > 0) {
      applyFilters(products);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, products]);

  /** Colors from catalog only (no fixed preset list). */
  const colorOptions = useMemo(() => {
    const fromDb = [...new Set(products.map((p) => p.color).filter(Boolean))];
    return fromDb.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [products]);

  const categoryTypeFilterOptions = useMemo(
    () => productCategoryTypes.map((ct) => ({ value: ct.value, label: ct.label })),
    [productCategoryTypes],
  );

  const productDateAccessor = (p) => p.created_at || p.updated_at;
  const cascadedProductOptions = useMemo(
    () => getCascadedFilterOptions(products, filters, (p) => p, sortSizesCanonical, (p, _excl) => {
      if (filters.year) {
        const y = new Date(productDateAccessor(p)).getFullYear().toString();
        if (y !== filters.year) return false;
      }
      if (filters.month) {
        const m = (new Date(productDateAccessor(p)).getMonth() + 1).toString();
        if (m !== filters.month) return false;
      }
      return true;
    }),
    [products, filters],
  );

  const categoryFilterOptions = useMemo(
    () => cascadedProductOptions.categories.map((v) => ({ value: v, label: v })),
    [cascadedProductOptions],
  );

  const brandFilterOptions = useMemo(
    () => cascadedProductOptions.brands.map((v) => ({ value: v, label: v })),
    [cascadedProductOptions],
  );

  const modelFilterOptions = useMemo(
    () => cascadedProductOptions.models.map((v) => ({ value: v, label: v })),
    [cascadedProductOptions],
  );

  const sizeFilterOptions = useMemo(() => {
    const { letters, nums } = partitionSizesForUiGroups(cascadedProductOptions.sizes);
    return [...letters, ...nums].map((size) => ({ value: size, label: size }));
  }, [cascadedProductOptions]);

  const colorFilterOptions = useMemo(
    () => cascadedProductOptions.colors.map((v) => ({ value: v, label: v })),
    [cascadedProductOptions],
  );

  const cascadedDateOpts = useMemo(
    () => getCascadedDateOptions(products, filters, productDateAccessor, (p) => p),
    [products, filters],
  );

  const yearFilterOptions = useMemo(
    () => cascadedDateOpts.years.map((y) => ({ value: y, label: y })),
    [cascadedDateOpts],
  );

  const monthFilterOptions = useMemo(
    () => cascadedDateOpts.months.map((m) => {
      const mo = monthOptions.find((o) => o.value === m);
      return { value: m, label: mo ? mo.label : m };
    }),
    [cascadedDateOpts, monthOptions],
  );

  const pickerColorOptions = useMemo(() => {
    const s = new Set([...colorOptions, ...selectedColors]);
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [colorOptions, selectedColors]);

  /** Preset + saved/custom letter sizes (alphabetical), including sizes added this session. */
  const pickerLetterSizes = useMemo(() => {
    const extras = customSizesFromProductsAndSelection(products, selectedSizes).filter(
      (s) => !isNumericSize(s),
    );
    const editExtra =
      editingProduct && formData.size && !isNumericSize(formData.size) ? [formData.size] : [];
    return sortLetterSizes([...new Set([...LETTER_SIZES, ...extras, ...editExtra])]);
  }, [products, selectedSizes, editingProduct, formData.size]);

  /** Preset + saved/custom number sizes (ascending), including sizes added this session. */
  const pickerNumericSizes = useMemo(() => {
    const extras = customSizesFromProductsAndSelection(products, selectedSizes).filter(isNumericSize);
    const editExtra =
      editingProduct && formData.size && isNumericSize(formData.size) ? [formData.size] : [];
    return sortNumberSizes([...new Set([...NUMERIC_SIZES, ...extras, ...editExtra])]);
  }, [products, selectedSizes, editingProduct, formData.size]);

  const existingVariantKeys = useMemo(() => {
    const set = new Set();
    for (const p of products) {
      set.add(variantKeyFromBody(p));
    }
    return set;
  }, [products]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = { ...formData };
    if (!payload.category_type) payload.category_type = null;
    if (payload.size) payload.size = normalizeSizeValue(payload.size);
    try {
      if (editingProduct) {
        if (selectedColors.length === 0) {
          showNotification(t('notifications.errSelectColor'), 'error');
          return;
        }
        const basePayload = { ...payload, color: selectedColors[0] };
        await api.put(`/products/${editingProduct.id}/`, basePayload);
        const extraColors = selectedColors.slice(1);
        if (extraColors.length > 0) {
          const bodies = extraColors.map((color) => ({ ...payload, color }));
          const toPost = [];
          const skippedDup = [];
          for (const body of bodies) {
            const k = variantKeyFromBody(body);
            if (existingVariantKeys.has(k)) skippedDup.push(`${body.size} / ${body.color}`);
            else toPost.push(body);
          }
          if (toPost.length === 0) {
            showNotification(t('notifications.errVariantExistsNoAdd'), 'error');
          } else {
            await Promise.all(toPost.map((body) => api.post('/products/', body)));
            if (skippedDup.length > 0) {
              showNotification(
                t('notifications.updatedWithVariants', {
                  added: toPost.length,
                  skipped: skippedDup.length,
                }),
                'success',
              );
            } else {
              showNotification(
                t('notifications.updatedWithVariantsSimple', { count: toPost.length }),
                'success',
              );
            }
          }
        } else {
          showNotification(t('notifications.updated'), 'success');
        }
      } else {
        if (!String(formData.category_type || '').trim()) {
          showNotification(t('notifications.errCategoryType'), 'error');
          return;
        }
        if (!String(formData.category || '').trim()) {
          showNotification(t('notifications.errCategory'), 'error');
          return;
        }
        if (!String(formData.brand || '').trim()) {
          showNotification(t('notifications.errBrand'), 'error');
          return;
        }
        if (!String(formData.model || '').trim()) {
          showNotification(t('notifications.errModel'), 'error');
          return;
        }
        if (selectedSizes.length === 0) {
          showNotification(t('notifications.errSelectSize'), 'error');
          return;
        }
        if (selectedColors.length === 0) {
          showNotification(t('notifications.errSelectColor'), 'error');
          return;
        }
        const combos = [];
        for (const size of selectedSizes) {
          for (const color of selectedColors) {
            combos.push({ ...payload, size: normalizeSizeValue(size), color });
          }
        }
        const toCreate = [];
        const skippedDup = [];
        for (const body of combos) {
          const k = variantKeyFromBody(body);
          if (existingVariantKeys.has(k)) skippedDup.push(`${body.size} / ${body.color}`);
          else toCreate.push(body);
        }
        if (toCreate.length === 0) {
          showNotification(t('notifications.errAlreadyIncluded'), 'error');
          return;
        }
        await Promise.all(toCreate.map((body) => api.post('/products/', body)));
        if (skippedDup.length > 0) {
          showNotification(
            t('notifications.createdWithSkipped', {
              created: toCreate.length,
              skipped: skippedDup.length,
            }),
            'success',
          );
        } else {
          showNotification(
            t('notifications.createdCombo', {
              count: toCreate.length,
              sizes: selectedSizes.length,
              colors: selectedColors.length,
            }),
            'success',
          );
        }
      }
      setShowForm(false);
      setEditingProduct(null);
      setSelectedSizes([]);
      setSelectedColors([]);
      setPendingCustomColor('');
      setPendingCustomSize('');
      setColorDropdownOpen(false);
      setSizeDropdownOpen(false);
      setFormData({
        name: '',
        category_type: '',
        category: '',
        brand: '',
        model: '',
        size: '',
        color: '',
      });
      fetchProducts();
    } catch (error) {
      console.error('Error saving product:', error);
      const msg =
        error.response?.data?.selling_price?.[0] ||
        apiErrorMessage(error, t('notifications.errSave'));
      showNotification(msg, 'error');
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setSelectedSizes([]);
    const initialColor = product.color != null ? String(product.color).trim() : '';
    setSelectedColors(initialColor ? [initialColor] : []);
    setPendingCustomColor('');
    setPendingCustomSize('');
    setColorDropdownOpen(false);
    setSizeDropdownOpen(false);
    setFormData({
      name: product.name,
      category_type: product.category_type || '',
      category: product.category || '',
      brand: product.brand,
      model: product.model,
      size: product.size,
      color: product.color,
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm(t('notifications.confirmDelete'))) {
      try {
        await api.delete(`/products/${id}/`);
        fetchProducts();
      } catch (error) {
        console.error('Error deleting product:', error);
        alert(t('notifications.errDelete'));
      }
    }
  };

  const productSort = useClientTableSort(PRODUCTS_SORT_ACCESSORS);
  const displayProducts = useMemo(
    () => productSort.sortRows(filteredProducts),
    [filteredProducts, productSort]
  );

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      {notification.visible && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 1000,
          padding: '12px 20px', borderRadius: '6px', color: 'white', fontWeight: 500,
          backgroundColor: notification.type === 'success' ? '#4caf50' : '#f44336',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)', maxWidth: '400px'
        }}>
          {notification.message}
        </div>
      )}
      <div className="page-header">
        <PageTitle ns="products" />
        {canCreate && (
        <button className="btn-primary" onClick={() => {
          setShowForm(!showForm);
          // Clear editing state and reset form when canceling or opening new form
          if (showForm || !showForm) {
            setEditingProduct(null);
            setSelectedSizes([]);
            setSelectedColors([]);
            setPendingCustomColor('');
            setPendingCustomSize('');
            setColorDropdownOpen(false);
            setSizeDropdownOpen(false);
            setFormData({
              name: '',
              category_type: '',
              category: '',
              brand: '',
              model: '',
              size: '',
              color: '',
            });
          }
        }}>
          {showForm ? t('actions.cancel', { ns: 'common' }) : `+ ${t('addProduct')}`}
        </button>
        )}
      </div>

      {showForm && (canCreate || (canUpdate && editingProduct)) && (
        <div className="form-card">
          <h2>{editingProduct ? t('editProduct') : t('newProduct')}</h2>
          <BusyForm onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>
                  {t('categoryType')}{' '}
                  {!editingProduct && <span style={{ color: '#e53e3e' }}>*</span>}
                </label>
                <FormSearchableSelect
                  value={formData.category_type}
                  onChange={(v) => setFormData({ ...formData, category_type: v })}
                  options={productCategoryTypes}
                  emptyLabel={editingProduct ? t('form.none') : t('form.selectCategoryType')}
                  placeholder={t('form.categoryTypePlaceholder')}
                  allowFreeText
                  freeTextApplyLabel={t('form.addNewCategoryType') + ': "{{query}}"'}
                  aria-label={t('categoryType')}
                />
              </div>
              <div className="form-group">
                <label>
                  {t('category')}{' '}
                  {editingProduct ? (
                    <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em' }}>{t('form.optional')}</span>
                  ) : (
                    <span style={{ color: '#e53e3e' }}>*</span>
                  )}
                </label>
                <FormSearchableSelect
                  value={formData.category}
                  onChange={(v) => setFormData({ ...formData, category: v })}
                  options={[...new Set(products.map(p => p.category).filter(Boolean))].sort()}
                  emptyLabel={editingProduct ? t('form.none') : t('form.selectCategory')}
                  placeholder={t('form.categoryPlaceholder')}
                  allowFreeText
                  freeTextApplyLabel={t('form.addNewCategory') + ': "{{query}}"'}
                  aria-label={t('category')}
                />
              </div>
              <div className="form-group">
                <label>
                  {t('brand')} {!editingProduct && <span style={{ color: '#e53e3e' }}>*</span>}
                </label>
                <FormSearchableSelect
                  value={formData.brand}
                  onChange={(v) => setFormData({ ...formData, brand: v })}
                  options={[...new Set(products.map(p => p.brand).filter(Boolean))].sort()}
                  emptyLabel={t('form.selectBrand')}
                  placeholder={t('form.brandPlaceholder')}
                  allowFreeText
                  freeTextApplyLabel={t('form.addNewBrand') + ': "{{query}}"'}
                  aria-label={t('brand')}
                />
              </div>
              <div className="form-group">
                <label>
                  {t('model')} {!editingProduct && <span style={{ color: '#e53e3e' }}>*</span>}
                </label>
                <FormSearchableSelect
                  value={formData.model}
                  onChange={(v) => setFormData({ ...formData, model: v })}
                  options={[...new Set(products.map(p => p.model).filter(Boolean))].sort()}
                  emptyLabel={t('form.selectModel')}
                  placeholder={t('form.modelPlaceholder')}
                  allowFreeText
                  freeTextApplyLabel={t('form.addNewModel') + ': "{{query}}"'}
                  aria-label={t('model')}
                />
              </div>
              <div className="form-group">
                <label>
                  {t('size')}
                  {!editingProduct ? (
                    <>
                      <span style={{ color: '#e53e3e' }}> *</span>
                      <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em', marginLeft: '6px' }}>
                        {t('form.selectAtLeastOne')}
                      </span>
                    </>
                  ) : null}
                </label>
                {editingProduct ? (
                  <select
                    value={formData.size}
                    onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                    required
                  >
                    <option value="">{t('form.selectSize')}</option>
                    <optgroup label={t('form.letterSizes')}>
                      {pickerLetterSizes.map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </optgroup>
                    <optgroup label={t('form.numberSizes')}>
                      {pickerNumericSizes.map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </optgroup>
                  </select>
                ) : (
                  <div ref={sizeDropdownRef} style={{ position: 'relative' }}>
                    {/* Dropdown trigger */}
                    <div
                      onClick={() => setSizeDropdownOpen(prev => !prev)}
                      style={{
                        padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px',
                        background: '#fff', cursor: 'pointer', userSelect: 'none',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        minHeight: '38px',
                      }}
                    >
                      <span style={{ color: selectedSizes.length === 0 ? '#999' : '#333' }}>
                        {selectedSizes.length === 0
                          ? t('form.selectSizes')
                          : sortSizesCanonical(selectedSizes).join(', ')}
                      </span>
                      <span style={{ fontSize: '0.75em', color: '#666' }}>{sizeDropdownOpen ? '▲' : '▼'}</span>
                    </div>

                    {/* Dropdown panel */}
                    {sizeDropdownOpen && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                        border: '1px solid #ccc', borderRadius: '4px', background: '#fff',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', marginTop: '2px',
                        padding: '8px',
                        display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
                      }}>
                        <div style={{
                          flexBasis: '100%',
                          marginBottom: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: '#555',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}>
                          {t('form.letterSizes')}
                        </div>
                        {pickerLetterSizes.map((size) => {
                          const isSelected = selectedSizes.includes(size);
                          return (
                            <div
                              key={`letter-${size}`}
                              onClick={() => toggleSize(size)}
                              style={{
                                padding: '6px 14px', borderRadius: '4px', cursor: 'pointer',
                                fontWeight: 600, fontSize: '0.95em', userSelect: 'none',
                                border: isSelected ? '2px solid #1976d2' : '2px solid #ddd',
                                background: isSelected ? '#1976d2' : '#f5f5f5',
                                color: isSelected ? '#fff' : '#333',
                                transition: 'all 0.15s',
                              }}
                            >
                              {size}
                            </div>
                          );
                        })}
                        <div style={{
                          flexBasis: '100%',
                          marginTop: '10px',
                          marginBottom: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: '#555',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}>
                          {t('form.numberSizes')}
                        </div>
                        {pickerNumericSizes.map((size) => {
                          const isSelected = selectedSizes.includes(size);
                          return (
                            <div
                              key={`num-${size}`}
                              onClick={() => toggleSize(size)}
                              style={{
                                padding: '6px 14px', borderRadius: '4px', cursor: 'pointer',
                                fontWeight: 600, fontSize: '0.95em', userSelect: 'none',
                                border: isSelected ? '2px solid #1976d2' : '2px solid #ddd',
                                background: isSelected ? '#1976d2' : '#f5f5f5',
                                color: isSelected ? '#fff' : '#333',
                                transition: 'all 0.15s',
                              }}
                            >
                              {size}
                            </div>
                          );
                        })}
                        <div style={{
                          flexBasis: '100%',
                          marginTop: '10px',
                          paddingTop: '10px',
                          borderTop: '1px solid #eee',
                          display: 'flex',
                          gap: '8px',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}>
                          <input
                            type="text"
                            placeholder={t('form.customSizePlaceholder')}
                            value={pendingCustomSize}
                            onChange={(e) => setPendingCustomSize(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addPendingCustomSize();
                              }
                            }}
                            maxLength={20}
                            style={{
                              flex: 1,
                              minWidth: '140px',
                              padding: '6px 10px',
                              border: '1px solid #ccc',
                              borderRadius: '4px',
                            }}
                          />
                          <button
                            type="button"
                            className="btn-edit"
                            onClick={(e) => {
                              e.preventDefault();
                              addPendingCustomSize();
                            }}
                          >
                            {t('form.addSize')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>
                  {t('color')}
                  {!editingProduct ? (
                    <>
                      <span style={{ color: '#e53e3e' }}> *</span>
                      <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em', marginLeft: '6px' }}>
                        {t('form.selectAtLeastOne')}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85em', marginLeft: '6px' }}>
                      {t('form.selectMultiple')}
                    </span>
                  )}
                </label>
                <div ref={colorDropdownRef} style={{ position: 'relative' }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setColorDropdownOpen((prev) => !prev);
                      }
                    }}
                    onClick={() => setColorDropdownOpen((prev) => !prev)}
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      background: '#fff',
                      cursor: 'pointer',
                      userSelect: 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      minHeight: '38px',
                    }}
                  >
                    <span style={{ color: selectedColors.length === 0 ? '#999' : '#333' }}>
                      {selectedColors.length === 0
                        ? t('form.selectColors')
                        : selectedColors
                            .slice()
                            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
                            .join(', ')}
                    </span>
                    <span style={{ fontSize: '0.75em', color: '#666' }}>{colorDropdownOpen ? '▲' : '▼'}</span>
                  </div>
                  {colorDropdownOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 100,
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        background: '#fff',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        marginTop: '2px',
                        padding: '8px',
                        maxHeight: '280px',
                        overflowY: 'auto',
                      }}
                    >
                      {pickerColorOptions.length > 0 ? (
                        <div
                          role="listbox"
                          aria-label={t('color')}
                          aria-multiselectable="true"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0',
                            border: '1px solid #eee',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            marginBottom: '4px',
                          }}
                        >
                          {pickerColorOptions.map((c, idx) => {
                            const isSelected = selectedColors.includes(c);
                            const isLast = idx === pickerColorOptions.length - 1;
                            return (
                              <label
                                key={c}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                  fontSize: '0.95em',
                                  borderBottom: isLast ? 'none' : '1px solid #f0f0f0',
                                  background: isSelected ? '#e8f4fd' : '#fff',
                                  transition: 'background 0.12s',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleColor(c)}
                                  style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                                />
                                <span
                                  style={{
                                    flex: 1,
                                    fontWeight: isSelected ? 600 : 400,
                                    color: '#222',
                                  }}
                                >
                                  {c}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p style={{ margin: '0 0 8px', fontSize: '0.85em', color: '#666' }}>
                          {t('form.noColorsYet')}
                        </p>
                      )}
                      <div
                        style={{
                          marginTop: pickerColorOptions.length > 0 ? '10px' : 0,
                          paddingTop: pickerColorOptions.length > 0 ? '10px' : 0,
                          borderTop: pickerColorOptions.length > 0 ? '1px solid #eee' : 'none',
                          display: 'flex',
                          gap: '8px',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <input
                          type="text"
                          placeholder={t('form.customColorPlaceholder')}
                          value={pendingCustomColor}
                          onChange={(e) => setPendingCustomColor(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addPendingCustomColor();
                            }
                          }}
                          maxLength={100}
                          style={{
                            flex: 1,
                            minWidth: '140px',
                            padding: '6px 10px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                          }}
                        />
                        <button
                          type="button"
                          className="btn-edit"
                          onClick={(e) => {
                            e.preventDefault();
                            addPendingCustomColor();
                          }}
                        >
                          {t('form.addColor')}
                        </button>
                      </div>
                    </div>
                  )}
                  {!editingProduct && selectedSizes.length > 0 && selectedColors.length > 0 && (
                    <small style={{ color: '#1976d2', marginTop: '6px', display: 'block' }}>
                      {t('form.comboPreview', {
                        sizes: selectedSizes.length,
                        colors: selectedColors.length,
                        total: selectedSizes.length * selectedColors.length,
                      })}
                    </small>
                  )}
                  {editingProduct && selectedColors.length > 1 && (
                    <small style={{ color: '#1976d2', marginTop: '6px', display: 'block' }}>
                      {t('form.editExtraColors')}
                    </small>
                  )}
                </div>
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {editingProduct ? t('form.update') : t('form.create')}
              </SubmitButton>
            </div>
          </BusyForm>
        </div>
      )}

      {/* Filters */}
      {!showForm && (
        <FilterPanel title={t('filters.title', { ns: 'common' })} filters={filters} style={{ marginBottom: '16px' }}>
        <div className="filter-toolbar">
          <div className="filter-field">
            <label>{t('categoryType')}</label>
            <FilterSearchableSelect
              value={filters.category_type}
              onChange={(v) => setFilters({ ...filters, category_type: v })}
              options={categoryTypeFilterOptions}
              emptyLabel={t('filters.allTypes')}
              placeholder={t('filters.allTypes')}
              aria-label={t('categoryType')}
            />
          </div>
          <ProductCatalogFilterFields
            filters={filters}
            onFiltersChange={setFilters}
            options={{
              categories: categoryFilterOptions.map((o) => o.value),
              brands: brandFilterOptions.map((o) => o.value),
              models: modelFilterOptions.map((o) => o.value),
              sizes: sizeFilterOptions.map((o) => o.value),
              colors: colorFilterOptions.map((o) => o.value),
            }}
            t={t}
            fieldLabels={{
              category: t('category'),
              brand: t('brand'),
              model: t('model'),
              size: t('size'),
              color: t('color'),
            }}
            emptyLabels={{
              category: t('filters.allCategories'),
              brand: t('filters.allBrands'),
              model: t('filters.allModels'),
              size: t('filters.allSizes'),
              color: t('filters.allColors'),
            }}
          />
          <div className="filter-field">
            <label>{t('filters.year', { ns: 'common' })}</label>
            <FilterSearchableSelect
              value={filters.year}
              onChange={(v) => setFilters({ ...filters, year: v })}
              options={yearFilterOptions}
              emptyLabel={t('filters.allYears', { ns: 'common' })}
              placeholder={t('filters.allYears', { ns: 'common' })}
              aria-label={t('filters.year', { ns: 'common' })}
            />
          </div>
          <div className="filter-field">
            <label>{t('filters.month', { ns: 'common' })}</label>
            <FilterSearchableSelect
              value={filters.month}
              onChange={(v) => setFilters({ ...filters, month: v })}
              options={monthFilterOptions}
              emptyLabel={monthOptions[0]?.label || ''}
              placeholder={monthOptions[0]?.label || ''}
              aria-label={t('filters.month', { ns: 'common' })}
            />
          </div>
          <div className="filter-toolbar__actions">
            <button
              type="button"
              className="btn-edit"
              onClick={() =>
                setFilters({
                  category_type: '',
                  category: [],
                  brand: [],
                  model: [],
                  sizes: [],
                  color: [],
                  year: '',
                  month: '',
                })
              }
            >
              {t('actions.clearAll', { ns: 'common' })}
            </button>
          </div>
        </div>
        </FilterPanel>
      )}

      <div className="table-card">
        <div className="table-card__toolbar">
          <TableDownloadButton
            tableRef={tableRef}
            filename="mahsulotlar"
            rowCount={filteredProducts.length}
          />
        </div>
        <div className="data-table-scroll">
        <table className="data-table" ref={tableRef}>
          <thead>
            <tr>
              <SortableTh columnId="id" sortCol={productSort.sortCol} sortDir={productSort.sortDir} onSort={productSort.onHeaderClick}>
                {t('table.id', { ns: 'common' })}
              </SortableTh>
              <SortableTh columnId="category_type" sortCol={productSort.sortCol} sortDir={productSort.sortDir} onSort={productSort.onHeaderClick}>
                {t('categoryType')}
              </SortableTh>
              <SortableTh columnId="category" sortCol={productSort.sortCol} sortDir={productSort.sortDir} onSort={productSort.onHeaderClick}>
                {t('category')}
              </SortableTh>
              <SortableTh columnId="brand" sortCol={productSort.sortCol} sortDir={productSort.sortDir} onSort={productSort.onHeaderClick}>
                {t('brand')}
              </SortableTh>
              <SortableTh columnId="model" sortCol={productSort.sortCol} sortDir={productSort.sortDir} onSort={productSort.onHeaderClick}>
                {t('model')}
              </SortableTh>
              <SortableTh columnId="size" sortCol={productSort.sortCol} sortDir={productSort.sortDir} onSort={productSort.onHeaderClick}>
                {t('size')}
              </SortableTh>
              <SortableTh columnId="color" sortCol={productSort.sortCol} sortDir={productSort.sortDir} onSort={productSort.onHeaderClick}>
                {t('color')}
              </SortableTh>
              <th>{t('table.actions', { ns: 'common' })}</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center' }}>
                  {t('noProducts')}
                </td>
              </tr>
            ) : (
              displayProducts.map((product) => {
                return (
                <tr key={product.id}>
                  <td>#{product.id}</td>
                  <td>
                    {categoryTypeLabel(product.category_type, t) || (
                      <span style={{ color: '#999' }}>—</span>
                    )}
                  </td>
                  <td>{product.category || <span style={{ color: '#999' }}>—</span>}</td>
                  <td>{product.brand}</td>
                  <td>{product.model}</td>
                  <td><strong>{product.size}</strong></td>
                  <td><strong>{product.color}</strong></td>
                  <td>
                    {canUpdate && (
                    <button
                      className="btn-edit"
                      onClick={() => handleEdit(product)}
                    >
                      {t('actions.edit', { ns: 'common' })}
                    </button>
                    )}
                    {canDelete && (
                    <ActionButton
                      className="btn-delete"
                      onClick={() => handleDelete(product.id)}
                    >
                      {t('actions.delete', { ns: 'common' })}
                    </ActionButton>
                    )}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="8" style={{ textAlign: 'right', color: '#718096', fontSize: '0.85em' }}>
                {t('productCount', { count: filteredProducts.length })}
              </td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
};

export default Products;

