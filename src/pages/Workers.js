import React, { useState, useEffect, useMemo } from 'react';
import api from '../utils/api';
import apiGetAll from '../utils/fetchAllPages';
import { formatDisplayAmount, formatPlainAmount } from '../utils/currencyFormat';
import useAppTranslation from '../hooks/useAppTranslation';
import SortableTh from '../components/SortableTh';
import { useClientTableSort } from '../utils/tableSort';
import PageTitle from '../components/PageTitle';
import { formatAppDateTime } from '../utils/localeFormat';
import './TablePage.css';

const WORKERS_SORT = {
  id: (w) => Number(w.id) || 0,
  name: (w) => String(w.name ?? '').toLowerCase(),
  login: (w) => String(w.login_username ?? '').toLowerCase(),
  telephone: (w) => String(w.telephone ?? '').toLowerCase(),
  notes: (w) => String(w.notes ?? '').toLowerCase(),
};

const WORKER_PERF_SALES_SORT = {
  date: (s) => new Date(s.sale_date).getTime() || 0,
  product: (s) =>
    s.product_detail
      ? `${s.product_detail.brand} ${s.product_detail.model}`.toLowerCase()
      : String(s.product ?? ''),
  quantity: (s) => Number(s.quantity) || 0,
  price: (s) => Number(s.selling_price) || 0,
  total: (s) => Number(s.total_amount) || 0,
  type: (s) => String(s.sale_type ?? '').toLowerCase(),
  status: (s) => String(s.status ?? '').toLowerCase(),
  customer: (s) => String(s.customer_detail?.name ?? '').toLowerCase(),
};

const WORKER_TX_SORT = {
  date: (r) => new Date(r.transaction_date).getTime() || 0,
  type: (r) => String(r.expense_type ?? '').toLowerCase(),
  amount: (r) => Number(r.amount) || 0,
  currency: (r) => String(r.currency ?? '').toLowerCase(),
  notes: (r) => String(r.notes ?? '').toLowerCase(),
};

