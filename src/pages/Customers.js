import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../utils/api';
import Modal from '../components/Modal';
import apiGetAll from '../utils/fetchAllPages';
import { formatDisplayAmount, formatAmountByBalanceType, formatPlainAmount } from '../utils/currencyFormat';
import PageTitle from '../components/PageTitle';
import './TablePage.css';
import SortableTh from '../components/SortableTh';
import FilterPanel from '../components/FilterPanel';
import { useClientTableSort } from '../utils/tableSort';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import { formatAppDateTime } from '../utils/localeFormat';
import BusyForm, { SubmitButton } from '../components/BusyForm';
import ActionButton from '../components/ActionButton';
import TableDownloadButton from '../components/TableDownloadButton';

function customerProductLine(detail, t) {
  if (!detail) return '';
  return t('history.productLine', {
    brand: detail.brand || '',
    model: detail.model || '',
    size: detail.size || '',
    color: detail.color || '',
  });
}

const CUSTOMER_SORT_ACCESSORS = {
  name: (c) => String(c.name ?? '').toLowerCase(),
  telephone: (c) => String(c.telephone ?? '').toLowerCase(),
  instagram: (c) => String(c.instagram ?? '').toLowerCase(),
  region: (c) => String(c.region ?? '').toLowerCase(),
  total_sales: (c) => parseInt(c.sales_count, 10) || 0,
  returned: (c) => parseInt(c.returned_count, 10) || 0,
  on_credit: (c) => parseFloat(c.on_credit_outstanding) || 0,
};

const RECEIVABLE_SORT_ACCESSORS = {
  sale_id: (r) => Number(r.sale_id) || 0,
  product_label: (r) => String(r.product_label ?? '').toLowerCase(),
  amount: (r) => parseFloat(r.amount) || 0,
};

const HISTORY_ORDER_SORT_ACCESSORS = {
  created_at: (o) => new Date(o.created_at).getTime() || 0,
  product: (o) =>
    o.product_detail
      ? `${o.product_detail.brand ?? ''} ${o.product_detail.model ?? ''} size ${o.product_detail.size ?? ''} ${o.product_detail.color ?? ''}`
          .trim()
          .toLowerCase()
      : String(o.product ?? '').toLowerCase(),
  ordered_quantity: (o) => parseInt(o.ordered_quantity, 10) || 0,
  order_type: (o) => String(o.order_type ?? '').toLowerCase(),
  status: (o) => String(o.status ?? '').toLowerCase(),
  advance_payment_amount: (o) => parseFloat(o.advance_payment_amount) || 0,
};

const HISTORY_SALE_SORT_ACCESSORS = {
  sale_date: (s) => new Date(s.sale_date).getTime() || 0,
  product: (s) =>
    s.product_detail
      ? `${s.product_detail.brand ?? ''} ${s.product_detail.model ?? ''} size ${s.product_detail.size ?? ''} ${s.product_detail.color ?? ''}`
          .trim()
          .toLowerCase()
      : String(s.product ?? '').toLowerCase(),
  quantity: (s) => parseInt(s.quantity, 10) || 0,
  selling_price: (s) => parseFloat(s.selling_price) || 0,
  total_amount: (s) => parseFloat(s.total_amount) || 0,
  sale_type: (s) => String(s.sale_type ?? '').toLowerCase(),
  status: (s) => String(s.status ?? '').toLowerCase(),
};

const BALANCE_TX_SORT_ACCESSORS = {
  timestamp: (t) => new Date(t.timestamp).getTime() || 0,
  transaction_type_key: (t) => String(t.transaction_type ?? '').toLowerCase(),
  amount: (t) => parseFloat(t.amount) || 0,
  currency: (t) => {
    const bt = (t.balance_detail?.balance_type || '').toLowerCase();
    if (bt.startsWith('uzs')) return 'uzs';
    if (bt.startsWith('usd')) return 'usd';
    return '';
  },
  notes: (t) => String(t.notes ?? '').toLowerCase(),
};

