import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Layout.css';

const Layout = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const menuItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/products', label: 'Products', icon: '👟' },
    { path: '/inventory', label: 'Inventory', icon: '📦' },
    { path: '/packages', label: 'Packages', icon: '📮' },
    { path: '/orders', label: 'Orders', icon: '🛒' },
    { path: '/sales', label: 'Sales', icon: '💰' },
    { path: '/returns', label: 'Returns', icon: '↩️' },
    { path: '/finance', label: 'Finance', icon: '💵' },
    { path: '/money-balance', label: 'Money Balance', icon: '💳' },
    { path: '/customers', label: 'Customers', icon: '👥' },
    { path: '/workers', label: 'Workers', icon: '👷' },
    { path: '/audit-logs', label: 'Audit Logs', icon: '📝' },
  ];

  const isActive = (path) => location.pathname === path;

  return (
    <div className="layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h2>ERP System</h2>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>
        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {sidebarOpen && <span className="nav-label">{item.label}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            {sidebarOpen && (
              <>
                <div className="user-name">{user?.username}</div>
                <div className="user-role">{user?.role || 'salesman'}</div>
              </>
            )}
          </div>
          <button className="logout-btn" onClick={logout}>
            {sidebarOpen ? 'Logout' : '🚪'}
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;

