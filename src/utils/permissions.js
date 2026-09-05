/**
 * Centralized frontend permission utilities.
 * Backend is source of truth; this mirrors /users/me/ permissions for UX only.
 */

export const ROUTE_PERMISSIONS = {
  '/dashboard': 'dashboard.view',
  '/products': 'products.view',
  '/inventory/products': 'inventory.view',
  '/inventory/packages': 'packages.view',
  '/inventory/stock-counts': 'inventory.count',
  '/orders': 'orders.view',
  '/sales': 'sales.view',
  '/returns': 'returns.view',
  '/finance': 'finance.view',
  '/receivables-payables': 'receivables.view',
  '/credit-sales': 'credit_sales.view',
  '/equity': 'equity.view',
  '/fixed-assets': 'fixed_assets.view',
  '/profit-loss': 'finance.profit_loss',
  '/balance-sheet': 'finance.balance_sheet',
  '/money-balance': 'cash.view',
  '/audit-logs': 'audit_logs.view',
  '/bonus-rules': 'bonus.manage',
  '/users': 'users.view',
  '/customers': 'customers.view',
  '/dispatchers': 'dispatch.view',
  '/workers': 'workers.view',
  '/jarimalar': 'penalties.manage',
};

/** Paths each role may see in the sidebar (null = permission-based only). */
export const ROLE_VISIBLE_MENU_PATHS = {
  sales_manager: [
    '/dashboard',
    '/products',
    '/inventory/products',
    '/orders',
    '/sales',
    '/returns',
    '/customers',
    '/change-password',
  ],
  senior_sales_manager: [
    '/dashboard',
    '/products',
    '/inventory/products',
    '/inventory/packages',
    '/orders',
    '/sales',
    '/returns',
    '/customers',
    '/dispatchers',
    '/credit-sales',
    '/change-password',
  ],
  dispatcher: ['/dispatchers', '/change-password'],
  targetolog: ['/dashboard', '/change-password'],
  purchasing_agent: ['/orders', '/change-password'],
};

/** Paths hidden for a role even when a permission would allow them. */
export const ROLE_HIDDEN_MENU_PATHS = {
  ceo: [
    '/users',
    '/audit-logs',
    '/workers',
    '/bonus-rules',
    '/equity',
    '/fixed-assets',
    '/receivables-payables',
    '/balance-sheet',
  ],
  // Founder no longer manages accounts — that moved to Admin with the role split — so the Users
  // page goes and the self-service password page comes back in its place.
  admin: ['/bonus-rules', '/users'],
  administrator: ['/bonus-rules', '/change-password'],
  investor: ['/users', '/workers', '/audit-logs', '/bonus-rules'],
  sales_manager: ['/inventory/packages'],
};

