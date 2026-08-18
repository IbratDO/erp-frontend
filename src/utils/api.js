import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

function clearAuthStorage() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
}

/** Single-flight refresh so concurrent 401s share one /token/refresh/ call. */
let refreshPromise = null;

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        throw new Error('No refresh token');
      }
      const response = await axios.post(`${API_BASE_URL}/token/refresh/`, {
        refresh: refreshToken,
      });
      const { access, refresh } = response.data || {};
      if (!access) {
        throw new Error('No access token in refresh response');
      }
      localStorage.setItem('access_token', access);
      // Persist rotated refresh when the backend returns one.
      if (refresh) {
        localStorage.setItem('refresh_token', refresh);
      }
      return access;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const access = await refreshAccessToken();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${access}`;
        return api(originalRequest);
      } catch (refreshError) {
        clearAuthStorage();
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Collapse a repeated write while the first one is still in the air.
 *
 * The shop's buttons take a moment to come back — paying an order moves cash, writes finance
 * records and re-splits freight before it answers — and a button that looks untouched invites
 * a second click. That second click used to become a second request, and a second request on a
 * money endpoint is a second payment.
 *
 * So while a write is in flight, an identical one — same method, same URL, same body — is
 * handed the *first* one's promise instead of being sent. The caller cannot tell: it waits and
 * receives the same answer, so the screen refreshes and the success message appears exactly as
 * it should, because the operation genuinely did succeed. Once.
 *
 * The window is only the flight itself. As soon as the first request settles the key is
 * released, so deliberately doing the same thing twice — refunding two identical instalments,
 * adding the same expense again — is never blocked. Nobody can click faster than the network
 * on purpose.
 *
 * Reads are left alone: fetching the same list twice is wasteful, not harmful, and callers
 * expect their own response object.
 *
 * **This is a guard, not a guarantee.** It lives in one browser tab and dies with it: a
 * refresh mid-request, a second tab, or two people on one account can still produce two
 * genuine requests. Only the server can rule that out, and for the endpoints where it matters
 * it already does — paying an order, paying cargo and selling from an order all refuse a
 * repeat outright. `manage.py audit_repeat_guards` lists the ones that do not.
 *
 * Creating orders and sales is deliberately not among them. A general "refuse an identical
 * body twice" guard was built and removed: two identical sales are a real thing a shop does,
 * the server cannot tell one from a misfired click, and refusing real trading is the worse
 * error of the two. The browser guards above are the right place for this, because only the
 * browser knows the two requests came from one gesture.
 */
const inFlightWrites = new Map();

function writeKey(method, url, data) {
  let body = '';
  if (data !== undefined && data !== null) {
    try {
      body = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
      // Circular or otherwise unserialisable: fall back to a key nothing can match, so an
      // unusual payload is sent rather than silently swallowed.
      return null;
    }
  }
  return `${method} ${url} ${body}`;
}

function dedupeWrites(instance) {
  // `delete` takes no body, so its argument list is one shorter — hence the flag rather than
  // one shape for all four.
  const methods = [
    ['post', true],
    ['put', true],
    ['patch', true],
    ['delete', false],
  ];
  methods.forEach(([method, hasBody]) => {
    const original = instance[method].bind(instance);
    instance[method] = (url, ...rest) => {
      const data = hasBody ? rest[0] : undefined;
      const key = writeKey(method, url, data);
      if (key === null) {
        return original(url, ...rest);
      }
      const running = inFlightWrites.get(key);
      if (running) {
        return running;
      }
      const promise = original(url, ...rest).finally(() => {
        inFlightWrites.delete(key);
      });
      inFlightWrites.set(key, promise);
      return promise;
    };
  });
}

dedupeWrites(api);

export default api;
