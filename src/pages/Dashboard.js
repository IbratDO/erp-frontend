import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import './Dashboard.css';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get('/dashboard/stats/');
      setStats(response.data);
      setError(null);
    } catch (err) {
      setError('Failed to load dashboard statistics');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="page-container">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="page-container error">{error}</div>;
  }

  if (!stats) {
    return <div className="page-container">No data available</div>;
  }

  const { business_metrics, user_metrics, time_based_metrics, trends, status_distribution, expense_metrics } = stats;

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      {/* Business Metrics Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Sales (Units)</div>
          <div className="metric-value">{business_metrics.total_sales_units}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Revenue</div>
          <div className="metric-value">${business_metrics.total_sales_revenue.toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Orders</div>
          <div className="metric-value">{business_metrics.total_orders}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Returns</div>
          <div className="metric-value">{business_metrics.total_returns}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Inventory Value</div>
          <div className="metric-value">${business_metrics.inventory_value.toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Expenses</div>
          <div className="metric-value" style={{ color: '#e74c3c' }}>
            ${(business_metrics.total_expenses || 0).toLocaleString()}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Profit Estimation</div>
          <div className="metric-value" style={{ color: business_metrics.profit_estimation >= 0 ? '#27ae60' : '#e74c3c' }}>
            ${business_metrics.profit_estimation.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Expense Breakdown */}
      {expense_metrics && (
        <div className="section">
          <h2>Expense Breakdown</h2>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Delivery Costs</div>
              <div className="metric-value" style={{ color: '#e74c3c' }}>
                ${(expense_metrics.delivery_costs || 0).toLocaleString()}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Manual Expenses</div>
              <div className="metric-value" style={{ color: '#e74c3c' }}>
                ${(expense_metrics.manual_expenses || 0).toLocaleString()}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Order Costs</div>
              <div className="metric-value" style={{ color: '#e74c3c' }}>
                ${(business_metrics.total_cost || 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expenses by Type Chart */}
      {expense_metrics && expense_metrics.expenses_by_type && expense_metrics.expenses_by_type.length > 0 && (
        <div className="section">
          <h2>Expenses by Type</h2>
          <div className="chart-card">
            <h3>Expense Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={expense_metrics.expenses_by_type.map(item => ({
                name: item.expense_type ? item.expense_type.replace('_', ' ') : 'Other',
                amount: parseFloat(item.total || 0),
                count: item.count || 0,
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="amount" fill="#e74c3c" name="Amount ($)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Time-based Metrics */}
      <div className="section">
        <h2>Time-Based Sales</h2>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Daily Sales</div>
            <div className="metric-value">{time_based_metrics.daily.units} units</div>
            <div className="metric-subvalue">${time_based_metrics.daily.revenue.toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Weekly Sales</div>
            <div className="metric-value">{time_based_metrics.weekly.units} units</div>
            <div className="metric-subvalue">${time_based_metrics.weekly.revenue.toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Monthly Sales</div>
            <div className="metric-value">{time_based_metrics.monthly.units} units</div>
            <div className="metric-subvalue">${time_based_metrics.monthly.revenue.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Sales Trends (Last 30 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trends.sales_trends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="units" stroke="#8884d8" name="Units Sold" />
              <Line type="monotone" dataKey="revenue" stroke="#82ca9d" name="Revenue ($)" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Return Trends (Last 30 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trends.return_trends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="count" stroke="#ff8042" name="Returns" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Sales by Status</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={status_distribution.sales_by_status}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="count"
              >
                {status_distribution.sales_by_status.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Orders by Status</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={status_distribution.orders_by_status}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="count" fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {user_metrics.sales_per_salesman.length > 0 && (
          <div className="chart-card">
            <h3>Sales per Salesman</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={user_metrics.sales_per_salesman}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="salesman__username" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="units_sold" fill="#00C49F" name="Units Sold" />
                <Bar dataKey="revenue" fill="#0088FE" name="Revenue ($)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;

