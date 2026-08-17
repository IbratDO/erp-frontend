import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

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

/** Locked to Uzbek until multi-language UI is enabled. */
const APP_LANGUAGE = 'uz';

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

if (typeof window !== 'undefined') {
  window.localStorage.setItem('erp_lang', APP_LANGUAGE);
}

i18n.use(initReactI18next).init({
  resources,
  lng: APP_LANGUAGE,
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: Object.keys(resources.uz),
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Reserved for future language switcher; currently no-op (Uzbek only). */
export function setAppLanguage() {
  i18n.changeLanguage(APP_LANGUAGE);
}

export default i18n;
