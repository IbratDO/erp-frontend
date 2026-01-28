import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './TablePage.css';

const Inventory = () => {
  const [inventory, setInventory] = useState([]);
  const [filteredInventory, setFilteredInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({
    brand: '',
    size: '',
    color: '',
    status: '',
    year: '',
    month: '',
  });
  const [formData, setFormData] = useState({
    product: '',
    quantity: '',
    status: 'in_inventory',
    location: '',
  });

  useEffect(() => {
    fetchInventory();
    fetchProducts();
  }, []);

  const fetchInventory = async () => {
    try {
      const response = await api.get('/inventory/');
      const inventoryList = response.data.results || response.data;
      setInventory(inventoryList);
      applyFilters(inventoryList);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (inventoryList) => {
    let filtered = inventoryList;
    
    if (filters.brand && filters.brand.trim()) {
      filtered = filtered.filter(item => 
        item.product_detail?.brand?.toLowerCase().includes(filters.brand.toLowerCase())
      );
    }
    if (filters.size && filters.size.trim()) {
      filtered = filtered.filter(item => 
        item.product_detail?.size?.toLowerCase().includes(filters.size.toLowerCase())
      );
    }
    if (filters.color && filters.color.trim()) {
      filtered = filtered.filter(item => 
        item.product_detail?.color?.toLowerCase().includes(filters.color.toLowerCase())
      );
    }
    if (filters.status) {
      filtered = filtered.filter(item => item.status === filters.status);
    }
    if (filters.year) {
      filtered = filtered.filter(item => {
        const itemYear = new Date(item.created_at || item.updated_at).getFullYear();
        return itemYear.toString() === filters.year;
      });
    }
    if (filters.month) {
      filtered = filtered.filter(item => {
        const itemMonth = new Date(item.created_at || item.updated_at).getMonth() + 1;
        return itemMonth.toString() === filters.month;
      });
    }
    
    setFilteredInventory(filtered);
  };

  useEffect(() => {
    if (inventory.length > 0) {
      applyFilters(inventory);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/inventory/', formData);
      setShowForm(false);
      setFormData({
        product: '',
        quantity: '',
        status: 'in_inventory',
        location: '',
      });
      fetchInventory();
    } catch (error) {
      console.error('Error saving inventory item:', error);
      alert('Error saving inventory item');
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Inventory</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Inventory Item'}
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>New Inventory Item</h2>
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
                <label>Quantity</label>
                <input
                  type="number"
                  min="0"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  required
                >
                  <option value="in_inventory">In Inventory</option>
                  <option value="reserved">Reserved</option>
                  <option value="sold">Sold</option>
                  <option value="returned">Returned</option>
                </select>
              </div>
              <div className="form-group">
                <label>Location (Optional)</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Create
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
            <label>Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All Statuses</option>
              <option value="in_inventory">In Inventory</option>
              <option value="reserved">Reserved</option>
              <option value="sold">Sold</option>
              <option value="returned">Returned</option>
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
              onClick={() => setFilters({ brand: '', size: '', color: '', status: '', year: '', month: '' })}
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
              <th>Product</th>
              <th>Brand</th>
              <th>Model</th>
              <th>Size</th>
              <th>Color</th>
              <th>Quantity</th>
              <th>Status</th>
              <th>Location</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {filteredInventory.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center' }}>
                  No inventory items found
                </td>
              </tr>
            ) : (
              filteredInventory.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.product_detail
                      ? `${item.product_detail.brand} ${item.product_detail.model}`
                      : `Product #${item.product}`}
                  </td>
                  <td>{item.product_detail?.brand || '-'}</td>
                  <td>{item.product_detail?.model || '-'}</td>
                  <td><strong>{item.product_detail?.size || '-'}</strong></td>
                  <td><strong>{item.product_detail?.color || '-'}</strong></td>
                  <td>{item.quantity}</td>
                  <td>
                    <span className={`status-badge ${item.status}`}>
                      {item.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{item.location || '-'}</td>
                  <td>{new Date(item.updated_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Inventory;

