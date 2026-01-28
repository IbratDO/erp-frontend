import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './TablePage.css';

const Workers = () => {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [workerPerformance, setWorkerPerformance] = useState(null);
  const [workerTransactions, setWorkerTransactions] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    telephone: '+998',
    notes: '',
  });

  useEffect(() => {
    fetchWorkers();
  }, []);

  const fetchWorkers = async () => {
    try {
      const response = await api.get('/workers/');
      setWorkers(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching workers:', error);
    } finally {
      setLoading(false);
    }
  };
  
  // Refetch workers after creating/updating
  useEffect(() => {
    if (!showForm) {
      fetchWorkers();
    }
  }, [showForm]);

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
      alert('Error fetching worker performance');
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
      alert('Error fetching worker transactions');
    }
  };

  const handleEdit = (worker) => {
    setFormData({
      id: worker.id,
      name: worker.name || '',
      telephone: worker.telephone || '+998',
      notes: worker.notes || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (formData.id) {
        await api.put(`/workers/${formData.id}/`, formData);
      } else {
        await api.post('/workers/', formData);
      }
      setShowForm(false);
      setFormData({ name: '', telephone: '+998', notes: '' });
      fetchWorkers();
    } catch (error) {
      console.error('Error saving worker:', error);
      alert(error.response?.data?.error || error.response?.data?.detail || 'Error saving worker');
    }
  };

  const handleDelete = async (workerId) => {
    if (window.confirm('Are you sure you want to delete this worker?')) {
      try {
        await api.delete(`/workers/${workerId}/`);
        fetchWorkers();
        if (selectedWorker?.id === workerId) {
          setSelectedWorker(null);
          setWorkerTransactions(null);
        }
      } catch (error) {
        console.error('Error deleting worker:', error);
        alert(error.response?.data?.error || 'Error deleting worker');
      }
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Workers</h1>
        <button className="btn-primary" onClick={() => {
          setShowForm(!showForm);
          if (!showForm) {
            setFormData({ name: '', telephone: '+998', notes: '' });
          }
        }}>
          {showForm ? 'Cancel' : '+ New Worker'}
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>{formData.id ? 'Edit Worker' : 'Add New Worker'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Telephone</label>
                <input
                  type="text"
                  value={formData.telephone}
                  onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows="3"
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {formData.id ? 'Update Worker' : 'Add Worker'}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowForm(false);
                  setFormData({ name: '', telephone: '+998', notes: '' });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Workers List */}
      <div className="table-card">
        <h2>Sales Team</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Telephone</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {workers.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center' }}>
                  No workers found
                </td>
              </tr>
            ) : (
              workers.map((worker) => (
                <tr key={worker.id}>
                  <td>#{worker.id}</td>
                  <td>{worker.name}</td>
                  <td>{worker.telephone || '-'}</td>
                  <td>{worker.notes ? (worker.notes.length > 50 ? worker.notes.substring(0, 50) + '...' : worker.notes) : '-'}</td>
                  <td>
                    <button
                      className="btn-edit"
                      onClick={() => handleEdit(worker)}
                      style={{ marginRight: '10px' }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-edit"
                      onClick={() => handleViewPerformance(worker)}
                      style={{ marginRight: '10px' }}
                    >
                      View Performance
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleViewTransactions(worker)}
                      style={{ marginRight: '10px' }}
                    >
                      View Transactions
                    </button>
                    <button
                      className="btn-edit"
                      onClick={() => handleDelete(worker.id)}
                      style={{ backgroundColor: '#e74c3c', color: 'white' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Performance View */}
      {workerPerformance && selectedWorker && (
        <div className="table-card" style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>
              Performance: {selectedWorker.name}
            </h2>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <label>
                Year:
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
                Month:
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(parseInt(e.target.value));
                    handleViewPerformance(selectedWorker);
                  }}
                  style={{ marginLeft: '5px', padding: '5px' }}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <option key={month} value={month}>
                      {new Date(2000, month - 1, 1).toLocaleString('default', { month: 'long' })}
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
                  <div className="metric-label">Period</div>
                  <div className="metric-value">{workerPerformance.period.month_name}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Total Sales</div>
                  <div className="metric-value" style={{ color: '#3498db' }}>
                    {workerPerformance.statistics.total_sales}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Completed Sales</div>
                  <div className="metric-value" style={{ color: '#27ae60' }}>
                    {workerPerformance.statistics.completed_sales}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Total Amount</div>
                  <div className="metric-value" style={{ color: '#27ae60' }}>
                    ${parseFloat(workerPerformance.statistics.total_amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>

              {/* Sales List */}
              <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>Sales Details</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Price</th>
                    <th>Total</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {workerPerformance.sales.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center' }}>
                        No sales found for this period
                      </td>
                    </tr>
                  ) : (
                    workerPerformance.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{new Date(sale.sale_date).toLocaleString()}</td>
                        <td>
                          {sale.product_detail
                            ? `${sale.product_detail.brand} ${sale.product_detail.model} - Size ${sale.product_detail.size} (${sale.product_detail.color})`
                            : `Product #${sale.product}`}
                        </td>
                        <td>{sale.quantity}</td>
                        <td>${sale.selling_price}</td>
                        <td>${sale.total_amount}</td>
                        <td>
                          {sale.sale_type === 'bought_from_shop' ? 'Shop' :
                           sale.sale_type === 'from_order' ? 'From Order' : 'Delivery'}
                        </td>
                        <td>
                          <span className={`status-badge ${sale.status}`}>
                            {sale.status}
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
              <p>No salesman found matching this worker name. Performance statistics are only available for salesmen.</p>
            </div>
          )}
        </div>
      )}

      {/* Transactions View */}
      {workerTransactions && selectedWorker && (
        <div className="table-card" style={{ marginTop: '20px' }}>
          <h2>
            Transactions: {selectedWorker.name}
          </h2>

          {/* Transaction Summary */}
          <div className="metrics-grid" style={{ marginBottom: '20px' }}>
            <div className="metric-card">
              <div className="metric-label">Total Salary</div>
              <div className="metric-value" style={{ color: '#e74c3c' }}>
                ${parseFloat(workerTransactions.summary.total_salary || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Total Lunch Expenses</div>
              <div className="metric-value" style={{ color: '#e74c3c' }}>
                ${parseFloat(workerTransactions.summary.total_lunch || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Total Prepayments</div>
              <div className="metric-value" style={{ color: '#f39c12' }}>
                ${parseFloat(workerTransactions.summary.total_prepayments || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Total Transactions</div>
              <div className="metric-value">
                {workerTransactions.summary.total_transactions}
              </div>
            </div>
          </div>

          {/* Transaction History */}
          <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>Transaction History</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Payment Type</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {workerTransactions.finance_records.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center' }}>
                    No transactions found
                  </td>
                </tr>
              ) : (
                workerTransactions.finance_records.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.transaction_date).toLocaleString()}</td>
                    <td>
                      <span className={`status-badge ${record.expense_type === 'salary' ? 'confirmed' : 'pending'}`}>
                        {record.expense_type === 'salary' ? 'Salary' : 'Lunch'}
                      </span>
                    </td>
                    <td style={{ fontWeight: '600', color: '#e74c3c' }}>
                      -${parseFloat(record.amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td>{record.currency || 'USD'}</td>
                    <td>
                      {record.payment_type ? (
                        <span className={`status-badge ${record.payment_type === 'cash' ? 'confirmed' : 'pending'}`}>
                          {record.payment_type === 'cash' ? 'Cash' : 'Card'}
                        </span>
                      ) : '-'}
                    </td>
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

