import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { SUPPORTED_LANGUAGES, getStoredLanguage, storeLanguage } from '../utils/appLanguage';

import uzCommon from '../locales/uz/common.json';
import uzStatus from '../locales/uz/status.json';
import uzDashboard from '../locales/uz/dashboard.json';
import uzOrders from '../locales/uz/orders.json';
import uzSales from '../locales/uz/sales.json';
import uzProducts from '../locales/uz/products.json';
import uzInventory from '../locales/uz/inventory.json';
import uzPackages from '../locales/uz/packages.json';
import uzReturns from '../locales/uz/returns.json';
import uzFinance from '../locales/uz/finance.json';
import uzCustomers from '../locales/uz/customers.json';
import uzDispatchers from '../locales/uz/dispatchers.json';
import uzMoneyBalance from '../locales/uz/moneyBalance.json';
import uzEquity from '../locales/uz/equity.json';
import uzFixedAssets from '../locales/uz/fixedAssets.json';
import uzProfitLoss from '../locales/uz/profitLoss.json';
import uzBalanceSheet from '../locales/uz/balanceSheet.json';
import uzReceivables from '../locales/uz/receivables.json';
import uzCreditSales from '../locales/uz/creditSales.json';
import uzNotifications from '../locales/uz/notifications.json';
import uzUsers from '../locales/uz/users.json';
import uzAudit from '../locales/uz/audit.json';
import uzPenalties from '../locales/uz/penalties.json';
import uzWorkers from '../locales/uz/workers.json';
import uzBonusRules from '../locales/uz/bonusRules.json';

import ruCommon from '../locales/ru/common.json';
import ruStatus from '../locales/ru/status.json';
import ruDashboard from '../locales/ru/dashboard.json';
import ruOrders from '../locales/ru/orders.json';
import ruSales from '../locales/ru/sales.json';
import ruProducts from '../locales/ru/products.json';
import ruInventory from '../locales/ru/inventory.json';
import ruPackages from '../locales/ru/packages.json';
import ruReturns from '../locales/ru/returns.json';
import ruFinance from '../locales/ru/finance.json';
import ruCustomers from '../locales/ru/customers.json';
import ruDispatchers from '../locales/ru/dispatchers.json';
import ruMoneyBalance from '../locales/ru/moneyBalance.json';
import ruEquity from '../locales/ru/equity.json';
import ruFixedAssets from '../locales/ru/fixedAssets.json';
import ruProfitLoss from '../locales/ru/profitLoss.json';
import ruBalanceSheet from '../locales/ru/balanceSheet.json';
import ruReceivables from '../locales/ru/receivables.json';
import ruCreditSales from '../locales/ru/creditSales.json';
import ruNotifications from '../locales/ru/notifications.json';
import ruUsers from '../locales/ru/users.json';
import ruAudit from '../locales/ru/audit.json';
import ruPenalties from '../locales/ru/penalties.json';
import ruWorkers from '../locales/ru/workers.json';
import ruBonusRules from '../locales/ru/bonusRules.json';

import enCommon from '../locales/en/common.json';
import enStatus from '../locales/en/status.json';
import enDashboard from '../locales/en/dashboard.json';
import enOrders from '../locales/en/orders.json';
import enSales from '../locales/en/sales.json';
import enProducts from '../locales/en/products.json';
import enInventory from '../locales/en/inventory.json';
import enPackages from '../locales/en/packages.json';
import enReturns from '../locales/en/returns.json';
import enFinance from '../locales/en/finance.json';
import enCustomers from '../locales/en/customers.json';
import enDispatchers from '../locales/en/dispatchers.json';
import enMoneyBalance from '../locales/en/moneyBalance.json';
import enEquity from '../locales/en/equity.json';
import enFixedAssets from '../locales/en/fixedAssets.json';
import enProfitLoss from '../locales/en/profitLoss.json';
import enBalanceSheet from '../locales/en/balanceSheet.json';
import enReceivables from '../locales/en/receivables.json';
import enCreditSales from '../locales/en/creditSales.json';
import enNotifications from '../locales/en/notifications.json';
import enUsers from '../locales/en/users.json';
import enAudit from '../locales/en/audit.json';
import enPenalties from '../locales/en/penalties.json';
import enWorkers from '../locales/en/workers.json';
import enBonusRules from '../locales/en/bonusRules.json';

/**
 * Uzbek or Russian, whichever this browser last chose — see `utils/appLanguage`.
 *
 * English stays in `resources` purely as the fallback: it is not offered in the switcher, but a
 * key missing from a translation renders its English words instead of a raw `sales.batch.title`.
 */
const APP_LANGUAGE = getStoredLanguage();

const resources = {
  uz: {
    common: uzCommon,
    status: uzStatus,
    dashboard: uzDashboard,
    orders: uzOrders,
    sales: uzSales,
    products: uzProducts,
    inventory: uzInventory,
    packages: uzPackages,
    returns: uzReturns,
    finance: uzFinance,
    customers: uzCustomers,
    dispatchers: uzDispatchers,
    moneyBalance: uzMoneyBalance,
    equity: uzEquity,
    fixedAssets: uzFixedAssets,
    profitLoss: uzProfitLoss,
    balanceSheet: uzBalanceSheet,
    receivables: uzReceivables,
    creditSales: uzCreditSales,
    notifications: uzNotifications,
    users: uzUsers,
    audit: uzAudit,
    penalties: uzPenalties,
    workers: uzWorkers,
    bonusRules: uzBonusRules,
  },
  ru: {
    common: ruCommon,
    status: ruStatus,
    dashboard: ruDashboard,
    orders: ruOrders,
    sales: ruSales,
    products: ruProducts,
    inventory: ruInventory,
    packages: ruPackages,
    returns: ruReturns,
    finance: ruFinance,
    customers: ruCustomers,
    dispatchers: ruDispatchers,
    moneyBalance: ruMoneyBalance,
    equity: ruEquity,
    fixedAssets: ruFixedAssets,
    profitLoss: ruProfitLoss,
    balanceSheet: ruBalanceSheet,
    receivables: ruReceivables,
    creditSales: ruCreditSales,
    notifications: ruNotifications,
    users: ruUsers,
    audit: ruAudit,
    penalties: ruPenalties,
    workers: ruWorkers,
    bonusRules: ruBonusRules,
  },
  en: {
    common: enCommon,
    status: enStatus,
    dashboard: enDashboard,
    orders: enOrders,
    sales: enSales,
    products: enProducts,
    inventory: enInventory,
    packages: enPackages,
    returns: enReturns,
    finance: enFinance,
    customers: enCustomers,
    dispatchers: enDispatchers,
    moneyBalance: enMoneyBalance,
    equity: enEquity,
    fixedAssets: enFixedAssets,
    profitLoss: enProfitLoss,
    balanceSheet: enBalanceSheet,
    receivables: enReceivables,
    creditSales: enCreditSales,
    notifications: enNotifications,
    users: enUsers,
    audit: enAudit,
    penalties: enPenalties,
    workers: enWorkers,
    bonusRules: enBonusRules,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: APP_LANGUAGE,
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: Object.keys(resources.uz),
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/**
 * Switch the interface language and remember it.
 *
 * `changeLanguage` re-renders every component holding a `t` from the hook, so no page reload is
 * needed — which matters because the switcher sits in the top bar and somebody may be halfway
 * through a form when they press it. Reloading would throw that away.
 */
export function setAppLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) return;
  storeLanguage(language);
  i18n.changeLanguage(language);
}

export default i18n;
