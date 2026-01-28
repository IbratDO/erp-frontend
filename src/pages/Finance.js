import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import './TablePage.css';

const Finance = () => {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('records'); // 'records', 'receivables', 'payables'
  const [records, setRecords] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [payables, setPayables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseFormData, setExpenseFormData] = useState({
    expense_type: 'lunch',
    currency: 'USD',
    payment_type: 'cash',
    amount: '',
    recipient: '',
    notes: '',
  });
  const [workers, setWorkers] = useState([]);
  const [filter, setFilter] = useState({
    type: '',
    status: '',
    expense_type: '',
    currency: '',
    payment_type: '',
    year: '',
    month: '',
  });

  const fetchWorkers = useCallback(async () => {
    try {
      const response = await api.get('/workers/');
      setWorkers(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching workers:', error);
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      let url = '/finance/';
      const params = new URLSearchParams();
      if (filter.type) params.append('type', filter.type);
      if (filter.status) params.append('status', filter.status);
      if (filter.expense_type) params.append('expense_type', filter.expense_type);
      if (filter.currency) params.append('currency', filter.currency);
      if (filter.payment_type) params.append('payment_type', filter.payment_type);
      
      // Convert year/month to date range
      if (filter.year || filter.month) {
        let dateFrom, dateTo;
        if (filter.year && filter.month) {
          // Specific year and month
          dateFrom = `${filter.year}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(parseInt(filter.year), parseInt(filter.month), 0).getDate();
          dateTo = `${filter.year}-${filter.month.padStart(2, '0')}-${lastDay}`;
        } else if (filter.year) {
          // Entire year
          dateFrom = `${filter.year}-01-01`;
          dateTo = `${filter.year}-12-31`;
        } else if (filter.month) {
          // Current year, specific month
          const currentYear = new Date().getFullYear();
          dateFrom = `${currentYear}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(currentYear, parseInt(filter.month), 0).getDate();
          dateTo = `${currentYear}-${filter.month.padStart(2, '0')}-${lastDay}`;
        }
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
      }
      
      if (params.toString()) url += `?${params.toString()}`;

      const response = await api.get(url);
      setRecords(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching finance records:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const fetchReceivables = useCallback(async () => {
    try {
      let url = '/receivables/';
      const params = new URLSearchParams();
      // By default, backend only returns pending, but allow override
      if (filter.status) params.append('status', filter.status);
      
      // Convert year/month to date range
      if (filter.year || filter.month) {
        let dateFrom, dateTo;
        if (filter.year && filter.month) {
          dateFrom = `${filter.year}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(parseInt(filter.year), parseInt(filter.month), 0).getDate();
          dateTo = `${filter.year}-${filter.month.padStart(2, '0')}-${lastDay}`;
        } else if (filter.year) {
          dateFrom = `${filter.year}-01-01`;
          dateTo = `${filter.year}-12-31`;
        } else if (filter.month) {
          const currentYear = new Date().getFullYear();
          dateFrom = `${currentYear}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(currentYear, parseInt(filter.month), 0).getDate();
          dateTo = `${currentYear}-${filter.month.padStart(2, '0')}-${lastDay}`;
        }
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
      }
      
      if (params.toString()) url += `?${params.toString()}`;

      const response = await api.get(url);
      setReceivables(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching receivables:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPayables = async () => {
    try {
      let url = '/payables/';
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      
      // Convert year/month to date range
      if (filter.year || filter.month) {
        let dateFrom, dateTo;
        if (filter.year && filter.month) {
          dateFrom = `${filter.year}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(parseInt(filter.year), parseInt(filter.month), 0).getDate();
          dateTo = `${filter.year}-${filter.month.padStart(2, '0')}-${lastDay}`;
        } else if (filter.year) {
          dateFrom = `${filter.year}-01-01`;
          dateTo = `${filter.year}-12-31`;
        } else if (filter.month) {
          const currentYear = new Date().getFullYear();
          dateFrom = `${currentYear}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(currentYear, parseInt(filter.month), 0).getDate();
          dateTo = `${currentYear}-${filter.month.padStart(2, '0')}-${lastDay}`;
        }
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
      }
      
      if (params.toString()) url += `?${params.toString()}`;

      const response = await api.get(url);
      setPayables(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching payables:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExpenseSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        record_type: 'expense',
        expense_type: expenseFormData.expense_type,
        amount: expenseFormData.amount || 0,
        currency: expenseFormData.currency,
        payment_type: expenseFormData.payment_type,
        recipient: expenseFormData.recipient || null,
        notes: expenseFormData.notes,
        status: 'completed',
      };

      await api.post('/finance/', payload);
      setShowExpenseForm(false);
      setExpenseFormData({
        expense_type: 'lunch',
        currency: 'USD',
        payment_type: 'cash',
        amount: '',
        recipient: '',
        notes: '',
      });
      fetchRecords();
      fetchWorkers(); // Refresh workers list after creating expense
    } catch (error) {
      console.error('Error creating expense:', error);
      // Handle validation errors from DRF
      const errorMessage = error.response?.data?.detail || 
                          error.response?.data?.non_field_errors?.[0] ||
                          (Array.isArray(error.response?.data) ? error.response.data[0] : null) ||
                          'Error creating expense';
      alert(errorMessage);
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  // Calculate statistics separately for USD and UZS
  const totalIncomeUSD = records
    .filter((r) => r.record_type === 'income' && r.status === 'completed' && r.currency === 'USD')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const totalIncomeUZS = records
    .filter((r) => r.record_type === 'income' && r.status === 'completed' && r.currency === 'UZS')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const totalExpenseUSD = records
    .filter((r) => r.record_type === 'expense' && r.status === 'completed' && r.currency === 'USD')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const totalExpenseUZS = records
    .filter((r) => r.record_type === 'expense' && r.status === 'completed' && r.currency === 'UZS')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const netProfitUSD = totalIncomeUSD - totalExpenseUSD;
  const netProfitUZS = totalIncomeUZS - totalExpenseUZS;

  const totalReceivables = receivables
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const totalPayables = payables
    .filter((p) => p.status === 'pending')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Finance</h1>
        {isAdmin && activeTab === 'records' && (
          <button className="btn-primary" onClick={() => setShowExpenseForm(!showExpenseForm)}>
            {showExpenseForm ? 'Cancel' : '+ Add Expense'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0' }}>
        <button
          onClick={() => setActiveTab('records')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: activeTab === 'records' ? '#007bff' : 'transparent',
            color: activeTab === 'records' ? 'white' : '#666',
            cursor: 'pointer',
            borderBottom: activeTab === 'records' ? '3px solid #007bff' : '3px solid transparent',
            fontWeight: activeTab === 'records' ? '600' : '400',
          }}
        >
          Financial Records
        </button>
        <button
          onClick={() => setActiveTab('receivables')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: activeTab === 'receivables' ? '#28a745' : 'transparent',
            color: activeTab === 'receivables' ? 'white' : '#666',
            cursor: 'pointer',
            borderBottom: activeTab === 'receivables' ? '3px solid #28a745' : '3px solid transparent',
            fontWeight: activeTab === 'receivables' ? '600' : '400',
          }}
        >
          Receivables
        </button>
        <button
          onClick={() => setActiveTab('payables')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: activeTab === 'payables' ? '#dc3545' : 'transparent',
            color: activeTab === 'payables' ? 'white' : '#666',
            cursor: 'pointer',
            borderBottom: activeTab === 'payables' ? '3px solid #dc3545' : '3px solid transparent',
            fontWeight: activeTab === 'payables' ? '600' : '400',
          }}
        >
          Payables
        </button>
      </div>

      {showExpenseForm && isAdmin && activeTab === 'records' && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>Add New Expense</h2>
          <form onSubmit={handleExpenseSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Expense Type</label>
                <select
                  value={expenseFormData.expense_type}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, expense_type: e.target.value })}
                  required
                >
                  <option value="salary">Salary</option>
                  <option value="lunch">Lunch</option>
                  <option value="taxi">Taxi</option>
                  <option value="office_supplies">Office Supplies</option>
                  <option value="utilities">Utilities</option>
                  <option value="rent">Rent</option>
                  <option value="delivery">Delivery</option>
                  <option value="cargo">Cargo</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Currency</label>
                <select
                  value={expenseFormData.currency}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, currency: e.target.value })}
                  required
                >
                  <option value="USD">USD</option>
                  <option value="UZS">UZS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Payment Type</label>
                <select
                  value={expenseFormData.payment_type}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, payment_type: e.target.value })}
                  required
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={expenseFormData.amount}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, amount: e.target.value })}
                  required
                />
              </div>
              {(expenseFormData.expense_type === 'salary' || expenseFormData.expense_type === 'lunch') && (
                <div className="form-group">
                  <label>Recipient *</label>
                  <select
                    value={expenseFormData.recipient}
                    onChange={(e) => setExpenseFormData({ ...expenseFormData, recipient: e.target.value })}
                    required
                  >
                    <option value="">Select recipient</option>
                    {workers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.name} {worker.telephone ? `(${worker.telephone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Notes (Optional)</label>
                <textarea
                  value={expenseFormData.notes}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, notes: e.target.value })}
                  rows="2"
                  placeholder={expenseFormData.expense_type === 'salary' ? 'e.g., Prepayment, Monthly salary, etc.' : ''}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Add Expense
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Summary Cards - Only for Records tab */}
      {activeTab === 'records' && (
        <div className="metrics-grid" style={{ marginBottom: '20px' }}>
          <div className="metric-card">
            <div className="metric-label">Total Income (USD)</div>
            <div className="metric-value" style={{ color: '#27ae60' }}>
              {totalIncomeUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Income (UZS)</div>
            <div className="metric-value" style={{ color: '#27ae60' }}>
              {totalIncomeUZS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UZS
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Expenses (USD)</div>
            <div className="metric-value" style={{ color: '#e74c3c' }}>
              {totalExpenseUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Expenses (UZS)</div>
            <div className="metric-value" style={{ color: '#e74c3c' }}>
              {totalExpenseUZS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UZS
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Net Profit (USD)</div>
            <div className="metric-value" style={{ color: netProfitUSD >= 0 ? '#27ae60' : '#e74c3c' }}>
              {netProfitUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Net Profit (UZS)</div>
            <div className="metric-value" style={{ color: netProfitUZS >= 0 ? '#27ae60' : '#e74c3c' }}>
              {netProfitUZS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UZS
            </div>
          </div>
        </div>
      )}

      {/* Receivables Summary */}
      {activeTab === 'receivables' && (
        <div className="metrics-grid" style={{ marginBottom: '20px' }}>
          <div className="metric-card" style={{ border: '2px solid #28a745' }}>
            <div className="metric-label">Total Receivables (Pending)</div>
            <div className="metric-value" style={{ color: '#28a745', fontSize: '2em' }}>
              ${totalReceivables.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Receivables (All)</div>
            <div className="metric-value">
              ${receivables.reduce((sum, r) => sum + parseFloat(r.amount), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      )}

      {/* Payables Summary */}
      {activeTab === 'payables' && (
        <div className="metrics-grid" style={{ marginBottom: '20px' }}>
          <div className="metric-card" style={{ border: '2px solid #dc3545' }}>
            <div className="metric-label">Total Payables (Pending)</div>
            <div className="metric-value" style={{ color: '#dc3545', fontSize: '2em' }}>
              ${totalPayables.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Payables (All)</div>
            <div className="metric-value">
              ${payables.reduce((sum, p) => sum + parseFloat(p.amount), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="form-card" style={{ marginBottom: '20px' }}>
        <div className="form-grid">
          {activeTab === 'records' && (
            <>
              <div className="form-group">
                <label>Type</label>
                <select
                  value={filter.type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    setFilter({ 
                      ...filter, 
                      type: newType,
                      expense_type: newType === 'expense' ? filter.expense_type : ''
                    });
                  }}
                >
                  <option value="">All Types</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
              {(filter.type === 'expense' || filter.type === '') && (
                <div className="form-group">
                  <label>Expense Type</label>
                  <select
                    value={filter.expense_type}
                    onChange={(e) => setFilter({ ...filter, expense_type: e.target.value })}
                  >
                    <option value="">All Expense Types</option>
                    <option value="salary">Salary</option>
                    <option value="lunch">Lunch</option>
                    <option value="taxi">Taxi</option>
                    <option value="delivery">Delivery</option>
                    <option value="cargo">Cargo</option>
                    <option value="office_supplies">Office Supplies</option>
                    <option value="utilities">Utilities</option>
                    <option value="rent">Rent</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              )}
            </>
          )}
          {(activeTab === 'receivables' || activeTab === 'payables') && (
            <div className="form-group">
              <label>Status</label>
              <select
                value={filter.status}
                onChange={(e) => setFilter({ ...filter, status: e.target.value })}
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          )}
          {activeTab === 'records' && (
            <div className="form-group">
              <label>Status</label>
              <select
                value={filter.status}
                onChange={(e) => setFilter({ ...filter, status: e.target.value })}
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Year</label>
            <select
              value={filter.year}
              onChange={(e) => setFilter({ ...filter, year: e.target.value })}
            >
              <option value="">All Years</option>
              {Array.from({ length: 10 }, (_, i) => {
                const year = new Date().getFullYear() - i;
                return (
                  <option key={year} value={year.toString()}>
                    {year}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="form-group">
            <label>Month</label>
            <select
              value={filter.month}
              onChange={(e) => setFilter({ ...filter, month: e.target.value })}
            >
              <option value="">All Months</option>
              <option value="1">January</option>
              <option value="2">February</option>
              <option value="3">March</option>
              <option value="4">April</option>
              <option value="5">May</option>
              <option value="6">June</option>
              <option value="7">July</option>
              <option value="8">August</option>
              <option value="9">September</option>
              <option value="10">October</option>
              <option value="11">November</option>
              <option value="12">December</option>
            </select>
          </div>
          <div className="form-group">
            <button
              type="button"
              className="btn-edit"
              onClick={() => setFilter({ type: '', status: '', expense_type: '', currency: '', payment_type: '', year: '', month: '' })}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Financial Records Table */}
      {activeTab === 'records' && (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Expense Type</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Payment Type</th>
                <th>Status</th>
                <th>Related Order</th>
                <th>Related Sale</th>
                <th>Related Dispatch</th>
                <th>Recipient</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan="12" style={{ textAlign: 'center' }}>
                    No finance records found
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id}>
                    <td>#{record.id}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          record.record_type === 'income' ? 'confirmed' : 'pending'
                        }`}
                      >
                        {record.record_type}
                      </span>
                    </td>
                    <td>
                      {record.expense_type ? record.expense_type.replace('_', ' ') : '-'}
                    </td>
                    <td
                      style={{
                        color: record.record_type === 'income' ? '#27ae60' : '#e74c3c',
                        fontWeight: '600',
                      }}
                    >
                      {record.record_type === 'income' ? '+' : '-'}{parseFloat(record.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td>{record.currency || 'USD'}</td>
                    <td>
                      {record.payment_type ? (
                        <span className={`status-badge ${record.payment_type === 'cash' ? 'confirmed' : 'pending'}`}>
                          {record.payment_type === 'cash' ? 'Cash' : 'Card'}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      <span className={`status-badge ${record.status}`}>
                        {record.status}
                      </span>
                    </td>
                    <td>
                      {record.order ? `Order #${record.order}` : '-'}
                    </td>
                    <td>
                      {record.sale ? `Sale #${record.sale}` : '-'}
                    </td>
                    <td>
                      {record.dispatch ? `Dispatch #${record.dispatch}` : '-'}
                    </td>
                    <td>
                      {record.recipient_detail ? (
                        `${record.recipient_detail.username}${record.recipient_detail.first_name || record.recipient_detail.last_name ? ` (${record.recipient_detail.first_name} ${record.recipient_detail.last_name})`.trim() : ''}`
                      ) : '-'}
                    </td>
                    <td>{new Date(record.transaction_date).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Receivables Table */}
      {activeTab === 'receivables' && (
        <div className="table-card">
          <h2>Accounts Receivable</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Sale</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Status</th>
                <th>Created</th>
                <th>Paid Date</th>
              </tr>
            </thead>
            <tbody>
              {receivables.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center' }}>
                    No receivables found
                  </td>
                </tr>
              ) : (
                receivables.map((receivable) => (
                  <tr key={receivable.id}>
                    <td>#{receivable.id}</td>
                    <td>Sale #{receivable.sale}</td>
                    <td>
                      {receivable.sale_detail?.product_detail
                        ? `${receivable.sale_detail.product_detail.brand} ${receivable.sale_detail.product_detail.model}`
                        : '-'}
                    </td>
                    <td style={{ fontWeight: '600', color: '#28a745' }}>
                      {parseFloat(receivable.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td>{receivable.currency || 'USD'}</td>
                    <td>
                      <span className={`status-badge ${receivable.status}`}>
                        {receivable.status}
                      </span>
                    </td>
                    <td>{new Date(receivable.created_at).toLocaleString()}</td>
                    <td>
                      {receivable.paid_date
                        ? new Date(receivable.paid_date).toLocaleString()
                        : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Payables Table */}
      {activeTab === 'payables' && (
        <div className="table-card">
          <h2>Accounts Payable</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Order/Dispatch</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Status</th>
                <th>Created</th>
                <th>Paid Date</th>
              </tr>
            </thead>
            <tbody>
              {payables.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center' }}>
                    No payables found
                  </td>
                </tr>
              ) : (
                payables.map((payable) => (
                  <tr key={payable.id}>
                    <td>#{payable.id}</td>
                    <td>
                      {payable.order ? `Order #${payable.order}` : 
                       payable.dispatch ? `Dispatch #${payable.dispatch} (Sale #${payable.dispatch_detail?.sale || 'N/A'})` : 
                       '-'}
                    </td>
                    <td>
                      {payable.order_detail?.product_detail
                        ? `${payable.order_detail.product_detail.brand} ${payable.order_detail.product_detail.model}`
                        : payable.dispatch_detail?.sale_detail?.product_detail
                        ? `${payable.dispatch_detail.sale_detail.product_detail.brand} ${payable.dispatch_detail.sale_detail.product_detail.model}`
                        : '-'}
                    </td>
                    <td style={{ fontWeight: '600', color: '#dc3545' }}>
                      {parseFloat(payable.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td>{payable.currency || 'USD'}</td>
                    <td>
                      <span className={`status-badge ${payable.status}`}>
                        {payable.status}
                      </span>
                    </td>
                    <td>{new Date(payable.created_at).toLocaleString()}</td>
                    <td>
                      {payable.paid_date
                        ? new Date(payable.paid_date).toLocaleString()
                        : '-'}
                    </td>
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

export default Finance;
