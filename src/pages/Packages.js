import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './TablePage.css';

const Packages = () => {
  const [packages, setPackages] = useState([]);
  const [packageHistory, setPackageHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [formData, setFormData] = useState({
    package_type: 'M',
    quantity: '',
    cost_per_unit: '',
    is_paid: false,
    payment_amount: '',
    payment_currency: 'USD',
    payment_type: 'cash',
  });
  const [paymentFormData, setPaymentFormData] = useState({
    historyId: null,
    quantity_received: '',
    payment_amount: '',
    payment_currency: 'USD',
    payment_type: 'cash',
  });
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  useEffect(() => {
    fetchPackages();
    fetchPackageHistory();
  }, []);

  const fetchPackages = async () => {
    try {
      const response = await api.get('/packages/');
      let packagesList = response.data.results || response.data;
      
      // Ensure both M and L packages exist
      const packageTypes = ['M', 'L'];
      const existingTypes = packagesList.map(p => p.package_type);
      
      for (const type of packageTypes) {
        if (!existingTypes.includes(type)) {
          // Create missing package type
          const cost = type === 'M' ? 1.00 : 2.00;
          try {
            await api.post('/packages/', {
              package_type: type,
              quantity: 0,
              cost_per_unit: cost,
            });
          } catch (error) {
            console.error(`Error creating package ${type}:`, error);
          }
        }
      }
      
      // Refetch after creating missing packages
      const updatedResponse = await api.get('/packages/');
      setPackages(updatedResponse.data.results || updatedResponse.data);
    } catch (error) {
      console.error('Error fetching packages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Calculate total cost for payment amount default
      const quantity = parseInt(formData.quantity) || 0;
      const costPerUnit = parseFloat(formData.cost_per_unit) || (formData.package_type === 'M' ? 1.00 : 2.00);
      const totalCost = quantity * costPerUnit;
      const paymentAmount = formData.is_paid && formData.payment_amount 
        ? parseFloat(formData.payment_amount) 
        : totalCost;
      
      if (editingPackage) {
        // Update existing package
        const packageData = {
          package_type: formData.package_type,
          quantity: parseInt(formData.quantity) || 0,
          cost_per_unit: costPerUnit,
          is_paid: formData.is_paid,
        };
        
        if (formData.is_paid) {
          packageData.payment_amount = paymentAmount;
          packageData.payment_currency = formData.payment_currency;
          packageData.payment_type = formData.payment_type;
        }
        
        await api.put(`/packages/${editingPackage.id}/`, packageData);
      } else {
        // Check if package type already exists
        const existingPackage = packages.find(p => p.package_type === formData.package_type);
        const packageData = {
          package_type: formData.package_type,
          quantity: existingPackage 
            ? (parseInt(existingPackage.quantity) || 0) + quantity
            : quantity,
          cost_per_unit: costPerUnit,
          is_paid: formData.is_paid,
        };
        
        if (formData.is_paid) {
          packageData.payment_amount = paymentAmount;
          packageData.payment_currency = formData.payment_currency;
          packageData.payment_type = formData.payment_type;
        }
        
        if (existingPackage) {
          // Update existing package quantity (add to existing)
          await api.put(`/packages/${existingPackage.id}/`, packageData);
        } else {
          // Create new package
          await api.post('/packages/', packageData);
        }
      }
      setShowForm(false);
      setEditingPackage(null);
      setFormData({
        package_type: 'M',
        quantity: '',
        cost_per_unit: '',
        is_paid: false,
        payment_amount: '',
        payment_currency: 'USD',
        payment_type: 'cash',
      });
      fetchPackages();
    } catch (error) {
      console.error('Error saving package:', error);
      alert(error.response?.data?.detail || error.response?.data?.error || 'Error saving package');
    } finally {
      fetchPackageHistory(); // Refresh history after adding stock
    }
  };

  const fetchPackageHistory = async () => {
    try {
      const response = await api.get('/package-history/');
      setPackageHistory(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching package history:', error);
    }
  };

  const handleEdit = (packageItem) => {
    setEditingPackage(packageItem);
    setFormData({
      package_type: packageItem.package_type,
      quantity: packageItem.quantity,
      cost_per_unit: packageItem.cost_per_unit,
      is_paid: false,
      payment_amount: '',
      payment_currency: 'USD',
      payment_type: 'cash',
    });
    setShowForm(true);
  };

  const handleMarkReceivedAndPay = (historyId) => {
    const historyItem = packageHistory.find(h => h.id === historyId);
    const quantityOrdered = historyItem?.quantity_added || 0;
    const costPerUnit = parseFloat(historyItem?.cost_per_unit) || 0;
    const defaultPaymentAmount = quantityOrdered * costPerUnit;
    
    setPaymentFormData({
      historyId: historyId,
      quantity_received: quantityOrdered, // Auto-fill with ordered quantity
      payment_amount: defaultPaymentAmount,
      payment_currency: 'USD',
      payment_type: 'cash',
    });
    setShowPaymentForm(true);
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/package-history/${paymentFormData.historyId}/mark_received_and_pay/`, {
        quantity_received: paymentFormData.quantity_received,
        payment_amount: paymentFormData.payment_amount,
        payment_currency: paymentFormData.payment_currency,
        payment_type: paymentFormData.payment_type,
      });
      setShowPaymentForm(false);
      setPaymentFormData({
        historyId: null,
        payment_amount: '',
        payment_currency: 'USD',
        payment_type: 'cash',
      });
      fetchPackages();
      fetchPackageHistory();
    } catch (error) {
      console.error('Error marking package as received and paid:', error);
      alert(error.response?.data?.error || error.response?.data?.detail || 'Error marking package as received and paid');
    }
  };

  if (loading) {
    return <div className="page-container">Loading...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Packages</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Package Stock'}
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h2>{editingPackage ? 'Update Package Stock' : 'Add Package Stock'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Package Type</label>
                <select
                  value={formData.package_type}
                  onChange={(e) => setFormData({ ...formData, package_type: e.target.value, cost_per_unit: e.target.value === 'M' ? '1.00' : '2.00' })}
                  required
                  disabled={!!editingPackage}
                >
                  <option value="M">M ($1.00)</option>
                  <option value="L">L ($2.00)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Quantity to Add</label>
                <input
                  type="number"
                  min="0"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  required
                  placeholder={editingPackage ? 'New total quantity' : 'Quantity to add'}
                />
              </div>
              <div className="form-group">
                <label>Cost Per Unit</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost_per_unit}
                  onChange={(e) => setFormData({ ...formData, cost_per_unit: e.target.value })}
                  required
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formData.is_paid}
                    onChange={(e) => setFormData({ ...formData, is_paid: e.target.checked })}
                  />
                  Payment Made (if unchecked, will be recorded as Payable)
                </label>
              </div>
              {formData.is_paid && (
                <>
                  <div className="form-group">
                    <label>Payment Amount ({formData.payment_currency})</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.payment_amount || (parseFloat(formData.quantity) || 0) * (parseFloat(formData.cost_per_unit) || (formData.package_type === 'M' ? 1.00 : 2.00))}
                      onChange={(e) => setFormData({ ...formData, payment_amount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Currency</label>
                    <select
                      value={formData.payment_currency}
                      onChange={(e) => setFormData({ ...formData, payment_currency: e.target.value })}
                      required
                    >
                      <option value="USD">USD</option>
                      <option value="UZS">UZS</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Payment Type</label>
                    <select
                      value={formData.payment_type}
                      onChange={(e) => setFormData({ ...formData, payment_type: e.target.value })}
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
                {editingPackage ? 'Update' : 'Add Stock'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showPaymentForm && (
        <div className="form-card" style={{ marginBottom: '20px' }}>
          <h2>Mark Package Purchase #{paymentFormData.historyId} as Received and Pay</h2>
          <form onSubmit={handlePaymentSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Quantity Received</label>
                <input
                  type="number"
                  min="0"
                  value={paymentFormData.quantity_received}
                  onChange={(e) => {
                    const qty = parseInt(e.target.value) || 0;
                    const historyItem = packageHistory.find(h => h.id === paymentFormData.historyId);
                    const costPerUnit = parseFloat(historyItem?.cost_per_unit) || 0;
                    const newPaymentAmount = qty * costPerUnit;
                    setPaymentFormData({ 
                      ...paymentFormData, 
                      quantity_received: e.target.value,
                      payment_amount: newPaymentAmount > 0 ? newPaymentAmount : paymentFormData.payment_amount
                    });
                  }}
                  required
                />
                <small style={{ color: '#666', fontSize: '0.85em' }}>
                  Ordered: {packageHistory.find(h => h.id === paymentFormData.historyId)?.quantity_added || 0}
                </small>
              </div>
              <div className="form-group">
                <label>Payment Amount ({paymentFormData.payment_currency})</label>
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
                <label>Currency</label>
                <select
                  value={paymentFormData.payment_currency}
                  onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_currency: e.target.value })}
                  required
                >
                  <option value="USD">USD</option>
                  <option value="UZS">UZS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Payment Type</label>
                <select
                  value={paymentFormData.payment_type}
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
                Mark as Received and Pay
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => {
                  setShowPaymentForm(false);
                  setPaymentFormData({
                    historyId: null,
                    quantity_received: '',
                    payment_amount: '',
                    payment_currency: 'USD',
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

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Package Type</th>
              <th>Quantity</th>
              <th>Cost Per Unit</th>
              <th>Total Value</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {packages.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center' }}>
                  No packages found
                </td>
              </tr>
            ) : (
              packages.map((packageItem) => (
                <tr key={packageItem.id}>
                  <td><strong>Package {packageItem.package_type}</strong></td>
                  <td>{packageItem.quantity}</td>
                  <td>${packageItem.cost_per_unit}</td>
                  <td>${(parseFloat(packageItem.quantity) * parseFloat(packageItem.cost_per_unit)).toFixed(2)}</td>
                  <td>{new Date(packageItem.updated_at).toLocaleString()}</td>
                  <td>
                    <button
                      className="btn-edit"
                      onClick={() => handleEdit(packageItem)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-card" style={{ marginTop: '30px' }}>
        <h2>Package Stock History</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Package Type</th>
              <th>Quantity Added</th>
              <th>Cost Per Unit</th>
              <th>Total Cost</th>
              <th>Status</th>
              <th>Added By</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {packageHistory.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center' }}>
                  No package history found
                </td>
              </tr>
            ) : (
              packageHistory.map((historyItem) => (
                <tr key={historyItem.id}>
                  <td>#{historyItem.id}</td>
                  <td><strong>Package {historyItem.package_detail?.package_type || historyItem.package}</strong></td>
                  <td style={{ color: '#28a745', fontWeight: '600' }}>
                    {historyItem.quantity_received !== null && historyItem.quantity_received !== historyItem.quantity_added ? (
                      <span>
                        +{historyItem.quantity_received} <small style={{ color: '#666', fontSize: '0.85em' }}>(ordered: {historyItem.quantity_added})</small>
                      </span>
                    ) : (
                      `+${historyItem.quantity_added}`
                    )}
                  </td>
                  <td>${parseFloat(historyItem.cost_per_unit).toFixed(2)}</td>
                  <td style={{ fontWeight: '600' }}>${parseFloat(historyItem.total_cost).toFixed(2)}</td>
                  <td>
                    <span className={`status-badge ${historyItem.status === 'paid' ? 'completed' : historyItem.status === 'received' ? 'confirmed' : 'pending'}`}>
                      {historyItem.status === 'paid' ? 'PAID' : historyItem.status === 'received' ? 'RECEIVED' : 'ORDERED'}
                    </span>
                  </td>
                  <td>{historyItem.created_by_detail?.username || '-'}</td>
                  <td>{new Date(historyItem.created_at).toLocaleString()}</td>
                  <td>
                    {historyItem.status === 'ordered' && (
                      <button
                        className="btn-status"
                        onClick={() => handleMarkReceivedAndPay(historyItem.id)}
                      >
                        Mark as Received and Pay
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

export default Packages;

