import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import ProtectedRoute from './components/ProtectedRoute';
import DefaultHomeRedirect from './components/DefaultHomeRedirect';
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
import ReceivablesPayables from './pages/ReceivablesPayables';
import CreditSales from './pages/CreditSales';
import Equity from './pages/Equity';
import FixedAssets from './pages/FixedAssets';
import ProfitLoss from './pages/ProfitLoss';
import BalanceSheet from './pages/BalanceSheet';
import MoneyBalance from './pages/MoneyBalance';
import AuditLogs from './pages/AuditLogs';
import BonusRules from './pages/BonusRules';
import Users from './pages/Users';
import ChangePassword from './pages/ChangePassword';
import Customers from './pages/Customers';
import Dispatchers from './pages/Dispatchers';
import Workers from './pages/Workers';
import Jarimalar from './pages/Jarimalar';
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
            <Route index element={<DefaultHomeRedirect />} />
            <Route
              path="dashboard"
              element={
                <ProtectedRoute permission="dashboard.view">
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="products"
              element={
                <ProtectedRoute permission="products.view">
                  <Products />
                </ProtectedRoute>
              }
            />
            <Route
              path="inventory/products"
              element={
                <ProtectedRoute permission="inventory.view">
                  <Inventory />
                </ProtectedRoute>
              }
            />
            <Route
              path="inventory/packages"
              element={
                <ProtectedRoute permission="packages.view">
                  <Packages />
                </ProtectedRoute>
              }
            />
            <Route
              path="orders"
              element={
                <ProtectedRoute permission="orders.view">
                  <Orders />
                </ProtectedRoute>
              }
            />
            <Route
              path="sales"
              element={
                <ProtectedRoute permission="sales.view">
                  <Sales />
                </ProtectedRoute>
              }
            />
            <Route
              path="returns"
              element={
                <ProtectedRoute permission="returns.view">
                  <Returns />
                </ProtectedRoute>
              }
            />
            <Route
              path="finance"
              element={
                <ProtectedRoute permission="finance.view">
                  <Finance />
                </ProtectedRoute>
              }
            />
            <Route
              path="receivables-payables"
              element={
                <ProtectedRoute permission="receivables.view">
                  <ReceivablesPayables />
                </ProtectedRoute>
              }
            />
            <Route
              path="credit-sales"
              element={
                <ProtectedRoute permission="credit_sales.view">
                  <CreditSales />
                </ProtectedRoute>
              }
            />
            <Route
              path="equity"
              element={
                <ProtectedRoute permission="equity.view">
                  <Equity />
                </ProtectedRoute>
              }
            />
            <Route
              path="fixed-assets"
              element={
                <ProtectedRoute permission="fixed_assets.view">
                  <FixedAssets />
                </ProtectedRoute>
              }
            />
            <Route
              path="profit-loss"
              element={
                <ProtectedRoute permission="finance.profit_loss">
                  <ProfitLoss />
                </ProtectedRoute>
              }
            />
            <Route
              path="balance-sheet"
              element={
                <ProtectedRoute permission="finance.balance_sheet">
                  <BalanceSheet />
                </ProtectedRoute>
              }
            />
            <Route
              path="money-balance"
              element={
                <ProtectedRoute permission="cash.view">
                  <MoneyBalance />
                </ProtectedRoute>
              }
            />
            <Route
              path="bonus-rules"
              element={
                <ProtectedRoute permission="bonus.manage">
                  <BonusRules />
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute permission="users.view">
                  <Users />
                </ProtectedRoute>
              }
            />
            <Route
              path="change-password"
              element={
                <ProtectedRoute>
                  <ChangePassword />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit-logs"
              element={
                <ProtectedRoute permission="audit_logs.view">
                  <AuditLogs />
                </ProtectedRoute>
              }
            />
            <Route
              path="customers"
              element={
                <ProtectedRoute permission="customers.view">
                  <Customers />
                </ProtectedRoute>
              }
            />
            <Route
              path="dispatchers"
              element={
                <ProtectedRoute permission="dispatch.view">
                  <Dispatchers />
                </ProtectedRoute>
              }
            />
            <Route
              path="workers"
              element={
                <ProtectedRoute permission="workers.view">
                  <Workers />
                </ProtectedRoute>
              }
            />
            <Route
              path="jarimalar"
              element={
                <ProtectedRoute permission="penalties.manage">
                  <Jarimalar />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
