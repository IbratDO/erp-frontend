import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Packages from './pages/Packages';
import Orders from './pages/Orders';
import Sales from './pages/Sales';
import Returns from './pages/Returns';
import Finance from './pages/Finance';
import MoneyBalance from './pages/MoneyBalance';
import AuditLogs from './pages/AuditLogs';
import Customers from './pages/Customers';
import Workers from './pages/Workers';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="packages" element={<Packages />} />
            <Route path="orders" element={<Orders />} />
            <Route path="sales" element={<Sales />} />
            <Route path="returns" element={<Returns />} />
            <Route path="finance" element={<Finance />} />
            <Route path="money-balance" element={<MoneyBalance />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="customers" element={<Customers />} />
            <Route path="workers" element={<Workers />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;

