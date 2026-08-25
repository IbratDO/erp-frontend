import React, { useState, useEffect, useMemo } from 'react';
import { Trans } from 'react-i18next';
import api from '../utils/api';
import Modal from '../components/Modal';
import apiGetAll from '../utils/fetchAllPages';
import { useAuth } from '../contexts/AuthContext';
import useAppTranslation from '../hooks/useAppTranslation';
import { formatAppDateTime, formatAppNumber } from '../utils/localeFormat';
import {
  signedFinanceAmountsByLeg,
  BALANCE_TABLE_LEGS,
  financeRecordLegKey,
} from '../utils/tableTotals';
import PageTitle from '../components/PageTitle';
import FormSearchableSelect from '../components/FormSearchableSelect';
import './TablePage.css';
import SortableTh from '../components/SortableTh';
import { useClientTableSort } from '../utils/tableSort';
import AmountInput from '../components/AmountInput';
import FilterPanel from '../components/FilterPanel';
import BusyForm, { SubmitButton } from '../components/BusyForm';
import ActionButton from '../components/ActionButton';

const EXPENSE_TYPE_VALUES = [
  'salary', 'lunch', 'taxi', 'office_supplies', 'utilities', 'rent', 'delivery', 'cargo', 'smm', 'other',
];
const EXPENSE_TARGET_VALUES = ['shop', 'warehouse', 'office', 'marketing', 'logistics', 'operations', 'other'];
const FILTER_EXPENSE_TYPES = ['salary', 'lunch', 'taxi', 'office_supplies', 'utilities', 'rent', 'smm', 'other'];

/** Signed value for the leg that matches this record, or null if not applicable. */
function signedForFinanceRecordLeg(record, leg) {
  if (financeRecordLegKey(record) !== leg) return null;
  const raw = parseFloat(record.amount) || 0;
  if (raw === 0) return 0;
  return record.record_type === 'income' ? raw : -raw;
}