const Workers = () => {
  const { t, tStatus, monthOptions } = useAppTranslation(['workers', 'common', 'status']);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [workerPerformance, setWorkerPerformance] = useState(null);
  const [workerTransactions, setWorkerTransactions] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  useEffect(() => {
    fetchWorkers();
  }, []);

  const fetchWorkers = async () => {
    try {
      const response = await apiGetAll('/workers/');
      setWorkers(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching workers:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleViewPerformance = async (worker) => {
    try {
      const response = await api.get(`/workers/${worker.id}/performance/`, {
        params: { year: selectedYear, month: selectedMonth }
      });
      setWorkerPerformance(response.data);
      setSelectedWorker(worker);
      setWorkerTransactions(null);
    } catch (error) {
      console.error('Error fetching worker performance:', error);
      alert(t('notifications.performanceFailed'));
    }
  };

  const handleViewTransactions = async (worker) => {
    try {
      const response = await api.get(`/workers/${worker.id}/transactions/`);
      setWorkerTransactions(response.data);
      setSelectedWorker(worker);
      setWorkerPerformance(null);
    } catch (error) {
      console.error('Error fetching worker transactions:', error);
      alert(t('notifications.transactionsFailed'));
    }
  };

  const workerSort = useClientTableSort(WORKERS_SORT);
  const perfSaleSort = useClientTableSort(WORKER_PERF_SALES_SORT);
  const workerTxSort = useClientTableSort(WORKER_TX_SORT);

  const displayWorkers = useMemo(
    () => workerSort.sortRows(workers),
    [workers, workerSort]
  );
  const displayPerfSales = useMemo(
    () => perfSaleSort.sortRows(workerPerformance?.sales || []),
    [workerPerformance?.sales, perfSaleSort]
  );
  const displayWorkerTx = useMemo(
    () => workerTxSort.sortRows(workerTransactions?.finance_records || []),
    [workerTransactions?.finance_records, workerTxSort]
  );

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="workers" />
      </div>

      <p style={{ color: '#666', marginBottom: 16, fontSize: '0.95em' }}>
        {t('intro')}
      </p>

      <div className="table-card">
        <h2>{t('salesTeam')}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <SortableTh columnId="id" sortCol={workerSort.sortCol} sortDir={workerSort.sortDir} onSort={workerSort.onHeaderClick}>
                {t('table.id')}
              </SortableTh>
              <SortableTh columnId="name" sortCol={workerSort.sortCol} sortDir={workerSort.sortDir} onSort={workerSort.onHeaderClick}>
                {t('table.name')}
              </SortableTh>
              <SortableTh columnId="login" sortCol={workerSort.sortCol} sortDir={workerSort.sortDir} onSort={workerSort.onHeaderClick}>
                {t('table.login')}
              </SortableTh>
              <SortableTh columnId="telephone" sortCol={workerSort.sortCol} sortDir={workerSort.sortDir} onSort={workerSort.onHeaderClick}>
                {t('table.telephone')}
              </SortableTh>
              <SortableTh columnId="notes" sortCol={workerSort.sortCol} sortDir={workerSort.sortDir} onSort={workerSort.onHeaderClick}>
                {t('table.notes')}
              </SortableTh>
              <th>{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {workers.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center' }}>
                  {t('table.noRows')}
                </td>
              </tr>
            ) : (
              displayWorkers.map((worker) => (
                <tr key={worker.id}>
                  <td>#{worker.id}</td>
                  <td>{worker.name}</td>
                  <td>{worker.login_username || '—'}</td>
                  <td>{worker.telephone || '-'}</td>
                  <td>{worker.notes ? (worker.notes.length > 50 ? worker.notes.substring(0, 50) + '...' : worker.notes) : '-'}</td>
                  <td>
                    <button
                      className="btn-edit"
                      onClick={() => handleViewPerformance(worker)}
                      style={{ marginRight: '10px' }}
                    >
                      {t('actions.viewPerformance')}
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleViewTransactions(worker)}
                    >
                      {t('actions.viewTransactions')}
                    </button>
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
              <td colSpan="2" style={{ textAlign: 'right' }}>
                {t('table.workerCount', { count: workers.length })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Performance View */}
      {workerPerformance && selectedWorker && (
        <div className="table-card" style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>
              {t('performance.title', { name: selectedWorker.name })}
            </h2>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <label>
                {t('performance.year')}:
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(parseInt(e.target.value));
                    handleViewPerformance(selectedWorker);
                  }}
                  style={{ marginLeft: '5px', padding: '5px' }}
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = new Date().getFullYear() - i;
                    return (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                {t('performance.month')}:
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(parseInt(e.target.value, 10));
                    handleViewPerformance(selectedWorker);
                  }}
                  style={{ marginLeft: '5px', padding: '5px' }}
                >
                  {monthOptions
                    .filter((opt) => opt.value)
                    .map((opt) => (
                      <option key={opt.value} value={parseInt(opt.value, 10)}>
                        {opt.label}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </div>

          {workerPerformance.salesman ? (
            <>
              {/* Performance Statistics */}
              <div className="metrics-grid" style={{ marginBottom: '20px' }}>
                <div className="metric-card">
                  <div className="metric-label">{t('performance.period')}</div>
                  <div className="metric-value">{workerPerformance.period.month_name}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('performance.totalSales')}</div>
                  <div className="metric-value" style={{ color: '#3498db' }}>
                    {workerPerformance.statistics.total_sales}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('performance.completedSales')}</div>
                  <div className="metric-value" style={{ color: '#27ae60' }}>
                    {workerPerformance.statistics.completed_sales}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('performance.reservedSales')}</div>
                  <div className="metric-value" style={{ color: '#9b59b6' }}>
                    {workerPerformance.statistics.reserved_sales || 0}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">{t('performance.pendingSales')}</div>
                  <div className="metric-value" style={{ color: '#f39c12' }}>
                    {workerPerformance.statistics.pending_sales || 0}
                  </div>
                </div>
                <div className="metric-card" title={t('performance.mixedCurrencyHint')}>
                  <div className="metric-label">{t('performance.totalAmountCompleted')}</div>
                  <div className="metric-value" style={{ color: '#27ae60' }}>
                    {formatPlainAmount(workerPerformance.statistics.total_amount || 0)}
                  </div>
                </div>
                <div className="metric-card" title={t('performance.mixedCurrencyHint')}>
                  <div className="metric-label">{t('performance.reservedAmount')}</div>
                  <div className="metric-value" style={{ color: '#9b59b6' }}>
                    {formatPlainAmount(workerPerformance.statistics.reserved_amount || 0)}
                  </div>
                </div>
                <div className="metric-card" title={t('performance.mixedCurrencyHint')}>
                  <div className="metric-label">{t('performance.depositsReceived')}</div>
                  <div className="metric-value" style={{ color: '#9b59b6' }}>
                    {formatPlainAmount(workerPerformance.statistics.reserved_deposits || 0)}
                  </div>
                </div>
              </div>

              {/* Sales List */}
              <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>{t('performance.salesDetails')}</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <SortableTh columnId="date" sortCol={perfSaleSort.sortCol} sortDir={perfSaleSort.sortDir} onSort={perfSaleSort.onHeaderClick}>
                      {t('tableCols.date')}
                    </SortableTh>
                    <SortableTh columnId="product" sortCol={perfSaleSort.sortCol} sortDir={perfSaleSort.sortDir} onSort={perfSaleSort.onHeaderClick}>
                      {t('tableCols.product')}
                    </SortableTh>
                    <SortableTh columnId="quantity" sortCol={perfSaleSort.sortCol} sortDir={perfSaleSort.sortDir} onSort={perfSaleSort.onHeaderClick}>
                      {t('tableCols.quantity')}
                    </SortableTh>
                    <SortableTh columnId="price" sortCol={perfSaleSort.sortCol} sortDir={perfSaleSort.sortDir} onSort={perfSaleSort.onHeaderClick}>
                      {t('tableCols.price')}
                    </SortableTh>
                    <SortableTh columnId="total" sortCol={perfSaleSort.sortCol} sortDir={perfSaleSort.sortDir} onSort={perfSaleSort.onHeaderClick}>
                      {t('tableCols.total')}
                    </SortableTh>
                    <SortableTh columnId="type" sortCol={perfSaleSort.sortCol} sortDir={perfSaleSort.sortDir} onSort={perfSaleSort.onHeaderClick}>
                      {t('tableCols.type')}
                    </SortableTh>
                    <SortableTh columnId="status" sortCol={perfSaleSort.sortCol} sortDir={perfSaleSort.sortDir} onSort={perfSaleSort.onHeaderClick}>
                      {t('tableCols.status')}
                    </SortableTh>
                    <SortableTh columnId="customer" sortCol={perfSaleSort.sortCol} sortDir={perfSaleSort.sortDir} onSort={perfSaleSort.onHeaderClick}>
                      {t('tableCols.customer')}
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {workerPerformance.sales.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center' }}>
                        {t('performance.noSales')}
                      </td>
                    </tr>
                  ) : (
                    displayPerfSales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{formatAppDateTime(sale.sale_date)}</td>
                        <td>
                          {sale.product_detail
                            ? t('performance.productSize', {
                                brand: sale.product_detail.brand,
                                model: sale.product_detail.model,
                                size: sale.product_detail.size,
                                color: sale.product_detail.color,
                              })
                            : t('performance.productFallback', { id: sale.product })}
                        </td>
                        <td>{sale.quantity}</td>
                        <td>{formatDisplayAmount(sale.selling_price, sale.sale_currency || 'USD')}</td>
                        <td>{formatDisplayAmount(sale.total_amount, sale.sale_currency || 'USD')}</td>
                        <td>{t(`saleTypes.${sale.sale_type}`, { defaultValue: sale.sale_type })}</td>
                        <td>
                          <span className={`status-badge ${sale.status}`}>
                            {tStatus(sale.status, 'sale')}
                          </span>
                        </td>
                        <td>
                          {sale.customer_detail ? sale.customer_detail.name : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
              <p>{t('performance.noSalesman')}</p>
            </div>
          )}
        </div>
      )}

      {/* Transactions View */}
      {workerTransactions && selectedWorker && (
        <div className="table-card" style={{ marginTop: '20px' }}>
          <h2>
            {t('transactions.title', { name: selectedWorker.name })}
          </h2>

          {/* Transaction Summary */}
          <div className="metrics-grid" style={{ marginBottom: '20px' }}>
            <div className="metric-card">
              <div className="metric-label">{t('transactions.totalSalary')}</div>
              <div className="metric-value" style={{ color: '#e74c3c' }}>
                ${parseFloat(workerTransactions.summary.total_salary || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">{t('transactions.totalLunch')}</div>
              <div className="metric-value" style={{ color: '#e74c3c' }}>
                ${parseFloat(workerTransactions.summary.total_lunch || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">{t('transactions.totalPrepayments')}</div>
              <div className="metric-value" style={{ color: '#f39c12' }}>
                ${parseFloat(workerTransactions.summary.total_prepayments || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">{t('transactions.totalTransactions')}</div>
              <div className="metric-value">
                {workerTransactions.summary.total_transactions}
              </div>
            </div>
          </div>

          {/* Transaction History */}
          <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>{t('transactions.history')}</h3>
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh columnId="date" sortCol={workerTxSort.sortCol} sortDir={workerTxSort.sortDir} onSort={workerTxSort.onHeaderClick}>
                  {t('tableCols.date')}
                </SortableTh>
                <SortableTh columnId="type" sortCol={workerTxSort.sortCol} sortDir={workerTxSort.sortDir} onSort={workerTxSort.onHeaderClick}>
                  {t('tableCols.type')}
                </SortableTh>
                <SortableTh columnId="amount" sortCol={workerTxSort.sortCol} sortDir={workerTxSort.sortDir} onSort={workerTxSort.onHeaderClick}>
                  {t('tableCols.amount')}
                </SortableTh>
                <SortableTh columnId="currency" sortCol={workerTxSort.sortCol} sortDir={workerTxSort.sortDir} onSort={workerTxSort.onHeaderClick}>
                  {t('tableCols.currency')}
                </SortableTh>
                <SortableTh columnId="notes" sortCol={workerTxSort.sortCol} sortDir={workerTxSort.sortDir} onSort={workerTxSort.onHeaderClick}>
                  {t('tableCols.notes')}
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {workerTransactions.finance_records.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center' }}>
                    {t('transactions.noRows')}
                  </td>
                </tr>
              ) : (
                displayWorkerTx.map((record) => (
                  <tr key={record.id}>
                    <td>{formatAppDateTime(record.transaction_date)}</td>
                    <td>
                      <span className={`status-badge ${record.expense_type === 'salary' ? 'confirmed' : 'pending'}`}>
                        {record.expense_type === 'salary' ? t('transactions.salary') : t('transactions.lunch')}
                      </span>
                    </td>
                    <td style={{ fontWeight: '600', color: '#e74c3c' }}>
                      -{formatDisplayAmount(record.amount, record.currency || 'USD')}
                    </td>
                    <td>{record.currency || 'USD'}</td>
                    <td>{record.notes || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Workers;