/** Sidebar menu definitions — labelKey resolved via i18n (common.nav.*) */
export const MENU_ITEMS = [
  { path: '/dashboard', labelKey: 'nav.dashboard', icon: '📊', permission: 'dashboard.view' },
  { path: '/products', labelKey: 'nav.products', icon: '👟', permission: 'products.view' },
  {
    labelKey: 'nav.inventory',
    icon: '📦',
    isDropdown: true,
    permissionAny: ['inventory.view', 'packages.view', 'inventory.count'],
    subItems: [
      { path: '/inventory/products', labelKey: 'nav.inventoryProducts', icon: '📦', permission: 'inventory.view' },
      { path: '/inventory/packages', labelKey: 'nav.packages', icon: '📮', permission: 'packages.view' },
      // Counting the shelves is its own permission, not `inventory.view`: a Sales Manager reads
      // the stock table all day and has no business in the write-off history.
      { path: '/inventory/stock-counts', labelKey: 'nav.stockCounts', icon: '📋', permission: 'inventory.count' },
    ],
  },
  { path: '/orders', labelKey: 'nav.orders', icon: '🛒', permission: 'orders.view' },
  { path: '/sales', labelKey: 'nav.sales', icon: '💰', permission: 'sales.view' },
  { path: '/returns', labelKey: 'nav.returns', icon: '↩️', permission: 'returns.view' },
  { path: '/dispatchers', labelKey: 'nav.dispatchers', icon: '🚚', permission: 'dispatch.view' },
  { path: '/receivables-payables', labelKey: 'nav.receivablesPayables', icon: '📑', permission: 'receivables.view' },
  { path: '/credit-sales', labelKey: 'nav.creditSales', icon: '🤝', permission: 'credit_sales.view' },
  { path: '/finance', labelKey: 'nav.finance', icon: '💵', permission: 'finance.view' },
  { path: '/equity', labelKey: 'nav.equity', icon: '🏛️', permission: 'equity.view' },
  { path: '/fixed-assets', labelKey: 'nav.fixedAssets', icon: '🏢', permission: 'fixed_assets.view' },
  { path: '/profit-loss', labelKey: 'nav.profitLoss', icon: '📈', permission: 'finance.profit_loss' },
  { path: '/money-balance', labelKey: 'nav.moneyBalance', icon: '💳', permission: 'cash.view' },
  { path: '/balance-sheet', labelKey: 'nav.balanceSheet', icon: '📊', permission: 'finance.balance_sheet' },
  { path: '/customers', labelKey: 'nav.customers', icon: '👥', permission: 'customers.view' },
  { path: '/jarimalar', labelKey: 'nav.jarimalar', icon: '⚠️', permission: 'penalties.manage' },
  { path: '/workers', labelKey: 'nav.workers', icon: '👷', permission: 'workers.view' },
  { path: '/audit-logs', labelKey: 'nav.auditLogs', icon: '📝', permission: 'audit_logs.view' },
  { path: '/bonus-rules', labelKey: 'nav.bonusRules', icon: '🎁', permission: 'bonus.manage' },
  { path: '/users', labelKey: 'nav.users', icon: '👤', permission: 'users.view' },
  { path: '/change-password', labelKey: 'nav.changePassword', icon: '🔑' },
];

export function normalizePermissions(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions)) return user.permissions;
  return [];
}

function viewAllCodeForView(code) {
  if (!code?.endsWith('.view') || code.endsWith('.view_all')) return null;
  return `${code.slice(0, -5)}.view_all`;
}

export function hasPermission(user, code) {
  if (!user || !code) return false;
  const perms = normalizePermissions(user);
  if (perms.includes(code)) return true;
  const viewAll = viewAllCodeForView(code);
  return viewAll != null && perms.includes(viewAll);
}

export function hasAnyPermission(user, codes = []) {
  if (!codes.length) return true;
  return codes.some((c) => hasPermission(user, c));
}

export function hasAllPermissions(user, codes = []) {
  if (!codes.length) return true;
  return codes.every((c) => hasPermission(user, c));
}

export function getRoleCode(user) {
  return user?.role_code || user?.role?.code || user?.role || 'sales_manager';
}

/** Exact supplier_country value Purchasing Agent may see/work (Yetkazib beruvchi mamlakat). */
export const PURCHASING_AGENT_SUPPLIER_COUNTRY = 'Yaponiya';

export function isPurchasingAgent(user) {
  return getRoleCode(user) === 'purchasing_agent';
}

export function isCEO(user) {
  return getRoleCode(user) === 'ceo';
}

/**
 * The two top roles. Mirrors FOUNDER_LEVEL_ROLE_CODES on the server.
 *
 * Founder and Admin carry the same authority today and are separated so they can stop doing so
 * later. Anything asking "is this one of the people who run the place?" belongs here; anything
 * asking "may this person do X?" belongs in a permission code instead, which is what will still
 * be right once the two lists diverge.
 */
export const FOUNDER_LEVEL_ROLES = ['admin', 'administrator'];

export function isAdmin(user) {
  return FOUNDER_LEVEL_ROLES.includes(getRoleCode(user));
}