const Customers = () => {
  // The rendered table, so the download button can read exactly what is on the screen —
  // current filters, current sort, current columns. See utils/tableCsv.
  const tableRef = useRef(null);
  const { t, tStatus } = useAppTranslation(['customers', 'common', 'status', 'sales']);
  const uzsLabel = t('currency.uzs', { ns: 'common' });
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('customers.create');
  const canUpdate = hasPermission('customers.update');
  const canDelete = hasPermission('customers.delete');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerHistory, setCustomerHistory] = useState(null);
  const [filters, setFilters] = useState({
    name: '',
  });
  const [formData, setFormData] = useState({
    name: '',
    telephone: '+998',
    instagram: '',
    region: 'tashkent_city',
    notes: '',
  });
  
  const regionChoices = useMemo(
    () =>
      [
        'andijan',
        'bukhara',
        'fergana',
        'jizzakh',
        'kashkadarya',
        'khorezm',
        'namangan',
        'navoi',
        'samarkand',
        'surkhandarya',
        'syrdarya',
        'tashkent_region',
        'karakalpakstan',
        'tashkent_city',
      ].map((value) => ({
        value,
        label: t(`regions.${value}`, { ns: 'sales' }),
      })),
    [t],
  );

  const formatTxType = (type) => {
    const key = `txTypes.${type}`;
    const label = t(key, { defaultValue: '' });
    return label || type || '';
  };

  const formatSaleType = (saleType) => {
    if (saleType === 'bought_from_shop') return t('saleTypes.shop');
    if (saleType === 'from_order') return t('saleTypes.from_order');
    return t('saleTypes.delivery');
  };

  useEffect(() => {
    fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCustomers = async () => {
    try {
      const response = await apiGetAll('/customers/');
      const customersList = response.data.results || response.data;
      setCustomers(customersList);
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    const q = filters.name.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const haystack = `${c.name ?? ''} ${c.telephone ?? ''} ${c.instagram ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [customers, filters.name]);

  const customerListSort = useClientTableSort(CUSTOMER_SORT_ACCESSORS, { col: 'name', dir: 'asc' });

  const sortedFilteredCustomers = useMemo(() => {
    const rows = filteredCustomers;
    if (!rows?.length) return rows;
    return customerListSort.sortRows(rows);
  }, [filteredCustomers, customerListSort]);

  const receivableSort = useClientTableSort(RECEIVABLE_SORT_ACCESSORS);
  const sortedReceivables = useMemo(() => {
    const rows = customerHistory?.pending_receivables;
    if (!rows?.length) return rows || [];
    if (receivableSort.sortCol && RECEIVABLE_SORT_ACCESSORS[receivableSort.sortCol]) {
      return receivableSort.sortRows(rows);
    }
    return rows;
  }, [customerHistory, receivableSort]);

  const historyOrdersSort = useClientTableSort(HISTORY_ORDER_SORT_ACCESSORS);
  const sortedHistoryOrders = useMemo(() => {
    const rows = customerHistory?.orders;
    if (!rows?.length) return rows || [];
    if (historyOrdersSort.sortCol && HISTORY_ORDER_SORT_ACCESSORS[historyOrdersSort.sortCol]) {
      return historyOrdersSort.sortRows(rows);
    }
    return rows;
  }, [customerHistory, historyOrdersSort]);

  const historyPurchasesSort = useClientTableSort(HISTORY_SALE_SORT_ACCESSORS);
  const sortedHistorySales = useMemo(() => {
    const rows = customerHistory?.sales;
    if (!rows?.length) return rows || [];
    if (historyPurchasesSort.sortCol && HISTORY_SALE_SORT_ACCESSORS[historyPurchasesSort.sortCol]) {
      return historyPurchasesSort.sortRows(rows);
    }
    return rows;
  }, [customerHistory, historyPurchasesSort]);

  const balanceTxSort = useClientTableSort(BALANCE_TX_SORT_ACCESSORS);
  const combinedBalanceTransactions = useMemo(() => {
    if (!customerHistory) return [];
    return [
      ...(customerHistory.order_balance_transactions || []).map((t) => ({ ...t, source: 'order' })),
      ...(customerHistory.balance_transactions || []).map((t) => ({ ...t, source: 'sale' })),
    ].filter((t) => t.operation === 'add');
  }, [customerHistory]);

  const sortedCombinedBalanceTransactions = useMemo(() => {
    const rows = combinedBalanceTransactions;
    if (!rows.length) return rows;
    if (balanceTxSort.sortCol && BALANCE_TX_SORT_ACCESSORS[balanceTxSort.sortCol]) {
      return balanceTxSort.sortRows(rows);
    }
    return [...rows].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [combinedBalanceTransactions, balanceTxSort]);

  const customerListTotals = useMemo(() => {
    let totalSalesCount = 0;
    let returnedCount = 0;
    let onCreditSum = 0;
    for (const c of filteredCustomers) {
      totalSalesCount += parseInt(c.sales_count, 10) || 0;
      returnedCount += parseInt(c.returned_count, 10) || 0;
      onCreditSum += parseFloat(c.on_credit_outstanding) || 0;
    }
    return { totalSalesCount, returnedCount, onCreditSum };
  }, [filteredCustomers]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (formData.id) {
        await api.put(`/customers/${formData.id}/`, formData);
      } else {
        await api.post('/customers/', formData);
      }
      setShowForm(false);
      setFormData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city', notes: '' });
      fetchCustomers();
    } catch (error) {
      console.error('Error saving customer:', error);
      alert(error.response?.data?.error || error.response?.data?.detail || t('notifications.saveError'));
    }
  };

  const handleEdit = (customer) => {
        setFormData({
        id: customer.id,
        name: customer.name || '',
        telephone: customer.telephone || '+998',
        instagram: customer.instagram || '',
        region: customer.region || 'tashkent_city',
        notes: customer.notes || '',
      });
    setShowForm(true);
  };

  const handleDelete = async (customerId) => {
    if (window.confirm(t('notifications.deleteConfirm'))) {
      try {
        await api.delete(`/customers/${customerId}/`);
        fetchCustomers();
        if (selectedCustomer?.id === customerId) {
          setSelectedCustomer(null);
          setCustomerHistory(null);
        }
      } catch (error) {
        console.error('Error deleting customer:', error);
        alert(error.response?.data?.error || t('notifications.deleteError'));
      }
    }
  };

  const handleViewHistory = async (customer) => {
    try {
      const response = await api.get(`/customers/${customer.id}/history/`);
      setCustomerHistory(response.data);
      setSelectedCustomer(customer);
    } catch (error) {
      console.error('Error fetching customer history:', error);
      alert(t('notifications.historyError'));
    }
  };

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="customers" />
        {canCreate && (
        <button className="btn-primary" onClick={() => {
          setShowForm(true);
          setFormData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city', notes: '' });
        }}>
          {t('newCustomer')}
        </button>
        )}
      </div>

      <Modal
        open={showForm && (canCreate || canUpdate)}
        onClose={() => {
          setShowForm(false);
          setFormData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city', notes: '' });
        }}
        title={formData.id ? t('form.editTitle') : t('form.newTitle')}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
      >
          <BusyForm onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('name')} *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('phone')}</label>
                <input
                  type="text"
                  value={formData.telephone}
                  onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('instagram')}</label>
                <input
                  type="text"
                  value={formData.instagram}
                  onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('region')}</label>
                <select
                  value={formData.region}
                  onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                >
                  {regionChoices.map((region) => (
                    <option key={region.value} value={region.value}>
                      {region.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('notes')}</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows="3"
                />
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {formData.id ? t('form.update') : t('form.create')}
              </SubmitButton>
                <button
                  type="button"
                  className="btn-edit"
                  onClick={() => {
                    setShowForm(false);
                    setFormData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city', notes: '' });
                  }}
                >
                  {t('actions.cancel', { ns: 'common' })}
                </button>
            </div>
          </BusyForm>
      </Modal>

      {/* Filters — the page behind a dialog stays intact. */}
        <FilterPanel title={t('filters.title')} filters={filters} style={{ marginBottom: '16px' }}>
        <div className="filter-toolbar">
          <div className="filter-field filter-field--grow">
            <label>{t('filters.name')}</label>
            <input
              type="search"
              value={filters.name}
              onChange={(e) => setFilters({ ...filters, name: e.target.value })}
              placeholder={t('filters.searchPlaceholder')}
            />
          </div>
          <div className="filter-toolbar__actions">
            <button
              type="button"
              className="btn-edit"
              onClick={() => setFilters({ name: '' })}
            >
              {t('actions.clear', { ns: 'common' })}
            </button>
          </div>
        </div>
        </FilterPanel>

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Customers List */}
        <div className="table-card" style={{ flex: selectedCustomer ? '0 0 40%' : '1' }}>
          <div className="table-card__toolbar">
            <TableDownloadButton
              tableRef={tableRef}
              filename="mijozlar"
              rowCount={filteredCustomers.length}
            />
          </div>
          <div className="data-table-scroll data-table-scroll--pane">
          <table className="data-table" ref={tableRef}>
            <thead>
              <tr>
                <SortableTh columnId="name" sortCol={customerListSort.sortCol} sortDir={customerListSort.sortDir} onSort={customerListSort.onHeaderClick}>{t('table.name')}</SortableTh>
                <SortableTh columnId="telephone" sortCol={customerListSort.sortCol} sortDir={customerListSort.sortDir} onSort={customerListSort.onHeaderClick}>{t('table.telephone')}</SortableTh>
                <SortableTh columnId="instagram" sortCol={customerListSort.sortCol} sortDir={customerListSort.sortDir} onSort={customerListSort.onHeaderClick}>{t('table.instagram')}</SortableTh>
                <SortableTh columnId="region" sortCol={customerListSort.sortCol} sortDir={customerListSort.sortDir} onSort={customerListSort.onHeaderClick}>{t('table.region')}</SortableTh>
                <SortableTh columnId="total_sales" sortCol={customerListSort.sortCol} sortDir={customerListSort.sortDir} onSort={customerListSort.onHeaderClick}>{t('table.totalSales')}</SortableTh>
                <SortableTh columnId="returned" sortCol={customerListSort.sortCol} sortDir={customerListSort.sortDir} onSort={customerListSort.onHeaderClick}>{t('table.returned')}</SortableTh>
                <SortableTh columnId="on_credit" sortCol={customerListSort.sortCol} sortDir={customerListSort.sortDir} onSort={customerListSort.onHeaderClick}>{t('table.onCredit')}</SortableTh>
                <th>{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 ? (
                <tr>
                <td colSpan="8" style={{ textAlign: 'center' }}>
                  {t('table.noCustomers')}
                </td>
                </tr>
              ) : (
                sortedFilteredCustomers.map((customer) => (
                  <tr 
                    key={customer.id}
                    onClick={() => handleViewHistory(customer)}
                    style={{ 
                      cursor: 'pointer',
                      backgroundColor: selectedCustomer?.id === customer.id ? '#e3f2fd' : 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedCustomer?.id !== customer.id) {
                        e.currentTarget.style.backgroundColor = '#f5f5f5';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedCustomer?.id !== customer.id) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <td><strong>{customer.name}</strong></td>
                    <td>{customer.telephone || '-'}</td>
                    <td>{customer.instagram || '-'}</td>
                    <td>
                      {customer.region
                        ? regionChoices.find((r) => r.value === customer.region)?.label || customer.region
                        : '-'}
                    </td>
                    <td>{t('table.salesCount', { count: customer.sales_count || 0 })}</td>
                    <td>
                      {parseInt(customer.returned_count, 10) > 0
                        ? t('table.salesCount', { count: customer.returned_count })
                        : '—'}
                    </td>
                    <td style={{ fontSize: '0.9em' }}>
                      {parseFloat(customer.on_credit_outstanding || 0) > 0
                        ? customer.on_credit_outstanding
                        : '—'}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canUpdate && (
                      <button
                        className="btn-edit"
                        onClick={() => handleEdit(customer)}
                        style={{ marginRight: '5px' }}
                      >
                        {t('actions.edit', { ns: 'common' })}
                      </button>
                      )}
                      {canDelete && (
                      <ActionButton
                        className="btn-delete"
                        onClick={() => handleDelete(customer.id)}
                      >
                        {t('actions.delete', { ns: 'common' })}
                      </ActionButton>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="4" style={{ textAlign: 'right' }}>
                  {t('table.total')}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {t('table.salesCount', { count: customerListTotals.totalSalesCount })}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {customerListTotals.returnedCount > 0
                    ? t('table.salesCount', { count: customerListTotals.returnedCount })
                    : '—'}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {customerListTotals.onCreditSum > 0
                    ? customerListTotals.onCreditSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : '—'}
                </td>
                <td>—</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>

        {/* Customer History */}
        {selectedCustomer && customerHistory && (
          <div className="table-card detail-pane" style={{ flex: '1' }}>
            <div className="detail-pane-header" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>{t('history.title', { name: selectedCustomer.name })}</h2>
              <button
                className="btn-edit"
                onClick={() => {
                  setSelectedCustomer(null);
                  setCustomerHistory(null);
                }}
              >
                {t('actions.close', { ns: 'common' })}
              </button>
            </div>
            
            {/* Summary */}
            <div className="form-card" style={{ marginBottom: '20px', backgroundColor: '#f9f9f9' }}>
              <h3>{t('history.summary')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
                <div>
                  <strong>{t('history.totalSales')}</strong> {customerHistory.summary.total_sales}
                </div>
                <div>
                  <strong>{t('history.completedSales')}</strong> {customerHistory.summary.completed_sales}
                </div>
                <div>
                  <strong>{t('history.reservedSales')}</strong>{' '}
                  <span style={{ color: '#9b59b6', fontWeight: 'bold' }}>{customerHistory.summary.reserved_sales || 0}</span>
                  {customerHistory.summary.reserved_amount > 0 && (
                    <span
                      style={{ fontSize: '0.9em', color: '#666', marginLeft: '5px' }}
                      title={t('history.reservedAmountHint')}
                    >
                      ({formatPlainAmount(customerHistory.summary.reserved_amount)})
                    </span>
                  )}
                </div>
                <div>
                  <strong>{t('history.pendingSales')}</strong> {customerHistory.summary.pending_sales || 0}
                </div>
                <div>
                  <strong>{t('history.cancelledSales')}</strong> {customerHistory.summary.cancelled_sales || 0}
                </div>
                <div>
                  <strong>{t('history.totalOrders')}</strong> {customerHistory.summary.total_orders || 0}
                </div>
                <div title={t('history.advancesHint')}>
                  <strong>{t('history.totalAdvances')}</strong>{' '}
                  {formatPlainAmount(customerHistory.summary.total_advance_payments || 0)}
                </div>
                <div title={t('history.completedHint')}>
                  <strong>{t('history.totalCompleted')}</strong>{' '}
                  {formatPlainAmount(customerHistory.summary.total_amount || 0)}
                </div>
                <div title={t('history.paidHint')}>
                  <strong>{t('history.totalPaid')}</strong> {formatPlainAmount(customerHistory.summary.total_paid || 0)}
                </div>
                <div>
                  <strong>{t('history.onCreditOutstanding')}</strong>{' '}
                  {parseFloat(customerHistory.summary.on_credit_outstanding || 0) > 0
                    ? customerHistory.summary.on_credit_outstanding
                    : '0'}
                </div>
              </div>
            </div>

            {customerHistory.pending_receivables && customerHistory.pending_receivables.length > 0 && (
              <>
                <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>{t('history.receivablesTitle')}</h3>
                <div className="data-table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortableTh columnId="sale_id" sortCol={receivableSort.sortCol} sortDir={receivableSort.sortDir} onSort={receivableSort.onHeaderClick}>{t('history.saleNum')}</SortableTh>
                      <SortableTh columnId="product_label" sortCol={receivableSort.sortCol} sortDir={receivableSort.sortDir} onSort={receivableSort.onHeaderClick}>{t('history.product')}</SortableTh>
                      <SortableTh columnId="amount" sortCol={receivableSort.sortCol} sortDir={receivableSort.sortDir} onSort={receivableSort.onHeaderClick}>{t('history.amount')}</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedReceivables.map((row) => (
                      <tr key={row.receivable_id}>
                        <td>#{row.sale_id}</td>
                        <td>{row.product_label || '—'}</td>
                        <td>{formatDisplayAmount(row.amount, row.currency || 'USD')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}

            {/* Orders History */}
            {customerHistory.orders && customerHistory.orders.length > 0 && (
              <>
                <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>{t('history.ordersTitle')}</h3>
                <div className="data-table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortableTh columnId="created_at" sortCol={historyOrdersSort.sortCol} sortDir={historyOrdersSort.sortDir} onSort={historyOrdersSort.onHeaderClick}>{t('table.date', { ns: 'common' })}</SortableTh>
                      <SortableTh columnId="product" sortCol={historyOrdersSort.sortCol} sortDir={historyOrdersSort.sortDir} onSort={historyOrdersSort.onHeaderClick}>{t('history.product')}</SortableTh>
                      <SortableTh columnId="ordered_quantity" sortCol={historyOrdersSort.sortCol} sortDir={historyOrdersSort.sortDir} onSort={historyOrdersSort.onHeaderClick}>{t('history.quantity')}</SortableTh>
                      <SortableTh columnId="order_type" sortCol={historyOrdersSort.sortCol} sortDir={historyOrdersSort.sortDir} onSort={historyOrdersSort.onHeaderClick}>{t('history.type')}</SortableTh>
                      <SortableTh columnId="status" sortCol={historyOrdersSort.sortCol} sortDir={historyOrdersSort.sortDir} onSort={historyOrdersSort.onHeaderClick}>{t('history.status')}</SortableTh>
                      <SortableTh columnId="advance_payment_amount" sortCol={historyOrdersSort.sortCol} sortDir={historyOrdersSort.sortDir} onSort={historyOrdersSort.onHeaderClick}>{t('history.advancePayment')}</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHistoryOrders.map((order) => (
                      <tr key={order.id}>
                        <td>{formatAppDateTime(order.created_at)}</td>
                        <td>
                          {order.product_detail
                            ? customerProductLine(order.product_detail, t)
                            : t('history.productFallback', { id: order.product })}
                        </td>
                        <td>{order.ordered_quantity}</td>
                        <td>
                          {order.order_type === 'on_demand'
                            ? t('orderTypes.on_demand')
                            : t('orderTypes.stock')}
                        </td>
                        <td>
                          <span className={`status-badge ${order.status}`}>
                            {tStatus(order.status, 'order')}
                          </span>
                        </td>
                        <td>
                          {order.advance_payment_amount
                            ? `${formatDisplayAmount(
                                order.advance_payment_amount,
                                order.advance_payment_currency || 'USD',
                              )} (${order.advance_payment_type})`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}

            {/* Purchase History */}
            <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>{t('history.purchasesTitle')}</h3>
            <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <SortableTh columnId="sale_date" sortCol={historyPurchasesSort.sortCol} sortDir={historyPurchasesSort.sortDir} onSort={historyPurchasesSort.onHeaderClick}>{t('table.date', { ns: 'common' })}</SortableTh>
                  <SortableTh columnId="product" sortCol={historyPurchasesSort.sortCol} sortDir={historyPurchasesSort.sortDir} onSort={historyPurchasesSort.onHeaderClick}>{t('history.product')}</SortableTh>
                  <SortableTh columnId="quantity" sortCol={historyPurchasesSort.sortCol} sortDir={historyPurchasesSort.sortDir} onSort={historyPurchasesSort.onHeaderClick}>{t('history.quantity')}</SortableTh>
                  <SortableTh columnId="selling_price" sortCol={historyPurchasesSort.sortCol} sortDir={historyPurchasesSort.sortDir} onSort={historyPurchasesSort.onHeaderClick}>{t('history.price')}</SortableTh>
                  <SortableTh columnId="total_amount" sortCol={historyPurchasesSort.sortCol} sortDir={historyPurchasesSort.sortDir} onSort={historyPurchasesSort.onHeaderClick}>{t('history.total')}</SortableTh>
                  <SortableTh columnId="sale_type" sortCol={historyPurchasesSort.sortCol} sortDir={historyPurchasesSort.sortDir} onSort={historyPurchasesSort.onHeaderClick}>{t('history.type')}</SortableTh>
                  <SortableTh columnId="status" sortCol={historyPurchasesSort.sortCol} sortDir={historyPurchasesSort.sortDir} onSort={historyPurchasesSort.onHeaderClick}>{t('history.status')}</SortableTh>
                </tr>
              </thead>
              <tbody>
                {customerHistory.sales.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center' }}>
                      {t('history.noPurchases')}
                    </td>
                  </tr>
                ) : (
                  sortedHistorySales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{formatAppDateTime(sale.sale_date)}</td>
                      <td>
                        {sale.product_detail
                          ? customerProductLine(sale.product_detail, t)
                          : t('history.productFallback', { id: sale.product })}
                      </td>
                      <td>{sale.quantity}</td>
                      <td>{formatDisplayAmount(sale.selling_price, sale.sale_currency || 'USD')}</td>
                      <td>{formatDisplayAmount(sale.total_amount, sale.sale_currency || 'USD')}</td>
                      <td>{formatSaleType(sale.sale_type)}</td>
                      <td>
                        <span className={`status-badge ${sale.status}`}>
                          {tStatus(sale.status, 'sale')}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
                </div>

            {/* Transaction History */}
            <h3 style={{ marginTop: '30px', marginBottom: '10px' }}>{t('history.transactionsTitle')}</h3>
            <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <SortableTh columnId="timestamp" sortCol={balanceTxSort.sortCol} sortDir={balanceTxSort.sortDir} onSort={balanceTxSort.onHeaderClick}>{t('table.date', { ns: 'common' })}</SortableTh>
                  <SortableTh columnId="transaction_type_key" sortCol={balanceTxSort.sortCol} sortDir={balanceTxSort.sortDir} onSort={balanceTxSort.onHeaderClick}>{t('history.transactionType')}</SortableTh>
                  <SortableTh columnId="amount" sortCol={balanceTxSort.sortCol} sortDir={balanceTxSort.sortDir} onSort={balanceTxSort.onHeaderClick}>{t('history.amount')}</SortableTh>
                  <SortableTh columnId="currency" sortCol={balanceTxSort.sortCol} sortDir={balanceTxSort.sortDir} onSort={balanceTxSort.onHeaderClick}>{t('history.currency')}</SortableTh>
                  <SortableTh columnId="notes" sortCol={balanceTxSort.sortCol} sortDir={balanceTxSort.sortDir} onSort={balanceTxSort.onHeaderClick}>{t('notes')}</SortableTh>
                </tr>
              </thead>
              <tbody>
                {combinedBalanceTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center' }}>
                      {t('history.noTransactions')}
                    </td>
                  </tr>
                ) : (
                  <>
                    {sortedCombinedBalanceTransactions.map((transaction) => (
                        <tr key={`${transaction.source}-${transaction.id}`}>
                          <td>{formatAppDateTime(transaction.timestamp)}</td>
                          <td>{formatTxType(transaction.transaction_type)}</td>
                          <td>{formatAmountByBalanceType(transaction.amount, transaction.balance_detail?.balance_type)}</td>
                          <td>
                            {(() => {
                              const bt = (transaction.balance_detail?.balance_type || '').toLowerCase();
                              if (bt.startsWith('uzs')) return uzsLabel;
                              if (bt.startsWith('usd')) return t('currency.usd', { ns: 'common' });
                              return '—';
                            })()}
                          </td>
                          <td>{transaction.notes || '-'}</td>
                        </tr>
                      ))}
                  </>
                )}
              </tbody>
            </table>
                </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Customers;

