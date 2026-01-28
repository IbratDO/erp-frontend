import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './TablePage.css';

const Sales = () => {
  const [sales, setSales] = useState([]);
  const [filteredSales, setFilteredSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
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
    selling_price: '',
    sale_currency: 'USD',
    sale_type: 'bought_from_shop',
    package_type: '',
    customer: '',
    status: 'pending',
  });
  
  const [customers, setCustomers] = useState([]);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
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
    fetchSales();
    fetchProducts();
    fetchInventory();
    fetchCustomers();
  }, []);
  
  const fetchCustomers = async () => {
    try {
      const response = await api.get('/customers/');
      setCustomers(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };
  
  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    try {
      const response = await api.post('/customers/', newCustomerData);
      await fetchCustomers();
      setFormData({ ...formData, customer: response.data.id });
      setShowCustomerForm(false);
      setNewCustomerData({ name: '', telephone: '', instagram: '', notes: '' });
    } catch (error) {
      console.error('Error creating customer:', error);
      alert(error.response?.data?.error || 'Error creating customer');
    }
  };

  const fetchSales = async () => {
    try {
      const response = await api.get('/sales/');
      const salesList = response.data.results || response.data;
      setSales(salesList);
      applyFilters(salesList);
    } catch (error) {
      console.error('Error fetching sales:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (salesList) => {
    let filtered = salesList;
    
    if (filters.brand && filters.brand.trim()) {
      filtered = filtered.filter(sale => 
        sale.product_detail?.brand?.toLowerCase().includes(filters.brand.toLowerCase())
      );
    }
    if (filters.size && filters.size.trim()) {
      filtered = filtered.filter(sale => 
        sale.product_detail?.size?.toLowerCase().includes(filters.size.toLowerCase())
      );
    }
    if (filters.color && filters.color.trim()) {
      filtered = filtered.filter(sale => 
        sale.product_detail?.color?.toLowerCase().includes(filters.color.toLowerCase())
      );
    }
    if (filters.status) {
      filtered = filtered.filter(sale => sale.status === filters.status);
    }
    if (filters.year) {
      filtered = filtered.filter(sale => {
        const saleYear = new Date(sale.sale_date).getFullYear();
        return saleYear.toString() === filters.year;
      });
    }
    if (filters.month) {
      filtered = filtered.filter(sale => {
        const saleMonth = new Date(sale.sale_date).getMonth() + 1; // getMonth() returns 0-11
        return saleMonth.toString() === filters.month;
      });
    }
    
    setFilteredSales(filtered);
  };

  useEffect(() => {
    if (sales.length > 0) {
      applyFilters(sales);
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

  const fetchInventory = async () => {
    try {
      const response = await api.get('/inventory/');
      setInventory(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Check inventory availability for the selected product
      const selectedProduct = products.find(p => p.id === parseInt(formData.product));
      if (selectedProduct) {
        // Find inventory items for this product with status 'in_inventory'
        const inventoryItems = inventory.filter(
          item => item.product === parseInt(formData.product) && item.status === 'in_inventory'
        );
        const totalAvailable = inventoryItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
        
        if (totalAvailable < parseInt(formData.quantity)) {
          alert(`Insufficient inventory! Available: ${totalAvailable}, Requested: ${formData.quantity}. This product is sold out or has insufficient stock.`);
          return;
        }
      }
      
      await api.post('/sales/', formData);
      setShowForm(false);
      setFormData({
        product: '',
        quantity: '',
        selling_price: '',
        sale_currency: 'USD',
        sale_type: 'bought_from_shop',
        package_type: '',
        status: 'pending',
      });
      fetchSales();
      fetchInventory(); // Refresh inventory after sale
    } catch (error) {
      console.error('Error creating sale:', error);
      alert(error.response?.data?.error || error.response?.data?.detail || 'Error creating sale');
    }
  };

  const [dispatchFormData, setDispatchFormData] = useState({
    saleId: null,
    delivery_cost: '',
    tracking_number: '',
    dispatch_type: 'dostavshik',
    is_paid: false,
    currency: 'UZS',
    payment_type: 'cash',
  });
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [paymentFormData, setPaymentFormData] = useState({
    saleId: null,
    payment_currency: 'USD',
    payment_amount: '',
    payment_type: 'cash',
  });
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  
  const [showCompleteFromOrderForm, setShowCompleteFromOrderForm] = useState(false);
  const [completeFromOrderData, setCompleteFromOrderData] = useState({
    saleId: null,
    customer: '',
    selling_price: '',
    now_paid_amount: '',
    now_paid_currency: 'USD',
    now_paid_type: 'cash',
  });

  const handleStatusUpdate = async (saleId, newStatus) => {
    try {
      if (newStatus === 'dispatched') {
        // Show dispatch form to enter delivery cost
        setDispatchFormData({
          saleId: saleId,
          delivery_cost: '',
          tracking_number: '',
          dispatch_type: 'dostavshik',
          is_paid: false,
          currency: 'UZS',
          payment_type: 'cash',
        });
        setShowDispatchForm(true);
      } else if (newStatus === 'completed') {
        // Show payment form - auto-fill from sale data
        const sale = sales.find(s => s.id === saleId);
        const totalAmount = sale ? (parseFloat(sale.selling_price) * sale.quantity) : 0;
        setPaymentFormData({
          saleId: saleId,
          payment_currency: sale?.sale_currency || 'USD',
          payment_amount: totalAmount,
          payment_type: 'cash',
        });
        setShowPaymentForm(true);
      } else {
        await api.post(`/sales/${saleId}/update_status/`, { status: newStatus });
        fetchSales();
      }
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Error updating status');
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/sales/${paymentFormData.saleId}/update_status/`, {
        status: 'completed',
        payment_currency: paymentFormData.payment_currency,
        payment_amount: paymentFormData.payment_amount,
        payment_type: paymentFormData.payment_type,
      });
      setShowPaymentForm(false);
      setPaymentFormData({
        saleId: null,
        payment_currency: 'USD',
        payment_amount: '',
        payment_type: 'cash',
      });
      fetchSales();
    } catch (error) {
      console.error('Error completing sale:', error);
      alert(error.response?.data?.error || 'Error completing sale');
    }
  };

  const handleDispatchSubmit = async (e) => {
    e.preventDefault();
    try {
      // First update sale status to dispatched
      await api.post(`/sales/${dispatchFormData.saleId}/update_status/`, { status: 'dispatched' });
      
      // Then create dispatch with delivery cost
      const sale = sales.find(s => s.id === dispatchFormData.saleId);
      if (sale) {
        const dispatchData = {
          sale: dispatchFormData.saleId,
          dispatch_type: dispatchFormData.dispatch_type,
          is_paid: dispatchFormData.is_paid,
          delivery_cost: dispatchFormData.currency === 'USD' ? dispatchFormData.delivery_cost : 0,
          delivery_cost_uzs: dispatchFormData.currency === 'UZS' ? dispatchFormData.delivery_cost : 0,
          tracking_number: dispatchFormData.tracking_number || '',
          status: 'dispatched',
        };
        
        // Map payment_type and currency to delivery_payment_cash or delivery_payment_card
        if (dispatchFormData.currency === 'UZS') {
          if (dispatchFormData.payment_type === 'cash') {
            dispatchData.delivery_payment_cash = dispatchFormData.delivery_cost;
            dispatchData.delivery_payment_card = 0;
          } else {
            dispatchData.delivery_payment_card = dispatchFormData.delivery_cost;
            dispatchData.delivery_payment_cash = 0;
          }
        } else {
          // For USD, we'll store in delivery_cost and let backend handle it
          dispatchData.delivery_payment_cash = 0;
          dispatchData.delivery_payment_card = 0;
        }
        
        await api.post('/dispatches/', dispatchData);
      }
      
      setShowDispatchForm(false);
      setDispatchFormData({
        saleId: null,
        delivery_cost: '',
        tracking_number: '',
        dispatch_type: 'dostavshik',
        is_paid: false,
        currency: 'UZS',
        payment_type: 'cash',
      });
      fetchSales();
    } catch (error) {
      console.error('Error creating dispatch:', error);
      alert('Error creating dispatch');
    }
  };

  const handleCompleteFromOrder = async (saleId) => {
    const sale = sales.find(s => s.id === saleId);
    if (sale) {
      const totalAmount = parseFloat(sale.selling_price) * sale.quantity;
      const advancePayment = sale.advance_payment_received || 0;
      const nowPaidAmount = totalAmount - advancePayment;
      setCompleteFromOrderData({
        saleId: saleId,
        customer: sale.customer || sale.order_detail?.customer || '',
        selling_price: sale.selling_price || '',
        now_paid_amount: nowPaidAmount > 0 ? nowPaidAmount.toFixed(2) : '0',
        now_paid_currency: sale.sale_currency || 'USD',
        now_paid_type: 'cash',
      });
      setShowCompleteFromOrderForm(true);
    }
  };

  const handleCompleteFromOrderSubmit = async (e) => {
    e.preventDefault();
    try {
      const sellingPrice = parseFloat(completeFromOrderData.selling_price);
      const advancePayment = parseFloat(completeFromOrderData.advance_payment_received || 0);
      const nowPaidAmount = parseFloat(completeFromOrderData.now_paid_amount);
      
      if (!sellingPrice || sellingPrice <= 0) {
        alert('Selling price is required and must be greater than 0');
        return;
      }
      
      await api.post(`/sales/${completeFromOrderData.saleId}/complete_from_order/`, {
        customer: completeFromOrderData.customer,
        selling_price: sellingPrice,
        now_paid_amount: nowPaidAmount > 0 ? nowPaidAmount : 0,
        now_paid_currency: completeFromOrderData.now_paid_currency,
        now_paid_type: completeFromOrderData.now_paid_type,
      });
      
      setShowCompleteFromOrderForm(false);
      setCompleteFromOrderData({
        saleId: null,
        customer: '',
        selling_price: '',
        now_paid_amount: '',
        now_paid_currency: 'USD',
        now_paid_type: 'cash',
      });
      fetchSales();
    } catch (error) {
      console.error('Error completing sale from order:', error);
      alert(error.response?.data?.error || 'Error completing sale');
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Sales</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Sale'}
        </button>
      </div>

      {showDispatchForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>Create Dispatch</h2>
          <form onSubmit={handleDispatchSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Dispatch Type</label>
                <select
                  value={dispatchFormData.dispatch_type}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, dispatch_type: e.target.value })}
                  required
                >
                  <option value="dostavshik">Dostavshik</option>
                  <option value="bts">BTS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Currency</label>
                <select
                  value={dispatchFormData.currency}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, currency: e.target.value })}
                  required
                >
                  <option value="USD">USD</option>
                  <option value="UZS">UZS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Payment Type</label>
                <select
                  value={dispatchFormData.payment_type}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, payment_type: e.target.value })}
                  required
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </div>
              <div className="form-group">
                <label>Delivery Cost ({dispatchFormData.currency})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={dispatchFormData.delivery_cost}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, delivery_cost: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Tracking Number (Optional)</label>
                <input
                  type="text"
                  value={dispatchFormData.tracking_number}
                  onChange={(e) => setDispatchFormData({ ...dispatchFormData, tracking_number: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dispatchFormData.is_paid}
                    onChange={(e) => setDispatchFormData({ ...dispatchFormData, is_paid: e.target.checked })}
                  />
                  Payment Made (if unchecked, will be recorded as Payable)
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Create Dispatch
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowDispatchForm(false);
                  setDispatchFormData({
                    saleId: null,
                    delivery_cost: '',
                    tracking_number: '',
                    currency: 'UZS',
                    payment_type: 'cash',
                  });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showCompleteFromOrderForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>Complete Sale from Order - Sale #{completeFromOrderData.saleId}</h2>
          <form onSubmit={handleCompleteFromOrderSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Selling Price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={completeFromOrderData.selling_price}
                  onChange={(e) => {
                    const sellingPrice = parseFloat(e.target.value) || 0;
                    const sale = sales.find(s => s.id === completeFromOrderData.saleId);
                    const advancePayment = sale?.advance_payment_received || 0;
                    const totalAmount = sellingPrice * (sale?.quantity || 1);
                    const nowPaid = totalAmount - advancePayment;
                    setCompleteFromOrderData({
                      ...completeFromOrderData,
                      selling_price: e.target.value,
                      now_paid_amount: nowPaid > 0 ? nowPaid.toFixed(2) : '0',
                    });
                  }}
                  required
                />
              </div>
              <div className="form-group">
                <label>Advance Payment Received (Auto-filled)</label>
                <input
                  type="number"
                  step="0.01"
                  value={sales.find(s => s.id === completeFromOrderData.saleId)?.advance_payment_received || 0}
                  readOnly
                  style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-group">
                <label>Now Paid Amount (Auto-calculated)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={completeFromOrderData.now_paid_amount}
                  onChange={(e) => setCompleteFromOrderData({ ...completeFromOrderData, now_paid_amount: e.target.value })}
                  required
                />
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  Auto-calculated as: (Selling Price × Quantity) - Advance Payment
                </small>
              </div>
              {parseFloat(completeFromOrderData.now_paid_amount) > 0 && (
                <>
                  <div className="form-group">
                    <label>Payment Currency</label>
                    <select
                      value={completeFromOrderData.now_paid_currency}
                      onChange={(e) => setCompleteFromOrderData({ ...completeFromOrderData, now_paid_currency: e.target.value })}
                      required
                    >
                      <option value="USD">USD</option>
                      <option value="UZS">UZS</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Payment Type</label>
                    <select
                      value={completeFromOrderData.now_paid_type}
                      onChange={(e) => setCompleteFromOrderData({ ...completeFromOrderData, now_paid_type: e.target.value })}
                      required
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Complete Sale
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowCompleteFromOrderForm(false);
                  setCompleteFromOrderData({
                    saleId: null,
                    selling_price: '',
                    now_paid_amount: '',
                    now_paid_currency: 'USD',
                    now_paid_type: 'cash',
                  });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showPaymentForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>Complete Sale #{paymentFormData.saleId}</h2>
          <p>Please enter the payment details for this sale:</p>
          <form onSubmit={handlePaymentSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Currency</label>
                <select
                  value={paymentFormData.payment_currency || 'USD'}
                  onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_currency: e.target.value })}
                  required
                >
                  <option value="USD">USD</option>
                  <option value="UZS">UZS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Payment Amount ({paymentFormData.payment_currency || 'USD'})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={paymentFormData.payment_amount}
                  onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Payment Type</label>
                <select
                  value={paymentFormData.payment_type || 'cash'}
                  onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_type: e.target.value })}
                  required
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Complete Sale
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowPaymentForm(false);
                  setPaymentFormData({
                    saleId: null,
                    payment_currency: 'USD',
                    payment_amount: '',
                    payment_type: 'cash',
                  });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showForm && (
        <div className="form-card">
          <h2>New Sale</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Product</label>
                <select
                  value={formData.product}
                  onChange={(e) => {
                    const selectedProductId = e.target.value;
                    const selectedProduct = products.find(p => p.id === parseInt(selectedProductId));
                    setFormData({
                      ...formData,
                      product: selectedProductId,
                      selling_price: selectedProduct ? selectedProduct.selling_price : formData.selling_price,
                    });
                  }}
                  required
                >
                  <option value="">Select a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.brand} {product.model} - Size {product.size} ({product.color}) - ${product.selling_price}
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
                <label>Currency</label>
                <select
                  value={formData.sale_currency}
                  onChange={(e) => setFormData({ ...formData, sale_currency: e.target.value })}
                  required
                >
                  <option value="USD">USD</option>
                  <option value="UZS">UZS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Selling Price ({formData.sale_currency})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.selling_price}
                  onChange={(e) => setFormData({ ...formData, selling_price: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Sale Type</label>
                <select
                  value={formData.sale_type}
                  onChange={(e) => setFormData({ ...formData, sale_type: e.target.value })}
                  required
                >
                  <option value="bought_from_shop">Bought from Shop</option>
                  <option value="delivery">Delivery</option>
                </select>
              </div>
              <div className="form-group">
                <label>Package Type</label>
                <select
                  value={formData.package_type}
                  onChange={(e) => setFormData({ ...formData, package_type: e.target.value })}
                >
                  <option value="">No Package</option>
                  <option value="M">M ($1)</option>
                  <option value="L">L ($2)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Customer</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                  <select
                    value={formData.customer}
                    onChange={(e) => setFormData({ ...formData, customer: e.target.value })}
                    style={{ flex: 1 }}
                  >
                    <option value="">Select or add customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} {customer.telephone ? `(${customer.telephone})` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-edit"
                    onClick={() => setShowCustomerForm(true)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    + New
                  </button>
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Create Sale
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowForm(false);
                  setFormData({
                    product: '',
                    quantity: '',
                    selling_price: '',
                    sale_currency: 'USD',
                    sale_type: 'bought_from_shop',
                    package_type: '',
                    customer: '',
                    status: 'pending',
                  });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showCustomerForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>Add New Customer</h2>
          <form onSubmit={handleCreateCustomer}>
            <div className="form-grid">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={newCustomerData.name}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Telephone</label>
                <input
                  type="text"
                  value={newCustomerData.telephone}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, telephone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Instagram</label>
                <input
                  type="text"
                  value={newCustomerData.instagram}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, instagram: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Region</label>
                <select
                  value={newCustomerData.region}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, region: e.target.value })}
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
                  value={newCustomerData.notes}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, notes: e.target.value })}
                  rows="3"
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Add Customer
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowCustomerForm(false);
                  setNewCustomerData({ name: '', telephone: '', instagram: '', notes: '' });
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
            <label>Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="dispatched">Dispatched</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
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
              <th>ID</th>
              <th>Product</th>
              <th>Brand</th>
              <th>Model</th>
              <th>Size</th>
              <th>Color</th>
              <th>Sale Type</th>
              <th>Package</th>
              <th>Quantity</th>
              <th>Price</th>
              <th>Total</th>
              <th>Customer</th>
              <th>Salesman</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSales.length === 0 ? (
              <tr>
                <td colSpan="16" style={{ textAlign: 'center' }}>
                  No sales found
                </td>
              </tr>
            ) : (
              filteredSales.map((sale) => (
                <tr key={sale.id}>
                  <td>#{sale.id}</td>
                  <td>
                    {sale.product_detail
                      ? `${sale.product_detail.brand} ${sale.product_detail.model}`
                      : `Product #${sale.product}`}
                  </td>
                  <td>{sale.product_detail?.brand || '-'}</td>
                  <td>{sale.product_detail?.model || '-'}</td>
                  <td><strong>{sale.product_detail?.size || '-'}</strong></td>
                  <td><strong>{sale.product_detail?.color || '-'}</strong></td>
                  <td>{sale.sale_type === 'bought_from_shop' ? 'Shop' : sale.sale_type === 'from_order' ? 'From Order' : 'Delivery'}</td>
                  <td>
                    {sale.package_type ? (
                      <span>
                        {sale.package_type} (${sale.package_cost || (sale.package_type === 'M' ? '1' : '2')})
                      </span>
                    ) : '-'}
                  </td>
                  <td>{sale.quantity}</td>
                  <td>${sale.selling_price}</td>
                  <td>${sale.total_amount}</td>
                  <td>{sale.customer_detail?.name || '-'}</td>
                  <td>{sale.salesman_detail?.username || '-'}</td>
                  <td>
                    <span className={`status-badge ${sale.status}`}>
                      {sale.status}
                    </span>
                  </td>
                  <td>{new Date(sale.sale_date).toLocaleString()}</td>
                  <td>
                    {sale.status === 'pending' && sale.sale_type !== 'from_order' && (
                      <button
                        className="btn-status"
                        onClick={() => handleStatusUpdate(sale.id, 'confirmed')}
                      >
                        Confirm
                      </button>
                    )}
                    {sale.status === 'confirmed' && sale.sale_type === 'delivery' && (
                      <button
                        className="btn-status"
                        onClick={() => handleStatusUpdate(sale.id, 'dispatched')}
                      >
                        Dispatch
                      </button>
                    )}
                    {sale.status === 'confirmed' && sale.sale_type === 'bought_from_shop' && (
                      <button
                        className="btn-status"
                        onClick={() => handleStatusUpdate(sale.id, 'completed')}
                      >
                        Complete & Pay
                      </button>
                    )}
                    {sale.status === 'dispatched' && (
                      <button
                        className="btn-status"
                        onClick={() => handleStatusUpdate(sale.id, 'completed')}
                      >
                        Complete & Pay
                      </button>
                    )}
                    {sale.status === 'pending' && sale.sale_type === 'from_order' && (
                      <button
                        className="btn-status"
                        onClick={() => handleCompleteFromOrder(sale.id)}
                        style={{ backgroundColor: '#4caf50', color: 'white' }}
                      >
                        Complete and Receive Payment
                      </button>
                    )}
                    {sale.status === 'completed' && sale.payment_currency && sale.payment_type && (
                      <span style={{ fontSize: '0.9em', color: '#666', display: 'block', marginTop: '5px' }}>
                        Paid: {sale.payment_currency} {sale.payment_type === 'cash' ? 'Cash' : 'Card'}
                      </span>
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

export default Sales;

