import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './TablePage.css';

const Returns = () => {
  const [returns, setReturns] = useState([]);
  const [filteredReturns, setFilteredReturns] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({
    brand: '',
    size: '',
    color: '',
    reason: '',
    year: '',
    month: '',
  });
  const [formData, setFormData] = useState({
    product: '',
    sale: '',
    quantity: '',
    reason: 'customer_request',
    notes: '',
  });
  const [refundFormData, setRefundFormData] = useState({
    returnId: null,
    refund_amount: '',
    refund_currency: 'USD',
    refund_payment_type: 'cash',
  });
  const [showRefundForm, setShowRefundForm] = useState(false);

  useEffect(() => {
    fetchReturns();
    fetchProducts();
    fetchSales();
  }, []);

  const fetchReturns = async () => {
    try {
      const response = await api.get('/returns/');
      const returnsList = response.data.results || response.data;
      setReturns(returnsList);
      applyFilters(returnsList);
    } catch (error) {
      console.error('Error fetching returns:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (returnsList) => {
    let filtered = returnsList;
    
    if (filters.brand && filters.brand.trim()) {
      filtered = filtered.filter(returnItem => 
        returnItem.product_detail?.brand?.toLowerCase().includes(filters.brand.toLowerCase())
      );
    }
    if (filters.size && filters.size.trim()) {
      filtered = filtered.filter(returnItem => 
        returnItem.product_detail?.size?.toLowerCase().includes(filters.size.toLowerCase())
      );
    }
    if (filters.color && filters.color.trim()) {
      filtered = filtered.filter(returnItem => 
        returnItem.product_detail?.color?.toLowerCase().includes(filters.color.toLowerCase())
      );
    }
    if (filters.reason) {
      filtered = filtered.filter(returnItem => returnItem.reason === filters.reason);
    }
    if (filters.year) {
      filtered = filtered.filter(returnItem => {
        const returnYear = new Date(returnItem.return_date).getFullYear();
        return returnYear.toString() === filters.year;
      });
    }
    if (filters.month) {
      filtered = filtered.filter(returnItem => {
        const returnMonth = new Date(returnItem.return_date).getMonth() + 1;
        return returnMonth.toString() === filters.month;
      });
    }
    
    setFilteredReturns(filtered);
  };

  useEffect(() => {
    if (returns.length > 0) {
      applyFilters(returns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const fetchProducts = async () => {
    try {
      const response = await api.get('/products/');
      setProducts(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const fetchSales = async () => {
    try {
      const response = await api.get('/sales/');
      setSales(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching sales:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/returns/', formData);
      setShowForm(false);
      setFormData({
        product: '',
        sale: '',
        quantity: '',
        reason: 'customer_request',
        notes: '',
      });
      fetchReturns();
    } catch (error) {
      console.error('Error creating return:', error);
      alert('Error creating return');
    }
  };

  const handleMarkRefunded = (returnId) => {
    const returnItem = returns.find(r => r.id === returnId);
    setRefundFormData({
      returnId: returnId,
      refund_amount: returnItem?.sale_detail?.total_amount || '',
      refund_currency: returnItem?.sale_detail?.sale_currency || 'USD',
      refund_payment_type: 'cash',
    });
    setShowRefundForm(true);
  };

  const handleRefundSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/returns/${refundFormData.returnId}/mark_refunded/`, {
        refund_amount: refundFormData.refund_amount,
        refund_currency: refundFormData.refund_currency,
        refund_payment_type: refundFormData.refund_payment_type,
      });
      setShowRefundForm(false);
      setRefundFormData({
        returnId: null,
        refund_amount: '',
        refund_currency: 'USD',
        refund_payment_type: 'cash',
      });
      fetchReturns();
    } catch (error) {
      console.error('Error marking return as refunded:', error);
      alert(error.response?.data?.error || error.response?.data?.detail || 'Error marking return as refunded');
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Returns</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Return'}
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>New Return</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Product</label>
                <select
                  value={formData.product}
                  onChange={(e) => setFormData({ ...formData, product: e.target.value })}
                  required
                >
                  <option value="">Select a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.brand} {product.model} - Size {product.size} ({product.color})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Sale (Optional)</label>
                <select
                  value={formData.sale}
                  onChange={(e) => setFormData({ ...formData, sale: e.target.value })}
                >
                  <option value="">None</option>
                  {sales.map((sale) => (
                    <option key={sale.id} value={sale.id}>
                      Sale #{sale.id} - {sale.product_detail?.brand} {sale.product_detail?.model}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Reason</label>
                <select
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  required
                >
                  <option value="defective">Defective</option>
                  <option value="wrong_size">Wrong Size</option>
                  <option value="wrong_item">Wrong Item</option>
                  <option value="customer_request">Customer Request</option>
                  <option value="other">Other</option>
                </select>
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
                Create Return
              </button>
            </div>
          </form>
        </div>
      )}

      {showRefundForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>Mark Return #{refundFormData.returnId} as Refunded</h2>
          <form onSubmit={handleRefundSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Refund Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={refundFormData.refund_amount}
                  onChange={(e) => setRefundFormData({ ...refundFormData, refund_amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Currency</label>
                <select
                  value={refundFormData.refund_currency}
                  onChange={(e) => setRefundFormData({ ...refundFormData, refund_currency: e.target.value })}
                  required
                >
                  <option value="USD">USD</option>
                  <option value="UZS">UZS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Payment Type</label>
                <select
                  value={refundFormData.refund_payment_type}
                  onChange={(e) => setRefundFormData({ ...refundFormData, refund_payment_type: e.target.value })}
                  required
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Mark as Refunded
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowRefundForm(false);
                  setRefundFormData({
                    returnId: null,
                    refund_amount: '',
                    refund_currency: 'USD',
                    refund_payment_type: 'cash',
                  });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="form-card" style={{ marginBottom: '20px' }}>
        <h3>Filters</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Brand</label>
            <input
              type="text"
              value={filters.brand}
              onChange={(e) => setFilters({ ...filters, brand: e.target.value })}
              placeholder="Filter by brand"
            />
          </div>
          <div className="form-group">
            <label>Size</label>
            <input
              type="text"
              value={filters.size}
              onChange={(e) => setFilters({ ...filters, size: e.target.value })}
              placeholder="Filter by size"
            />
          </div>
          <div className="form-group">
            <label>Color</label>
            <input
              type="text"
              value={filters.color}
              onChange={(e) => setFilters({ ...filters, color: e.target.value })}
              placeholder="Filter by color"
            />
          </div>
          <div className="form-group">
            <label>Reason</label>
            <select
              value={filters.reason}
              onChange={(e) => setFilters({ ...filters, reason: e.target.value })}
            >
              <option value="">All Reasons</option>
              <option value="defective">Defective</option>
              <option value="wrong_size">Wrong Size</option>
              <option value="wrong_item">Wrong Item</option>
              <option value="customer_request">Customer Request</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="form-group">
            <label>Year</label>
            <select
              value={filters.year}
              onChange={(e) => setFilters({ ...filters, year: e.target.value })}
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
              value={filters.month}
              onChange={(e) => setFilters({ ...filters, month: e.target.value })}
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
              onClick={() => setFilters({ brand: '', size: '', color: '', reason: '', year: '', month: '' })}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Product</th>
              <th>Brand</th>
              <th>Model</th>
              <th>Size</th>
              <th>Color</th>
              <th>Sale</th>
              <th>Quantity</th>
              <th>Reason</th>
              <th>Refund Status</th>
              <th>Processed By</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredReturns.length === 0 ? (
              <tr>
                <td colSpan="12" style={{ textAlign: 'center' }}>
                  No returns found
                </td>
              </tr>
            ) : (
              filteredReturns.map((returnItem) => (
                <tr key={returnItem.id}>
                  <td>#{returnItem.id}</td>
                  <td>
                    {returnItem.product_detail
                      ? `${returnItem.product_detail.brand} ${returnItem.product_detail.model}`
                      : `Product #${returnItem.product}`}
                  </td>
                  <td>{returnItem.product_detail?.brand || '-'}</td>
                  <td>{returnItem.product_detail?.model || '-'}</td>
                  <td><strong>{returnItem.product_detail?.size || '-'}</strong></td>
                  <td><strong>{returnItem.product_detail?.color || '-'}</strong></td>
                  <td>
                    {returnItem.sale ? `Sale #${returnItem.sale}` : '-'}
                  </td>
                  <td>{returnItem.quantity}</td>
                  <td>{returnItem.reason.replace('_', ' ')}</td>
                  <td>
                    <span className={`status-badge ${returnItem.refund_status === 'refunded' ? 'completed' : 'pending'}`}>
                      {returnItem.refund_status === 'refunded' ? 'REFUNDED' : 'NOT_REFUNDED'}
                    </span>
                    {returnItem.refund_status === 'refunded' && returnItem.refund_amount && (
                      <small style={{ display: 'block', color: '#666', fontSize: '0.85em', marginTop: '3px' }}>
                        {returnItem.refund_currency} {parseFloat(returnItem.refund_amount).toLocaleString()} ({returnItem.refund_payment_type === 'cash' ? 'Cash' : 'Card'})
                      </small>
                    )}
                  </td>
                  <td>{returnItem.processed_by_detail?.username || '-'}</td>
                  <td>{new Date(returnItem.return_date).toLocaleString()}</td>
                  <td>
                    {returnItem.refund_status === 'not_refunded' && (
                      <button
                        className="btn-status"
                        onClick={() => handleMarkRefunded(returnItem.id)}
                      >
                        Mark as Refunded
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Returns;

