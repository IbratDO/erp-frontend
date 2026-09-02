import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import api from '../utils/api';
import i18n from '../i18n';
import { hasPermission, getRoleCode } from '../utils/permissions';
import { identityMatchesToken } from '../utils/tokenIdentity';
import { invalidateProductsCache } from '../utils/catalogCache';

const AuthContext = createContext();

const AUTH_KEYS = ['access_token', 'refresh_token', 'user'];

function clearAuthStorage() {
  AUTH_KEYS.forEach((key) => localStorage.removeItem(key));
  // The product catalogue is held in a module variable for the life of the tab, so without this
  // it outlives the session that fetched it: log out, log in as somebody else without reloading,
  // and the previous user's catalogue is still on screen. Same shape of leak as the identity
  // one, one level down.
  invalidateProductsCache();
}

function hasAccessToken() {
  return Boolean(localStorage.getItem('access_token'));
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearAuthStorage();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!hasAccessToken()) {
      clearAuthStorage();
      setUser(null);
      return null;
    }
    try {
      const userResponse = await api.get('/users/me/');
      // The profile has to belong to the token we are sending, or the sidebar would name one
      // person while the server acts as another. Refusing here forces a clean re-login, which
      // is recoverable; showing the wrong name is not, because nobody would know to doubt it.
      if (!identityMatchesToken(userResponse.data, localStorage.getItem('access_token'))) {
        clearAuthStorage();
        setUser(null);
        return null;
      }
      setUser(userResponse.data);
      localStorage.setItem('user', JSON.stringify(userResponse.data));
      return userResponse.data;
    } catch {
      // Fail closed: never keep a stale cached profile when the server identity is unknown.
      clearAuthStorage();
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!hasAccessToken()) {
        clearAuthStorage();
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      const fresh = await refreshUser();
      if (cancelled) return;
      if (!fresh) {
        setUser(null);
      }
      setLoading(false);
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  // Keep tabs in sync when another tab logs in or out.
  useEffect(() => {
    const onStorage = (e) => {
      if (!e.key || !AUTH_KEYS.includes(e.key)) return;
      if (!hasAccessToken()) {
        setUser(null);
        return;
      }
      refreshUser();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshUser]);

  const login = async (username, password) => {
    // Drop any previous session before accepting a new one (avoids token/user mismatch).
    clearAuthStorage();
    setUser(null);

    try {
      const response = await api.post('/token/', {
        username,
        password,
      });

      const { access, refresh } = response.data;
      if (!access || !refresh) {
        clearAuthStorage();
        return {
          success: false,
          error: i18n.t('auth.loginFailed', { ns: 'common' }),
        };
      }

      localStorage.setItem('access_token', access);
      localStorage.setItem('refresh_token', refresh);

      let userData;
      try {
        const userResponse = await api.get('/users/me/');
        userData = userResponse.data;
      } catch {
        clearAuthStorage();
        setUser(null);
        return {
          success: false,
          error: i18n.t('auth.loginFailed', { ns: 'common' }),
        };
      }

      // Same check as `refreshUser`, and needed separately: this is the path a person takes
      // when they deliberately sign in as somebody else, which is precisely when being shown
      // the previous occupant of the browser is most convincing and most wrong.
      if (!identityMatchesToken(userData, access)) {
        clearAuthStorage();
        setUser(null);
        return {
          success: false,
          error: i18n.t('auth.loginFailed', { ns: 'common' }),
        };
      }

      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));

      return { success: true, user: userData };
    } catch (error) {
      clearAuthStorage();
      setUser(null);
      return {
        success: false,
        error: error.response?.data?.detail || i18n.t('auth.loginFailed', { ns: 'common' }),
      };
    }
  };

  const value = {
    user,
    login,
    logout,
    loading,
    refreshUser,
    // Require both a live profile and an access token (token is source of truth for API).
    isAuthenticated: Boolean(user) && hasAccessToken(),
    roleCode: getRoleCode(user),
    isAdmin: hasPermission(user, 'finance.create_manual'),
    hasPermission: (code) => hasPermission(user, code),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
