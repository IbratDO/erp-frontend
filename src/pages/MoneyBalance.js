import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import './TablePage.css';

const MoneyBalance = () => {
  const { user, isAdmin } = useAuth();
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdjustForm, setShowAdjustForm] = useState(false);
  const [adjustFormData, setAdjustFormData] = useState({
    balance_type: 'cash',
    amount: '',
    operation: 'add',
    notes: '',
  });
  const [filter, setFilter] = useState({
    balance_type: '',
    transaction_type: '',
    currency: '',
    payment_type: '',
    year: '',
    month: '',
  });

  useEffect(() => {
    fetchBalances();
    fetchTransactions();
  }, [filter]);

  const fetchBalances = async () => {
    try {
      const response = await api.get('/cash-balance/');
      const balancesList = response.data.results || response.data;
      
      // Ensure all four balance types exist
      const balanceTypes = ['usd_cash', 'uzs_cash', 'usd_card', 'uzs_card'];
      const existingTypes = balancesList.map(b => b.balance_type);
      
      for (const type of balanceTypes) {
        if (!existingTypes.includes(type)) {
          try {
            await api.post('/cash-balance/', {
              balance_type: type,
              balance: 0,
            });
          } catch (error) {
            console.error(`Error creating balance ${type}:`, error);
          }
        }
      }
      
      // Refetch after creating missing balances
      const updatedResponse = await api.get('/cash-balance/');
      setBalances(updatedResponse.data.results || updatedResponse.data);
    } catch (error) {
      console.error('Error fetching balances:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      let url = '/balance-transactions/';
      const params = new URLSearchParams();
      if (filter.balance_type) params.append('balance_type', filter.balance_type);
      if (filter.transaction_type) params.append('transaction_type', filter.transaction_type);
      if (filter.currency) {
        // Map currency to balance types
        if (filter.currency === 'USD') {
          params.append('balance_type', filter.balance_type || 'usd_cash');
        } else if (filter.currency === 'UZS') {
          params.append('balance_type', filter.balance_type || 'uzs_cash');
        }
      }
      // Convert year/month to date range
      if (filter.year || filter.month) {
        let dateFrom, dateTo;
        if (filter.year && filter.month) {
          // Specific year and month
          dateFrom = `${filter.year}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(parseInt(filter.year), parseInt(filter.month), 0).getDate();
          dateTo = `${filter.year}-${filter.month.padStart(2, '0')}-${lastDay}`;
        } else if (filter.year) {
          // Year only
          dateFrom = `${filter.year}-01-01`;
          dateTo = `${filter.year}-12-31`;
        }
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
      }
      if (params.toString()) url += `?${params.toString()}`;

      const response = await api.get(url);
      let transactions = response.data.results || response.data;
      
      // Filter by payment_type if specified (for sale_income transactions)
      if (filter.payment_type) {
        transactions = transactions.filter(tx => {
          // This is a simplified filter - you may need to enhance based on transaction notes
          return true; // For now, we'll filter on backend if needed
        });
      }
      
      setTransactions(transactions);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const handleAdjust = async (e) => {
    e.preventDefault();
    try {
      const balance = balances.find(b => b.balance_type === adjustFormData.balance_type);
      if (!balance) {
        alert('Balance not found');
        return;
      }

      await api.post(`/cash-balance/${balance.id}/adjust/`, {
        amount: adjustFormData.amount,
        operation: adjustFormData.operation,
        notes: adjustFormData.notes,
      });

      setShowAdjustForm(false);
      setAdjustFormData({
        balance_type: 'usd_cash',
        amount: '',
        operation: 'add',
        notes: '',
      });
      fetchBalances();
      fetchTransactions();
    } catch (error) {
      console.error('Error adjusting balance:', error);
      alert(error.response?.data?.error || 'Error adjusting balance');
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  const getBalanceDisplay = (balanceType) => {
    const balance = balances.find(b => b.balance_type === balanceType);
    return balance ? parseFloat(balance.balance).toLocaleString() : '0.00';
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Money Balance</h1>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setShowAdjustForm(!showAdjustForm)}>
            {showAdjustForm ? 'Cancel' : '+ Adjust Balance'}
          </button>
        )}
      </div>

      {/* Balance Cards */}
      <div className="metrics-grid" style={{ marginBottom: '30px' }}>
        <div className="metric-card" style={{ backgroundColor: '#f8f9fa', border: '2px solid #28a745' }}>
          <div className="metric-label">USD Cash Balance</div>
          <div className="metric-value" style={{ color: '#28a745', fontSize: '2em' }}>
            ${getBalanceDisplay('usd_cash')}
          </div>
        </div>
        <div className="metric-card" style={{ backgroundColor: '#f8f9fa', border: '2px solid #20c997' }}>
          <div className="metric-label">UZS Cash Balance</div>
          <div className="metric-value" style={{ color: '#20c997', fontSize: '2em' }}>
            {getBalanceDisplay('uzs_cash').toLocaleString()} UZS
          </div>
        </div>
        <div className="metric-card" style={{ backgroundColor: '#f8f9fa', border: '2px solid #007bff' }}>
          <div className="metric-label">USD Card Balance</div>
          <div className="metric-value" style={{ color: '#007bff', fontSize: '2em' }}>
            ${getBalanceDisplay('usd_card')}
          </div>
        </div>
        <div className="metric-card" style={{ backgroundColor: '#f8f9fa', border: '2px solid #6f42c1' }}>
          <div className="metric-label">UZS Card Balance</div>
          <div className="metric-value" style={{ color: '#6f42c1', fontSize: '2em' }}>
            {getBalanceDisplay('uzs_card').toLocaleString()} UZS
          </div>
        </div>
      </div>

      {/* Manual Adjustment Form */}
      {showAdjustForm && isAdmin && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>Adjust Balance</h2>
          <form onSubmit={handleAdjust}>
            <div className="form-grid">
              <div className="form-group">
                <label>Balance Type</label>
                <select
                  value={adjustFormData.balance_type}
                  onChange={(e) => setAdjustFormData({ ...adjustFormData, balance_type: e.target.value })}
                  required
                >
                  <option value="usd_cash">USD Cash</option>
                  <option value="uzs_cash">UZS Cash</option>
                  <option value="usd_card">USD Card</option>
                  <option value="uzs_card">UZS Card</option>
                </select>
              </div>
              <div className="form-group">
                <label>Operation</label>
                <select
                  value={adjustFormData.operation}
                  onChange={(e) => setAdjustFormData({ ...adjustFormData, operation: e.target.value })}
                  required
                >
                  <option value="add">Add Money</option>
                  <option value="subtract">Subtract Money</option>
                </select>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={adjustFormData.amount}
                  onChange={(e) => setAdjustFormData({ ...adjustFormData, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Notes (Optional)</label>
                <textarea
                  value={adjustFormData.notes}
                  onChange={(e) => setAdjustFormData({ ...adjustFormData, notes: e.target.value })}
                  rows="2"
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Adjust Balance
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="form-card" style={{ marginBottom: '20px' }}>
        <h3>Transaction History Filters</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Balance Type</label>
            <select
              value={filter.balance_type}
              onChange={(e) => setFilter({ ...filter, balance_type: e.target.value })}
            >
              <option value="">All Balances</option>
              <option value="usd_cash">USD Cash</option>
              <option value="uzs_cash">UZS Cash</option>
              <option value="usd_card">USD Card</option>
              <option value="uzs_card">UZS Card</option>
            </select>
          </div>
          <div className="form-group">
            <label>Currency</label>
            <select
              value={filter.currency}
              onChange={(e) => {
                const currency = e.target.value;
                setFilter({ 
                  ...filter, 
                  currency: currency,
                  // Auto-set balance_type if currency selected
                  balance_type: currency ? (currency === 'USD' ? 'usd_cash' : 'uzs_cash') : filter.balance_type
                });
              }}
            >
              <option value="">All Currencies</option>
              <option value="USD">USD</option>
              <option value="UZS">UZS</option>
            </select>
          </div>
          <div className="form-group">
            <label>Payment Type</label>
            <select
              value={filter.payment_type}
              onChange={(e) => setFilter({ ...filter, payment_type: e.target.value })}
            >
              <option value="">All Payment Types</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
            </select>
          </div>
          <div className="form-group">
            <label>Transaction Type</label>
            <select
              value={filter.transaction_type}
              onChange={(e) => setFilter({ ...filter, transaction_type: e.target.value })}
            >
              <option value="">All Types</option>
              <option value="manual_adjustment">Manual Adjustment</option>
              <option value="sale_income">Sale Income</option>
              <option value="order_expense">Order Expense</option>
              <option value="cargo_expense">Cargo Expense</option>
              <option value="delivery_expense">Delivery Expense</option>
              <option value="other_expense">Other Expense</option>
              <option value="other_income">Other Income</option>
            </select>
          </div>
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
              onClick={() => setFilter({ balance_type: '', transaction_type: '', currency: '', payment_type: '', year: '', month: '' })}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Transaction History */}
      <div className="table-card">
        <h2>Transaction History</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Balance Type</th>
              <th>Transaction Type</th>
              <th>Operation</th>
              <th>Amount</th>
              <th>Related Sale</th>
              <th>Related Order</th>
              <th>Created By</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center' }}>
                  No transactions found
                </td>
              </tr>
            ) : (
              transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{new Date(transaction.timestamp).toLocaleString()}</td>
                  <td>
                    <span className={`status-badge ${transaction.balance_detail?.balance_type || ''}`}>
                      {transaction.balance_detail?.balance_type === 'usd_cash' ? 'USD Cash' :
                       transaction.balance_detail?.balance_type === 'uzs_cash' ? 'UZS Cash' :
                       transaction.balance_detail?.balance_type === 'usd_card' ? 'USD Card' :
                       transaction.balance_detail?.balance_type === 'uzs_card' ? 'UZS Card' :
                       transaction.balance_detail?.balance_type || '-'}
                    </span>
                  </td>
                  <td>{transaction.transaction_type.replace('_', ' ')}</td>
                  <td>
                    <span style={{ color: transaction.operation === 'add' ? '#28a745' : '#dc3545', fontWeight: '600' }}>
                      {transaction.operation === 'add' ? '+' : '-'}
                    </span>
                  </td>
                  <td style={{ fontWeight: '600' }}>
                    {transaction.balance_detail?.balance_type?.includes('uzs') ? 
                      `${parseFloat(transaction.amount).toLocaleString()} UZS` :
                      `$${parseFloat(transaction.amount).toLocaleString()}`}
                  </td>
                  <td>
                    {transaction.related_sale ? `Sale #${transaction.related_sale}` : '-'}
                  </td>
                  <td>
                    {transaction.related_order ? `Order #${transaction.related_order}` : '-'}
                  </td>
                  <td>{transaction.created_by_detail?.username || '-'}</td>
                  <td>{transaction.notes || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MoneyBalance;