function financeRecordRecipientSortKey(record) {
  if (!record.recipient_detail) return '';
  const d = record.recipient_detail;
  const extra = [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
  return `${d.username || ''} ${extra}`.trim().toLowerCase();
}

const FINANCE_RECORD_SORT_ACCESSORS = {
  id: (r) => Number(r.id) || 0,
  record_type: (r) => String(r.record_type ?? '').toLowerCase(),
  expense_type: (r) => String(r.expense_type ?? '').replace(/_/g, ' ').toLowerCase(),
  status: (r) => String(r.status ?? '').toLowerCase(),
  related_order: (r) => Number(r.order) || 0,
  related_sale: (r) => Number(r.sale) || 0,
  related_dispatch: (r) => Number(r.dispatch) || 0,
  recipient_key: (r) => financeRecordRecipientSortKey(r),
  notes: (r) => String(r.notes ?? '').toLowerCase(),
  transaction_date: (r) => new Date(r.transaction_date).getTime() || 0,
};
for (const leg of BALANCE_TABLE_LEGS) {
  FINANCE_RECORD_SORT_ACCESSORS[`leg_${leg}`] = (r) => {
    const v = signedForFinanceRecordLeg(r, leg);
    return v === null ? 0 : v;
  };
}

function FinanceLegCell({ record, leg }) {
  const v = signedForFinanceRecordLeg(record, leg);
  if (v === null) {
    return <span style={{ color: '#ced4da' }}>—</span>;
  }
  const isUzs = leg.startsWith('uzs');
  if (v === 0) {
    return <span style={{ color: '#adb5bd' }}>0</span>;
  }
  const color = v > 0 ? '#27ae60' : '#e74c3c';
  if (isUzs) {
    return (
      <span style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {v > 0 ? '+' : '−'}
        {Math.abs(v).toLocaleString()}
      </span>
    );
  }
  return (
    <span style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
      {v > 0 ? '+$' : v < 0 ? '−$' : '$'}
      {Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

function FinanceLegTotal({ value, leg }) {
  const isUzs = leg.startsWith('uzs');
  if (value === 0) {
    return <span style={{ color: '#adb5bd' }}>0</span>;
  }
  const color = value > 0 ? '#1e5f2a' : '#a71d2a';
  if (isUzs) {
    return (
      <span style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value > 0 ? '+' : '−'}
        {Math.abs(value).toLocaleString()}
      </span>
    );
  }
  return (
    <span style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
      {value > 0 ? '+$' : '−$'}
      {Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

const Finance = () => {
  const { t, tStatus, monthOptions } = useAppTranslation(['finance', 'common', 'status']);
  const uzsLabel = t('currency.uzs', { ns: 'common' });
  const usdLabel = t('currency.usd', { ns: 'common' });
  const financeLegHeader = (leg) => {
    if (leg === 'uzs_cash' || leg.startsWith('uzs')) return uzsLabel;
    if (leg === 'usd_cash' || leg.startsWith('usd')) return usdLabel;
    return leg;
  };
  const { hasPermission } = useAuth();
  const canCreateExpense = hasPermission('finance.create_manual');
  const canCreateIncome = hasPermission('finance.create_income');
  const canCreateManual = canCreateExpense || canCreateIncome;
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [expenseFormData, setExpenseFormData] = useState({
    expense_type: 'lunch',
    target: '',
    currency: 'USD',
    amount: '',
    recipient: '',
    notes: '',
    pay_immediately: true,
  });

  const expenseTargetOptions = useMemo(
    () => EXPENSE_TARGET_VALUES.map((value) => ({ value, label: t(`targets.${value}`) })),
    [t],
  );

  const [incomeFormData, setIncomeFormData] = useState({
    currency: 'USD',
    amount: '',
    notes: '',
    pay_immediately: true,
  });
  const [workers, setWorkers] = useState([]);
  const [filter, setFilter] = useState({
    type: '',
    status: '',
    expense_type: '',
    currency: '',
    year: '',
    month: '',
  });

  useEffect(() => {
    if (canCreateManual) {
      fetchWorkers();
    }
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, canCreateManual]);

  const fetchWorkers = async () => {
    try {
      const response = await apiGetAll('/workers/');
      setWorkers(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching workers:', error);
    }
  };

  const fetchRecords = async () => {
    try {
      let url = '/finance/';
      const params = new URLSearchParams();
      params.append('scope', 'other');
      if (filter.type) params.append('type', filter.type);
      if (filter.status) params.append('status', filter.status);
      if (filter.expense_type) params.append('expense_type', filter.expense_type);
      // Convert year/month to date range
      if (filter.year || filter.month) {
        let dateFrom, dateTo;
        if (filter.year && filter.month) {
          // Specific year and month
          dateFrom = `${filter.year}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(parseInt(filter.year), parseInt(filter.month), 0).getDate();
          dateTo = `${filter.year}-${filter.month.padStart(2, '0')}-${lastDay}`;
        } else if (filter.year) {
          // Entire year
          dateFrom = `${filter.year}-01-01`;
          dateTo = `${filter.year}-12-31`;
        } else if (filter.month) {
          // Current year, specific month
          const currentYear = new Date().getFullYear();
          dateFrom = `${currentYear}-${filter.month.padStart(2, '0')}-01`;
          const lastDay = new Date(currentYear, parseInt(filter.month), 0).getDate();
          dateTo = `${currentYear}-${filter.month.padStart(2, '0')}-${lastDay}`;
        }
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
      }
      
      if (params.toString()) url += `?${params.toString()}`;

      const response = await apiGetAll(url);
      setRecords(response.data.results || response.data);
    } catch (error) {
      console.error('Error fetching finance records:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSettleRecord = async (record) => {
    if (!window.confirm(t('confirmSettle'))) return;
    try {
      const res = await api.post(`/finance/${record.id}/settle/`);
      alert(res.data?.message || t('notifications.settled'));
      fetchRecords();
    } catch (error) {
      alert(error.response?.data?.error || t('notifications.settleFailed'));
    }
  };

  const handleExpenseSubmit = async (e) => {
    e.preventDefault();
    if (
      expenseFormData.expense_type === 'other' &&
      !String(expenseFormData.notes || '').trim()
    ) {
      alert(t('notifications.notesRequiredOther'));
      return;
    }
    try {
      const payload = {
        record_type: 'expense',
        expense_type: expenseFormData.expense_type,
        target: expenseFormData.target || null,
        amount: expenseFormData.amount || 0,
        currency: expenseFormData.currency,
        payment_type: 'cash',
        recipient: expenseFormData.recipient || null,
        notes: String(expenseFormData.notes || '').trim(),
        pay_immediately: expenseFormData.pay_immediately,
      };

      await api.post('/finance/', payload);
      setShowExpenseForm(false);
      setExpenseFormData({
        expense_type: 'lunch',
        target: '',
        currency: 'USD',
        amount: '',
        recipient: '',
        notes: '',
        pay_immediately: true,
      });
      fetchRecords();
      if (canCreateManual) {
        fetchWorkers();
      }
    } catch (error) {
      console.error('Error creating expense:', error);
      // Handle validation errors from DRF
      const errorMessage = error.response?.data?.detail || 
                          error.response?.data?.non_field_errors?.[0] ||
                          (Array.isArray(error.response?.data) ? error.response.data[0] : null) ||
                          t('notifications.createExpenseFailed');
      alert(errorMessage);
    }
  };

  const handleIncomeSubmit = async (e) => {
    e.preventDefault();
    if (!String(incomeFormData.notes || '').trim()) {
      alert(t('notifications.notesRequiredIncome'));
      return;
    }
    try {
      await api.post('/finance/', {
        record_type: 'income',
        amount: incomeFormData.amount || 0,
        currency: incomeFormData.currency,
        payment_type: 'cash',
        notes: String(incomeFormData.notes || '').trim(),
        pay_immediately: incomeFormData.pay_immediately,
      });
      setShowIncomeForm(false);
      setIncomeFormData({ currency: 'USD', amount: '', notes: '', pay_immediately: true });
      fetchRecords();
    } catch (error) {
      const errorMessage =
        error.response?.data?.detail ||
        error.response?.data?.non_field_errors?.[0] ||
        error.response?.data?.error ||
        t('notifications.createIncomeFailed');
      alert(errorMessage);
    }
  };

  const recordSignedLegTotals = useMemo(
    () => signedFinanceAmountsByLeg(records, { status: 'completed' }),
    [records],
  );

  const financeRecordsSort = useClientTableSort(FINANCE_RECORD_SORT_ACCESSORS);
  const sortedRecords = useMemo(
    () => financeRecordsSort.sortRows(records || []),
    [records, financeRecordsSort],
  );

  if (loading) {
    return <div className="page-container">{t('actions.loading', { ns: 'common' })}</div>;
  }

  // Calculate statistics separately for USD and UZS
  const totalIncomeUSD = records
    .filter((r) => r.record_type === 'income' && r.status === 'completed' && r.currency === 'USD')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const totalIncomeUZS = records
    .filter((r) => r.record_type === 'income' && r.status === 'completed' && r.currency === 'UZS')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const totalExpenseUSD = records
    .filter((r) => r.record_type === 'expense' && r.status === 'completed' && r.currency === 'USD')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const totalExpenseUZS = records
    .filter((r) => r.record_type === 'expense' && r.status === 'completed' && r.currency === 'UZS')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const netOtherUSD = totalIncomeUSD - totalExpenseUSD;
  const netOtherUZS = totalIncomeUZS - totalExpenseUZS;

  return (
    <div className="page-container">
      <div className="page-header">
        <PageTitle ns="finance" />
        {canCreateManual && (
          <div style={{ display: 'flex', gap: 8 }}>
            {canCreateIncome && (
              <button className="btn-primary" onClick={() => { setShowIncomeForm(true); setShowExpenseForm(false); }}>
                {t('addIncome')}
              </button>
            )}
            {canCreateExpense && (
              <button className="btn-edit" onClick={() => { setShowExpenseForm(true); setShowIncomeForm(false); }}>
                {t('addExpense')}
              </button>
            )}
          </div>
        )}
      </div>

      <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9em', maxWidth: 720 }}>
        <Trans i18nKey="intro" ns="finance" components={{ strong: <strong /> }} />
      </p>

      <Modal
        open={showExpenseForm && canCreateExpense}
        onClose={() => setShowExpenseForm(false)}
        title={t('expenseForm.title')}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
      >
          <BusyForm onSubmit={handleExpenseSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('expenseForm.expenseType')}</label>
                <select
                  value={expenseFormData.expense_type}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, expense_type: e.target.value })}
                  required
                >
                  {EXPENSE_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>{t(`expenseTypes.${value}`)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t('expenseForm.target')}</label>
                <select
                  value={expenseFormData.target}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, target: e.target.value })}
                >
                  <option value="">{t('expenseForm.selectTarget')}</option>
                  {expenseTargetOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t('expenseForm.currency')}</label>
                <select
                  value={expenseFormData.currency}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, currency: e.target.value })}
                  required
                >
                  <option value="USD">{usdLabel}</option>
                  <option value="UZS">{uzsLabel}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('expenseForm.amount')}</label>
                <AmountInput
                  value={expenseFormData.amount}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, amount: e.target.value })}
                  required
                />
              </div>
              {(expenseFormData.expense_type === 'salary' || expenseFormData.expense_type === 'lunch') && (
                <div className="form-group">
                  <label>{t('expenseForm.recipient')}</label>
                  <FormSearchableSelect
                    value={expenseFormData.recipient}
                    onChange={(v) => setExpenseFormData({ ...expenseFormData, recipient: v })}
                    options={workers.map((worker) => ({
                      value: String(worker.id),
                      label: `${worker.name}${worker.telephone ? ` (${worker.telephone})` : ''}`,
                    }))}
                    emptyLabel={t('expenseForm.selectRecipient')}
                    placeholder={t('expenseForm.selectRecipient')}
                    aria-label={t('expenseForm.recipient')}
                  />
                </div>
              )}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>
                  {expenseFormData.expense_type === 'other' ? t('expenseForm.notesRequiredOther') : t('expenseForm.notes')}
                </label>
                <textarea
                  value={expenseFormData.notes}
                  onChange={(e) => setExpenseFormData({ ...expenseFormData, notes: e.target.value })}
                  rows="2"
                  required={expenseFormData.expense_type === 'other'}
                  placeholder={
                    expenseFormData.expense_type === 'salary'
                      ? t('expenseForm.notesPlaceholderSalary')
                      : expenseFormData.expense_type === 'other'
                        ? t('expenseForm.notesPlaceholderOther')
                        : t('expenseForm.notesPlaceholderDefault')
                  }
                />
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={expenseFormData.pay_immediately}
                    onChange={(e) =>
                      setExpenseFormData({ ...expenseFormData, pay_immediately: e.target.checked })
                    }
                  />{' '}
                  {t('expenseForm.payImmediately')}
                </label>
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">
                {t('expenseForm.submit')}
              </SubmitButton>
              <button type="button" className="btn-edit" onClick={() => setShowExpenseForm(false)}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      <Modal
        open={showIncomeForm && canCreateIncome}
        onClose={() => setShowIncomeForm(false)}
        title={t('incomeForm.title')}
        closeLabel={t('actions.close', { ns: 'common' })}
        closeOnBackdrop={false}
      >
          <BusyForm onSubmit={handleIncomeSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>{t('incomeForm.currency')}</label>
                <select
                  value={incomeFormData.currency}
                  onChange={(e) => setIncomeFormData({ ...incomeFormData, currency: e.target.value })}
                  required
                >
                  <option value="USD">{usdLabel}</option>
                  <option value="UZS">{uzsLabel}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('incomeForm.amount')}</label>
                <AmountInput
                  value={incomeFormData.amount}
                  onChange={(e) => setIncomeFormData({ ...incomeFormData, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('incomeForm.notes')}</label>
                <textarea
                  value={incomeFormData.notes}
                  onChange={(e) => setIncomeFormData({ ...incomeFormData, notes: e.target.value })}
                  rows="2"
                  required
                  placeholder={t('incomeForm.notesPlaceholder')}
                />
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={incomeFormData.pay_immediately}
                    onChange={(e) =>
                      setIncomeFormData({ ...incomeFormData, pay_immediately: e.target.checked })
                    }
                  />{' '}
                  {t('incomeForm.receivedImmediately')}
                </label>
              </div>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn-primary">{t('incomeForm.submit')}</SubmitButton>
              <button type="button" className="btn-edit" onClick={() => setShowIncomeForm(false)}>
                {t('actions.cancel', { ns: 'common' })}
              </button>
            </div>
          </BusyForm>
      </Modal>

      <div className="metrics-grid" style={{ marginBottom: '20px' }}>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.totalIncomeUsd')}</div>
            <div className="metric-value" style={{ color: '#27ae60' }}>
              {formatAppNumber(totalIncomeUSD, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {usdLabel}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.totalIncomeUzs')}</div>
            <div className="metric-value" style={{ color: '#27ae60' }}>
              {formatAppNumber(totalIncomeUZS, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {uzsLabel}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.totalExpenseUsd')}</div>
            <div className="metric-value" style={{ color: '#e74c3c' }}>
              {formatAppNumber(totalExpenseUSD, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {usdLabel}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.totalExpenseUzs')}</div>
            <div className="metric-value" style={{ color: '#e74c3c' }}>
              {formatAppNumber(totalExpenseUZS, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {uzsLabel}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.netOtherUsd')}</div>
            <div className="metric-value" style={{ color: netOtherUSD >= 0 ? '#27ae60' : '#e74c3c' }}>
              {formatAppNumber(netOtherUSD, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {usdLabel}
            </div>
            <div style={{ fontSize: '0.75em', color: '#888' }}>{t('metrics.netHint')}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{t('metrics.netOtherUzs')}</div>
            <div className="metric-value" style={{ color: netOtherUZS >= 0 ? '#27ae60' : '#e74c3c' }}>
              {formatAppNumber(netOtherUZS, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {uzsLabel}
            </div>
          </div>
        </div>

      {/* Filters — the page behind a dialog stays intact. */}
        <FilterPanel title={t('filters.title')} filters={filter} style={{ marginBottom: '16px' }}>
          <div className="filter-toolbar">
              <div className="filter-field">
                <label>{t('filters.type')}</label>
                <select
                  value={filter.type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    setFilter({
                      ...filter,
                      type: newType,
                      expense_type: newType === 'expense' ? filter.expense_type : '',
                    });
                  }}
                >
                  <option value="">{t('filters.allTypes')}</option>
                  <option value="income">{t('recordTypes.income')}</option>
                  <option value="expense">{t('recordTypes.expense')}</option>
                </select>
              </div>
              {(filter.type === 'expense' || filter.type === '') && (
                <div className="filter-field">
                  <label>{t('filters.expenseType')}</label>
                  <select
                    value={filter.expense_type}
                    onChange={(e) => setFilter({ ...filter, expense_type: e.target.value })}
                  >
                    <option value="">{t('filters.allExpenseTypes')}</option>
                    {FILTER_EXPENSE_TYPES.map((value) => (
                      <option key={value} value={value}>{t(`expenseTypes.${value}`)}</option>
                    ))}
                  </select>
                </div>
              )}
            <div className="filter-field">
              <label>{t('filters.status')}</label>
              <select
                value={filter.status}
                onChange={(e) => setFilter({ ...filter, status: e.target.value })}
              >
                <option value="">{t('filters.allStatuses')}</option>
                <option value="pending">{tStatus('pending', 'finance')}</option>
                <option value="completed">{tStatus('completed', 'finance')}</option>
                <option value="cancelled">{tStatus('cancelled', 'finance')}</option>
              </select>
            </div>
          <div className="filter-field">
            <label>{t('filters.year')}</label>
            <select
              value={filter.year}
              onChange={(e) => setFilter({ ...filter, year: e.target.value })}
            >
              <option value="">{t('filters.allYears')}</option>
              {Array.from({ length: 10 }, (_, i) => {
                const year = new Date().getFullYear() - i;
                return (
                  <option key={year} value={year.toString()}>
                    {year}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="filter-field">
            <label>{t('filters.month')}</label>
            <select
              value={filter.month}
              onChange={(e) => setFilter({ ...filter, month: e.target.value })}
            >
              <option value="">{t('filters.allMonths')}</option>
              {monthOptions.filter((o) => o.value).map((opt) => (
                <option key={opt.value} value={opt.value.padStart(2, '0')}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-toolbar__actions">
            <button
              type="button"
              className="btn-edit"
              onClick={() => setFilter({ type: '', status: '', expense_type: '', currency: '', year: '', month: '' })}
            >
              {t('filters.clearAll')}
            </button>
          </div>
        </div>
      </FilterPanel>

      <div className="table-card">
          <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh columnId="id" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.id')}</SortableTh>
                <SortableTh columnId="record_type" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.type')}</SortableTh>
                <SortableTh columnId="expense_type" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.expenseType')}</SortableTh>
                {BALANCE_TABLE_LEGS.map((leg) => (
                  <SortableTh key={leg} columnId={`leg_${leg}`} sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{financeLegHeader(leg)}</SortableTh>
                ))}
                <SortableTh columnId="status" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.status')}</SortableTh>
                <SortableTh columnId="related_order" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.relatedOrder')}</SortableTh>
                <SortableTh columnId="related_sale" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.relatedSale')}</SortableTh>
                <SortableTh columnId="related_dispatch" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.relatedDispatch')}</SortableTh>
                <SortableTh columnId="recipient_key" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.recipient')}</SortableTh>
                <SortableTh columnId="notes" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.notes')}</SortableTh>
                <SortableTh columnId="transaction_date" sortCol={financeRecordsSort.sortCol} sortDir={financeRecordsSort.sortDir} onSort={financeRecordsSort.onHeaderClick}>{t('table.date')}</SortableTh>
                {canCreateManual && <th>{t('table.action')}</th>}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan="12" style={{ textAlign: 'center' }}>
                    {t('table.noRows')}
                  </td>
                </tr>
              ) : (
                sortedRecords.map((record) => (
                  <tr key={record.id}>
                    <td>#{record.id}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          record.record_type === 'income' ? 'confirmed' : 'pending'
                        }`}
                      >
                        {t(`recordTypes.${record.record_type}`, { defaultValue: record.record_type })}
                      </span>
                    </td>
                    <td>
                      {record.expense_type ? t(`expenseTypes.${record.expense_type}`, { defaultValue: record.expense_type }) : '-'}
                    </td>
                    {BALANCE_TABLE_LEGS.map((leg) => (
                      <td key={leg}>
                        <FinanceLegCell record={record} leg={leg} />
                    </td>
                    ))}
                    <td>
                      <span className={`status-badge ${record.status}`}>
                        {tStatus(record.status, 'finance')}
                      </span>
                    </td>
                    <td>
                      {record.order ? t('table.orderRef', { id: record.order }) : '-'}
                    </td>
                    <td>
                      {record.sale ? t('table.saleRef', { id: record.sale }) : '-'}
                    </td>
                    <td>
                      {record.dispatch ? t('table.dispatchRef', { id: record.dispatch }) : '-'}
                    </td>
                    <td>
                      {record.recipient_detail ? (
                        `${record.recipient_detail.username}${record.recipient_detail.first_name || record.recipient_detail.last_name ? ` (${record.recipient_detail.first_name} ${record.recipient_detail.last_name})`.trim() : ''}`
                      ) : '-'}
                    </td>
                    <td style={{ fontSize: '0.9em', maxWidth: '240px' }}>
                      {(() => {
                        const idLabel = t('table.recordNotes', { id: record.id });
                        const text = record.notes && String(record.notes).trim() ? String(record.notes).trim() : '';
                        const full = text ? `${idLabel} — ${text}` : idLabel;
                        return (
                          <span title={full}>
                            {full.length > 58 ? `${full.slice(0, 58)}…` : full}
                          </span>
                        );
                      })()}
                    </td>
                    <td>{formatAppDateTime(record.transaction_date)}</td>
                    {canCreateManual && (
                      <td>
                        {record.status === 'pending' ? (
                          <ActionButton type="button" className="btn-edit" onClick={() => handleSettleRecord(record)}>
                            {t('table.settle')}
                          </ActionButton>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3" style={{ textAlign: 'right' }}>
                  {t('table.netCompleted')}
                </td>
                {BALANCE_TABLE_LEGS.map((leg) => (
                  <td key={leg}>
                    {records.length > 0 ? (
                      <FinanceLegTotal value={recordSignedLegTotals[leg] || 0} leg={leg} />
                    ) : (
                      <span style={{ color: '#adb5bd' }}>—</span>
                    )}
                  </td>
                ))}
                <td
                  colSpan={canCreateManual ? 8 : 7}
                  style={{ fontSize: '0.85em', color: '#666', textAlign: 'right' }}
                >
                  {records.length > 0 ? t('table.footerHint') : ' '}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
    </div>
  );
};

export default Finance;
