import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './TablePage.css';

const Customers = () => {
  const [customers, setCustomers] = useState([]);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
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
  
  const regionChoices = [
    { value: 'andijan', label: 'Andijan' },
    { value: 'bukhara', label: 'Bukhara' },
    { value: 'fergana', label: 'Fergana' },
    { value: 'jizzakh', label: 'Jizzakh' },
    { value: 'kashkadarya', label: 'Kashkadarya' },
    { value: 'khorezm', label: 'Khorezm' },
    { value: 'namangan', label: 'Namangan' },
    { value: 'navoi', label: 'Navoi' },
    { value: 'samarkand', label: 'Samarkand' },
    { value: 'surkhandarya', label: 'Surkhandarya' },
    { value: 'syrdarya', label: 'Syrdarya' },
    { value: 'tashkent_region', label: 'Tashkent region' },
    { value: 'karakalpakstan', label: 'Karakalpakstan' },
    { value: 'tashkent_city', label: 'Tashkent city' },
  ];

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      const response = await api.get('/customers/');
      const customersList = response.data.results || response.data;
      setCustomers(customersList);
      applyFilters(customersList);
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (customersList) => {
    let filtered = customersList;
    
    if (filters.name && filters.name.trim()) {
      filtered = filtered.filter(customer => 
        customer.name?.toLowerCase().includes(filters.name.toLowerCase())
      );
    }
    
    setFilteredCustomers(filtered);
  };

  useEffect(() => {
    if (customers.length > 0) {
      applyFilters(customers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

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
      alert(error.response?.data?.error || error.response?.data?.detail || 'Error saving customer');
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
    if (window.confirm('Are you sure you want to delete this customer?')) {
      try {
        await api.delete(`/customers/${customerId}/`);
        fetchCustomers();
        if (selectedCustomer?.id === customerId) {
          setSelectedCustomer(null);
          setCustomerHistory(null);
        }
      } catch (error) {
        console.error('Error deleting customer:', error);
        alert(error.response?.data?.error || 'Error deleting customer');
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
      alert('Error fetching customer history');
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Customers</h1>
        <button className="btn-primary" onClick={() => {
          setShowForm(!showForm);
          if (!showForm) {
            setFormData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city', notes: '' });
          }
        }}>
          {showForm ? 'Cancel' : '+ New Customer'}
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>{formData.id ? 'Edit Customer' : 'New Customer'}</h2>
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
              <div className="form-group">
                <label>Instagram</label>
                <input
                  type="text"
                  value={formData.instagram}
                  onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Region</label>
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
                {formData.id ? 'Update' : 'Create'} Customer
              </button>
                <button
                  type="button"
                  className="btn-edit"
                  onClick={() => {
                    setShowForm(false);
                    setFormData({ name: '', telephone: '+998', instagram: '', region: 'tashkent_city', notes: '' });
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
            <label>Name</label>
            <input
              type="text"
              value={filters.name}
              onChange={(e) => setFilters({ ...filters, name: e.target.value })}
              placeholder="Filter by name"
            />
          </div>
          <div className="form-group">
            <button
              type="button"
              className="btn-edit"
              onClick={() => setFilters({ name: '' })}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Customers List */}
        <div className="table-card" style={{ flex: selectedCustomer ? '0 0 40%' : '1' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Telephone</th>
                <th>Instagram</th>
                <th>Region</th>
                <th>Total Sales</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 ? (
                <tr>
                <td colSpan="6" style={{ textAlign: 'center' }}>
                  No customers found
                </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
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
                    <td>{customer.region || '-'}</td>
                    <td>{customer.sales_count || 0} sales</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-edit"
                        onClick={() => handleEdit(customer)}
                        style={{ marginRight: '5px' }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(customer.id)}
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

        {/* Customer History */}
        {selectedCustomer && customerHistory && (
          <div className="table-card" style={{ flex: '1' }}>
            <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>{selectedCustomer.name} - Purchase History</h2>
              <button
                className="btn-edit"
                onClick={() => {
                  setSelectedCustomer(null);
                  setCustomerHistory(null);
                }}
              >
                Close
              </button>
            </div>
            
            {/* Summary */}
            <div className="form-card" style={{ marginBottom: '20px', backgroundColor: '#f9f9f9' }}>
              <h3>Summary</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
                <div>
                  <strong>Total Sales:</strong> {customerHistory.summary.total_sales}
                </div>
                <div>
                  <strong>Completed Sales:</strong> {customerHistory.summary.completed_sales}
                </div>
                <div>
                  <strong>Total Orders:</strong> {customerHistory.summary.total_orders || 0}
                </div>
                <div>
                  <strong>Total Advance Payments:</strong> ${parseFloat(customerHistory.summary.total_advance_payments || 0).toFixed(2)}
                </div>
                <div>
                  <strong>Total Amount:</strong> ${parseFloat(customerHistory.summary.total_amount || 0).toFixed(2)}
                </div>
                <div>
                  <strong>Total Paid:</strong> ${parseFloat(customerHistory.summary.total_paid || 0).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Orders History */}
            {customerHistory.orders && customerHistory.orders.length > 0 && (
              <>
                <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>Orders</h3>
                <table className="data-table" style={{ marginBottom: '30px' }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Quantity</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Advance Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerHistory.orders.map((order) => (
                      <tr key={order.id}>
                        <td>{new Date(order.created_at).toLocaleString()}</td>
                        <td>
                          {order.product_detail
                            ? `${order.product_detail.brand} ${order.product_detail.model} - Size ${order.product_detail.size} (${order.product_detail.color})`
                            : `Product #${order.product}`}
                        </td>
                        <td>{order.ordered_quantity}</td>
                        <td>{order.order_type === 'on_demand' ? 'On-Demand' : 'Stock'}</td>
                        <td>
                          <span className={`status-badge ${order.status}`}>
                            {order.status}
                          </span>
                        </td>
                        <td>
                          {order.advance_payment_amount ? 
                            `${order.advance_payment_currency} ${order.advance_payment_amount} (${order.advance_payment_type})` : 
                            '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Purchase History */}
            <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>Purchases</h3>
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
                </tr>
              </thead>
              <tbody>
                {customerHistory.sales.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center' }}>
                      No purchases found
                    </td>
                  </tr>
                ) : (
                  customerHistory.sales.map((sale) => (
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Transaction History */}
            <h3 style={{ marginTop: '30px', marginBottom: '10px' }}>Transaction History</h3>
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
                {(!customerHistory.balance_transactions || customerHistory.balance_transactions.length === 0) &&
                 (!customerHistory.order_balance_transactions || customerHistory.order_balance_transactions.length === 0) ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center' }}>
                      No transactions found
                    </td>
                  </tr>
                ) : (
                  <>
                    {/* Combine and sort all transactions by date */}
                    {[
                      ...(customerHistory.order_balance_transactions || []).map(t => ({ ...t, source: 'order' })),
                      ...(customerHistory.balance_transactions || []).map(t => ({ ...t, source: 'sale' }))
                    ]
                      .filter(transaction => transaction.operation === 'add')
                      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                      .map((transaction) => (
                        <tr key={`${transaction.source}-${transaction.id}`}>
                          <td>{new Date(transaction.timestamp).toLocaleString()}</td>
                          <td>
                            {transaction.transaction_type === 'advance_payment' ? 'Advance Payment' : 
                             transaction.transaction_type === 'order_payment' ? 'Order Payment' : 
                             transaction.transaction_type === 'sale_payment' ? 'Sale Payment' : 
                             transaction.transaction_type === 'sale_completion' ? 'Sale Completion' : 
                             transaction.transaction_type}
                          </td>
                          <td>${transaction.amount}</td>
                          <td>
                            {transaction.balance_detail?.balance_type?.includes('USD') ? 'USD' : 
                             transaction.balance_detail?.balance_type?.includes('UZS') ? 'UZS' : '-'}
                          </td>
                          <td>
                            {transaction.balance_detail?.balance_type?.includes('cash') ? 'Cash' : 
                             transaction.balance_detail?.balance_type?.includes('card') ? 'Card' : '-'}
                          </td>
                          <td>{transaction.notes || '-'}</td>
                        </tr>
                      ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Customers;

