import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { getRoleDisplayName } from '../utils/permissions';
import { translateMenuItems } from '../utils/i18nMenu';
import NotificationBell from './NotificationBell';
import './Layout.css';
import LanguageToggle from './LanguageToggle';

const MOBILE_BREAKPOINT = 768;

const Layout = () => {
  const { user, logout } = useAuth();
  const { menuItems } = usePermissions();
  const { t } = useTranslation('common');
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT,
  );

  const translatedMenu = useMemo(
    () => translateMenuItems(menuItems, t),
    [menuItems, t],
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
        setMobileNavOpen(false);
      } else {
        setSidebarOpen(true);
        setMobileNavOpen(false);
      }
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith('/inventory')) {
      setInventoryOpen(true);
    }
    if (isMobile) {
      setMobileNavOpen(false);
    }
  }, [location.pathname, isMobile]);

  const isActive = (path) => location.pathname === path;
  const isInventoryActive = () => location.pathname.startsWith('/inventory');

  const displayRole = getRoleDisplayName(user, t);

  const toggleSidebar = () => {
    if (isMobile) {
      setMobileNavOpen((prev) => !prev);
    } else {
      setSidebarOpen((prev) => !prev);
    }
  };

  const sidebarClass = [
    'sidebar',
    isMobile ? (mobileNavOpen ? 'open' : 'closed') : sidebarOpen ? 'open' : 'closed',
  ].join(' ');

  return (
    <div className={`layout ${isMobile ? 'layout--mobile' : ''}`}>
      {isMobile && mobileNavOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t('actions.close')}
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={sidebarClass}>
        <div className="sidebar-header">
          <h2>{t('app.title')}</h2>
          <button
            className="sidebar-toggle"
            onClick={toggleSidebar}
            type="button"
            aria-label={sidebarOpen || mobileNavOpen ? t('actions.close') : t('actions.view')}
          >
            {isMobile ? (mobileNavOpen ? '✕' : '☰') : sidebarOpen ? '◀' : '▶'}
          </button>
        </div>
        <nav className="sidebar-nav">
          {translatedMenu.map((item, index) =>
            item.isDropdown ? (
              <div key={index} className="nav-dropdown">
                <div
                  className={`nav-item ${isInventoryActive() ? 'active' : ''}`}
                  onClick={() => setInventoryOpen(!inventoryOpen)}
                  style={{ cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setInventoryOpen(!inventoryOpen)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {(sidebarOpen || mobileNavOpen) && (
                    <>
                      <span className="nav-label">{item.label}</span>
                      <span className="dropdown-arrow">{inventoryOpen ? '▼' : '▶'}</span>
                    </>
                  )}
                </div>
                {inventoryOpen && (sidebarOpen || mobileNavOpen) && (
                  <div className="submenu">
                    {item.subItems.map((subItem) => (
                      <Link
                        key={subItem.path}
                        to={subItem.path}
                        className={`nav-item submenu-item ${isActive(subItem.path) ? 'active' : ''}`}
                      >
                        <span className="nav-icon">{subItem.icon}</span>
                        <span className="nav-label">{subItem.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {(sidebarOpen || mobileNavOpen) && <span className="nav-label">{item.label}</span>}
              </Link>
            ),
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            {(sidebarOpen || mobileNavOpen) && (
              <>
                <div className="user-name">{user?.username}</div>
                <div className="user-role">{displayRole}</div>
              </>
            )}
          </div>
          <button className="logout-btn" type="button" onClick={logout}>
            {sidebarOpen || mobileNavOpen ? t('auth.logout') : '🚪'}
          </button>
        </div>
      </aside>
      <main className="main-content">
        {isMobile && (
          <button
            type="button"
            className="mobile-menu-fab"
            onClick={() => setMobileNavOpen(true)}
            aria-label={t('actions.view')}
          >
            ☰
          </button>
        )}
        {/*
          A top bar rather than another nav entry, because a reminder is only useful when it is
          in front of you whatever page you are on. The left nav is deliberately untouched.
          It holds only the bell for now; it is the place anything else app-wide would go.
        */}
        <header className="app-topbar">
          <LanguageToggle />
          <NotificationBell />
        </header>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