/** Display label for role (Founder instead of Admin). Pass optional t from useTranslation('common'). */
export function getRoleDisplayName(user, t) {
  if (!user) return '';
  const code = getRoleCode(user);
  if (t) {
    if (code === 'admin') return t('roles.founder');
    const key = `roles.${code}`;
    const translated = t(key, { defaultValue: '' });
    if (translated) return translated;
  }
  if (code === 'admin') return 'Founder';
  if (code === 'administrator') return 'Admin';
  if (user.role_name) return user.role_name;
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isSeniorSalesManager(user) {
  return getRoleCode(user) === 'senior_sales_manager';
}

export function isInvestor(user) {
  return getRoleCode(user) === 'investor';
}

export function isTargetolog(user) {
  return getRoleCode(user) === 'targetolog';
}

/** Investor, Targetolog, and future observer roles — hide mutation controls in the UI. */
export function isReadOnly(user) {
  return isInvestor(user) || isTargetolog(user);
}

/**
 * Sees the full dashboard — every tab, every chart, the Founder's view.
 *
 * Separate from `isAdmin` because "who runs the place" and "who may look at the whole picture"
 * are different questions, and the Investor is the case that proves it: an observer with no
 * operational control who is nonetheless entitled to the same figures the owner reads. Routing
 * that off `isAdmin` gave them the older, thinner dashboard instead.
 *
 * The tabs themselves stay gated on `dashboard.ceo` — this only decides which dashboard is put
 * in front of the user, never what they may see once inside it.
 */
export function seesFullDashboard(user) {
  return isAdmin(user) || isInvestor(user);
}

/** Admin, CEO, or Senior Sales Manager — full operational visibility (all sales/orders). */
export function isOperationalSenior(user) {
  const role = getRoleCode(user);
  return isAdmin(user) || role === 'ceo' || role === 'senior_sales_manager';
}

function pathAllowedForRole(user, path) {
  // Self-service password page: hidden only from roles that reach the Users tab instead, which
  // is now Admin alone. Founder used to be in that group, and hiding the Users page from Founder
  // without this would have left the owner no way to change his own password at all. The rule
  // lives in each role's hidden list rather than being spelled out here, so the two questions —
  // who sees Users, who sees Change password — cannot drift apart again.
  if (path === '/users' && (isCEO(user) || isInvestor(user))) return false;
  const role = getRoleCode(user);
  const hidden = ROLE_HIDDEN_MENU_PATHS[role];
  if (hidden && hidden.includes(path)) return false;
  const visible = ROLE_VISIBLE_MENU_PATHS[role];
  if (visible) {
    return visible.includes(path);
  }
  return true;
}

export function canAccessRoute(user, path) {
  if (!pathAllowedForRole(user, path)) return false;
  const permission = ROUTE_PERMISSIONS[path];
  if (!permission) return true;
  return hasPermission(user, permission);
}

/** First route after login / when a guarded page denies access. */
export function getDefaultHomePath(user) {
  if (!user) return '/dashboard';

  const role = getRoleCode(user);
  const roleHome = ROLE_VISIBLE_MENU_PATHS[role];
  if (roleHome?.length === 1) {
    return roleHome[0];
  }

  if (hasPermission(user, 'dashboard.view') && pathAllowedForRole(user, '/dashboard')) {
    return '/dashboard';
  }

  const orderedPaths = [
    '/dashboard',
    '/products',
    '/inventory/products',
    '/inventory/packages',
    '/orders',
    '/sales',
    '/returns',
    '/dispatchers',
    '/finance',
    '/customers',
    '/users',
  ];
  for (const path of orderedPaths) {
    if (canAccessRoute(user, path)) return path;
  }

  return '/dashboard';
}

function itemPathAllowed(user, item) {
  if (item.isDropdown) {
    const subItems = (item.subItems || []).filter(
      (sub) => sub.path && pathAllowedForRole(user, sub.path) && (!sub.permission || hasPermission(user, sub.permission)),
    );
    return subItems.length > 0;
  }
  if (item.path && !pathAllowedForRole(user, item.path)) return false;
  if (item.permission && !hasPermission(user, item.permission)) return false;
  if (item.permissionAny && !hasAnyPermission(user, item.permissionAny)) return false;
  return true;
}

export function filterMenuItems(user, items = MENU_ITEMS) {
  return items
    .map((item) => {
      if (!itemPathAllowed(user, item)) return null;
      if (item.isDropdown) {
        const subItems = (item.subItems || []).filter(
          (sub) =>
            (!sub.path || pathAllowedForRole(user, sub.path)) &&
            (!sub.permission || hasPermission(user, sub.permission)),
        );
        if (!subItems.length) return null;
        return { ...item, subItems };
      }
      return item;
    })
    .filter(Boolean);
}
