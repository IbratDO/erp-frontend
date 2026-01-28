import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import './TablePage.css';

const Products = () => {
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [availableSizes, setAvailableSizes] = useState([]);
  const [filters, setFilters] = useState({
    brand: '',
    model: '',
    size: '',
    color: '',
    supplier_country: '',
    year: '',
    month: '',
  });
  const [formData, setFormData] = useState({
    name: '',
    brand: '',
    model: '',
    size: '',
    color: '',
    supplier_country: 'germany',
    cost_price: '',
    selling_price: '',
  });

  // All possible sizes from 36 to 46
  const allSizes = Array.from({ length: 11 }, (_, i) => (36 + i).toString());
  
  // Common colors list
  const commonColors = [
    'Black',
    'White',
    'Grey',
    'Navy',
    'Red',
    'Blue',
    'Brown',
    'Beige',
    'Green',
    'Pink'
  ];

  const applyFilters = useCallback((productsList) => {
    let filtered = productsList;
    
    if (filters.brand) {
      filtered = filtered.filter(p => p.brand.toLowerCase().includes(filters.brand.toLowerCase()));
    }
    if (filters.model) {
      filtered = filtered.filter(p => p.model.toLowerCase().includes(filters.model.toLowerCase()));
    }
    if (filters.size) {
      filtered = filtered.filter(p => p.size.toLowerCase().includes(filters.size.toLowerCase()));
    }
    if (filters.color) {
      filtered = filtered.filter(p => p.color.toLowerCase().includes(filters.color.toLowerCase()));
    }
    if (filters.supplier_country) {
      filtered = filtered.filter(p => p.supplier_country === filters.supplier_country);
    }
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
  }, [filters, allSizes]);

  const fetchProducts = useCallback(async () => {
    try {
      const response = await api.get('/products/');
      const productsList = response.data.results || response.data;
      
      // Use all sizes from 36 to 46
      setAvailableSizes(allSizes);
      
      applyFilters(productsList);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  }, [applyFilters, allSizes]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingProduct) {
        await api.put(`/products/${editingProduct.id}/`, formData);
      } else {
        await api.post('/products/', formData);
      }
      setShowForm(false);
      setEditingProduct(null);
      setFormData({
        name: '',
        brand: '',
        model: '',
        size: '',
        color: '',
        supplier_country: 'germany',
        cost_price: '',
        selling_price: '',
      });
      fetchProducts();
    } catch (error) {
      console.error('Error saving product:', error);
      alert('Error saving product');
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    
    setFormData({
      name: product.name,
      brand: product.brand,
      model: product.model,
      size: product.size,
      color: product.color,
      supplier_country: product.supplier_country,
      cost_price: product.cost_price,
      selling_price: product.selling_price,
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        await api.delete(`/products/${id}/`);
        fetchProducts();
      } catch (error) {
        console.error('Error deleting product:', error);
        alert('Error deleting product');
      }
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Products</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Product'}
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>{editingProduct ? 'Edit Product' : 'New Product'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Brand</label>
                <input
                  type="text"
                  value={formData.brand}
                  onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Model</label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Size</label>
                <select
                  value={formData.size}
                  onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                  required
                >
                  <option value="">Select Size</option>
                  {availableSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                  {/* Show current size if editing and it's not in the list */}
                  {editingProduct && formData.size && !availableSizes.includes(formData.size) && (
                    <option value={formData.size}>{formData.size}</option>
                  )}
                </select>
              </div>
              <div className="form-group">
                <label>Color</label>
                <select
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  required
                >
                  <option value="">Select Color</option>
                  {commonColors.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                  {/* Show current color if editing and it's not in the list */}
                  {editingProduct && formData.color && !commonColors.includes(formData.color) && (
                    <option value={formData.color}>{formData.color}</option>
                  )}
                </select>
              </div>
              <div className="form-group">
                <label>Supplier Country</label>
                <select
                  value={formData.supplier_country}
                  onChange={(e) => setFormData({ ...formData, supplier_country: e.target.value })}
                  required
                >
                  <option value="germany">Germany</option>
                  <option value="japan">Japan</option>
                  <option value="korea">Korea</option>
                </select>
              </div>
              <div className="form-group">
                <label>Cost Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.cost_price}
                  onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Selling Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.selling_price}
                  onChange={(e) => setFormData({ ...formData, selling_price: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {editingProduct ? 'Update' : 'Create'}
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
            <label>Model</label>
            <input
              type="text"
              value={filters.model}
              onChange={(e) => setFilters({ ...filters, model: e.target.value })}
              placeholder="Filter by model"
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
            <label>Supplier Country</label>
            <select
              value={filters.supplier_country}
              onChange={(e) => setFilters({ ...filters, supplier_country: e.target.value })}
            >
              <option value="">All Countries</option>
              <option value="germany">Germany</option>
              <option value="japan">Japan</option>
              <option value="korea">Korea</option>
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
              onClick={() => setFilters({ brand: '', model: '', size: '', color: '', supplier_country: '', year: '', month: '' })}
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
              <th>Name</th>
              <th>Brand</th>
              <th>Model</th>
              <th>Size</th>
              <th>Color</th>
              <th>Supplier</th>
              <th>Cost Price</th>
              <th>Selling Price</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center' }}>
                  No products found
                </td>
              </tr>
            ) : (
              filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>#{product.id}</td>
                  <td>{product.name}</td>
                  <td>{product.brand}</td>
                  <td>{product.model}</td>
                  <td><strong>{product.size}</strong></td>
                  <td><strong>{product.color}</strong></td>
                  <td>{product.supplier_country}</td>
                  <td>${product.cost_price}</td>
                  <td>${product.selling_price}</td>
                  <td>
                    <button
                      className="btn-edit"
                      onClick={() => handleEdit(product)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(product.id)}
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
    </div>
  );
};

export default Products;

