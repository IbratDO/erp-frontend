import React, { useState, useEffect } from 'react';
import AmountInput from './AmountInput';
import SaleChangeFields from './SaleChangeFields';
import api from '../utils/api';
import { formatDisplayAmount } from '../utils/currencyFormat';
import useAppTranslation from '../hooks/useAppTranslation';
import {
  emptyPaymentFormState,
  buildPaymentFormDataFromSale,
  computePaymentDifferenceMeta,
  buildCompleteSaleRequest,
  buildGroupCompleteRequests,
  validateAdvanceCompletionPayment,
  buildCrossCurrencyAdvanceConfirmMessage,
  buildSplitCurrencyConfirmMessage,
  buildAdditionalProfitConfirmMessage,
  saleHasOrderAdvance,
  saleAcceptsChange,
} from '../utils/saleCompletePayHelpers';

/**
 * Complete sale & pay (status → completed). Shared by Sales and Dispatchers tabs.
 */
export default function SaleCompletePayForm({ sale, onClose, onSuccess, showNotification }) {
  const { t } = useAppTranslation(['sales', 'common']);
  const groupSales = sale?.groupSales?.length ? sale.groupSales : null;
  const [paymentFormData, setPaymentFormData] = useState(() => emptyPaymentFormState());
  const [exchangeRate, setExchangeRate] = useState(null);
  const [exchangeRateError, setExchangeRateError] = useState(null);

  useEffect(() => {
    if (!sale) {
      setExchangeRate(null);
      setExchangeRateError(null);
      setPaymentFormData(emptyPaymentFormState());
      return;
    }
    // Prefill immediately (same-currency advances work without rate); rebuild when CBU loads.
    setPaymentFormData(buildPaymentFormDataFromSale(sale, null));
    let cancelled = false;
    api
      .get('/exchange-rate/')
      .then((res) => {
        if (!cancelled) {
          setExchangeRate(res.data);
          setExchangeRateError(null);
          setPaymentFormData(buildPaymentFormDataFromSale(sale, res.data?.rate ?? null));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExchangeRate(null);
          setExchangeRateError(t('completePay.errCbuRate'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sale, t]);

  if (!sale) return null;

  const cbuRate = exchangeRate?.rate ?? null;
  const shortfallMeta = computePaymentDifferenceMeta(sale, paymentFormData, cbuRate);
  const sc = paymentFormData.sale_currency || sale.sale_currency || 'USD';
  const listUnit = paymentFormData.list_unit_price ?? (parseFloat(sale.selling_price) || 0);
  const discountAmountPerUnit = paymentFormData.discount_amount_per_unit ?? (parseFloat(sale.discount_price) || 0);
  const finalUnit = paymentFormData.final_unit_price ?? Math.max(0, listUnit - discountAmountPerUnit);
  const qty = parseFloat(sale.quantity) || 1;
  const listTotal = paymentFormData.list_total_amount ?? listUnit * qty;
  const saleDiscountTotal = paymentFormData.sale_discount_total ?? discountAmountPerUnit * qty;
  const finalDue =
    shortfallMeta.due != null && !Number.isNaN(shortfallMeta.due)
      ? shortfallMeta.due
      : paymentFormData.final_amount_due ?? finalUnit * qty;

  // The change panel keys off the *gross* surplus, not `shortfallMeta.needs`: once change
  // covers the surplus the payment reads as exact and `needs` goes false, which would pull the
  // panel out from under the amounts the user just typed.
  const changeTol = shortfallMeta.sc === 'UZS' ? 1 : 0.005;
  const changeAvailable =
    saleAcceptsChange(sale)
    && (
      paymentFormData.apply_change
      || (shortfallMeta.requiredChange != null && shortfallMeta.requiredChange > changeTol)
    );

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const meta = computePaymentDifferenceMeta(sale, paymentFormData, cbuRate);
      const uzsT = parseFloat(paymentFormData.uzs) || 0;
      const usdT = parseFloat(paymentFormData.usd) || 0;
      const advanceCheck = validateAdvanceCompletionPayment(
        sale,
        paymentFormData.uzs,
        paymentFormData.usd,
        undefined,
        cbuRate,
        meta.changeInSc || 0,
      );
      if (!advanceCheck.ok) {
        showNotification(advanceCheck.error, 'error');
        return;
      }

      if (meta.mixed) {
        showNotification(t('completePay.errRateLoading'), 'error');
        return;
      }

      if (advanceCheck.needsSplitCurrencyConfirm) {
        if (
          !window.confirm(
            buildSplitCurrencyConfirmMessage({
              sale,
              uzsAmount: advanceCheck.uzsAmount,
              usdAmount: advanceCheck.usdAmount,
              due: advanceCheck.due,
              sc: advanceCheck.sc,
              cbuRate: advanceCheck.cbuRate,
              paidInSaleCurrency: advanceCheck.paidInSaleCurrency,
              exchangeRate,
            }),
          )
        ) {
          return;
        }
      } else if (advanceCheck.needsCrossCurrencyConfirm) {
        if (!window.confirm(buildCrossCurrencyAdvanceConfirmMessage(advanceCheck, exchangeRate))) return;
      } else if ((meta.splitCurrency || meta.crossCurrency) && (uzsT > 0 || usdT > 0)) {
        if (
          !window.confirm(
            buildSplitCurrencyConfirmMessage({
              sale,
              uzsAmount: uzsT,
              usdAmount: usdT,
              due: meta.due,
              sc: meta.sc,
              cbuRate,
              paidInSaleCurrency: meta.paid,
              exchangeRate,
            }),
          )
        ) {
          return;
        }
      }

      if (meta.exceedsRemainingDue) {
        showNotification(
          t('completePay.errExceedsDue', { due: meta.due.toFixed(2), currency: meta.sc }),
          'error',
        );
        return;
      }

      if (paymentFormData.dispatch_payment_needed) {
        const dAmt = parseFloat(String(paymentFormData.dispatch_payment_amount).replace(',', '.')) || 0;
        if (dAmt <= 0) {
          showNotification(t('completePay.errDispatchAmount'), 'error');
          return;
        }
      }

      if (
        paymentFormData.balance_shortfall_type === 'discount'
        && !(parseFloat(paymentFormData.balance_shortfall_amount) > 0)
      ) {
        showNotification(t('completePay.errDiscountAmount'), 'error');
        return;
      }

      if (paymentFormData.apply_change) {
        const chUzs = parseFloat(paymentFormData.change_uzs) || 0;
        const chUsd = parseFloat(paymentFormData.change_usd) || 0;
        if (chUzs <= 0 && chUsd <= 0) {
          showNotification(t('completePay.errChangeAmount'), 'error');
          return;
        }
        if (meta.changePending) {
          showNotification(t('completePay.errRateLoading'), 'error');
          return;
        }
      }

      let effForm = paymentFormData;
      let effMeta = meta;
      if (meta.needsAdditionalProfitConfirm) {
        if (!window.confirm(buildAdditionalProfitConfirmMessage(meta, exchangeRate))) return;
        effForm = { ...paymentFormData, apply_additional_profit: true };
        effMeta = computePaymentDifferenceMeta(sale, effForm, cbuRate);
      }

      if (effMeta.differenceNeedsClassification) {
        showNotification(t('completePay.errShortfall'), 'error');
        return;
      }

      const requestData = buildCompleteSaleRequest(effForm, effMeta, exchangeRate);
      if (groupSales?.length) {
        const requests = buildGroupCompleteRequests(groupSales, effForm, effMeta, exchangeRate);
        for (const req of requests) {
          await api.post(`/sales/${req.id}/update_status/`, req.data);
        }
        showNotification(t('completePay.successGroup', { count: groupSales.length }), 'success');
      } else {
        await api.post(`/sales/${sale.id}/update_status/`, requestData);
        showNotification(t('completePay.success'), 'success');
      }
      onSuccess?.();
      onClose?.();
    } catch (error) {
      console.error('Error completing sale:', error);
      showNotification(error.response?.data?.error || t('completePay.errComplete'), 'error');
    }
  };

  const handleCancel = () => {
    setPaymentFormData(emptyPaymentFormState());
    onClose?.();
  };

  return (
    <div className="form-card" style={{ marginBottom: '20px' }}>
      <h2>{t('completePay.title', { id: sale.id })}</h2>
      <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.9em' }}>{t('completePay.intro')}</p>
      {exchangeRate?.label && (
        <p style={{ color: '#4a5568', marginBottom: '12px', fontSize: '0.85em' }}>{exchangeRate.label}</p>
      )}
      {exchangeRateError && (
        <p style={{ color: '#b45309', marginBottom: '12px', fontSize: '0.85em' }}>{exchangeRateError}</p>
      )}
      <div
        style={{
          marginBottom: 16,
          padding: '12px 14px',
          background: '#f8f9fa',
          borderRadius: 6,
          fontSize: '0.9em',
          color: '#444',
          lineHeight: 1.5,
        }}
      >
        <div>
          <strong>{t('completePay.listPrice')}</strong> {formatDisplayAmount(listUnit, sc)}{' '}
          {t('completePay.perUnit')}
          {qty > 1 ? ` · ${formatDisplayAmount(listTotal, sc)} ${t('completePay.total')}` : ''}
        </div>
        <div>
          <strong>{t('completePay.discount')}</strong> {formatDisplayAmount(discountAmountPerUnit, sc)}{' '}
          {t('completePay.perUnit')}
          {saleDiscountTotal > 0 && qty > 1
            ? ` · ${formatDisplayAmount(saleDiscountTotal, sc)} ${t('completePay.total')}`
            : ''}
        </div>
        <div>
          <strong>{t('completePay.finalPrice')}</strong> {formatDisplayAmount(finalUnit, sc)}{' '}
          {t('completePay.perUnit')}
        </div>
        <div>
          <strong>{t('completePay.amountDue')}</strong> {formatDisplayAmount(finalDue, sc)}
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          {paymentFormData.prepayment_amount && parseFloat(paymentFormData.prepayment_amount) > 0 && (
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>{t('completePay.prepayment')}</label>
              <input
                type="text"
                value={formatDisplayAmount(
                  paymentFormData.prepayment_amount,
                  paymentFormData.prepayment_currency || sc,
                )}
                readOnly
                style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
              />
              <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                {t('completePay.prepaymentHint')}
              </small>
            </div>
          )}
          <div className="form-group">
            <label>{t('currency.uzs', { ns: 'common' })}</label>
            <AmountInput
              placeholder="0"
              value={paymentFormData.uzs ?? ''}
              onChange={(e) => setPaymentFormData({ ...paymentFormData, uzs: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>{t('currency.usd', { ns: 'common' })}</label>
            <AmountInput
              placeholder="0"
              value={paymentFormData.usd ?? ''}
              onChange={(e) => setPaymentFormData({ ...paymentFormData, usd: e.target.value })}
            />
          </div>

          {shortfallMeta.due != null && !Number.isNaN(shortfallMeta.due) && (
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <p style={{ margin: 0, fontSize: '0.9em', color: '#444' }}>
                <strong>{t('completePay.amountDueAfterPrepay')}</strong>{' '}
                {shortfallMeta.sc === 'UZS'
                  ? `${shortfallMeta.due.toLocaleString(undefined, { maximumFractionDigits: 0 })} UZS`
                  : `${shortfallMeta.due.toFixed(2)} USD`}
                {saleHasOrderAdvance(sale) && (
                  <>
                    {' '}
                    {t('completePay.maxInCurrency', {
                      currency: shortfallMeta.sc,
                      other: shortfallMeta.sc === 'USD' ? 'UZS' : 'USD',
                    })}
                  </>
                )}
                {shortfallMeta.paid != null &&
                (parseFloat(paymentFormData.uzs) || parseFloat(paymentFormData.usd)) ? (
                  <>
                    {' '}
                    ·{' '}
                    <strong>
                      {shortfallMeta.splitCurrency || shortfallMeta.crossCurrency
                        ? t('completePay.totalAtCbuIn', { currency: shortfallMeta.sc })
                        : t('completePay.enteredIn', { currency: shortfallMeta.sc })}
                    </strong>{' '}
                    {shortfallMeta.sc === 'UZS'
                      ? shortfallMeta.paid.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      : shortfallMeta.paid.toFixed(2)}{' '}
                    {shortfallMeta.sc === 'UZS' ? 'UZS' : 'USD'}
                  </>
                ) : null}
              </p>
            </div>
          )}
          {changeAvailable && (
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <SaleChangeFields
                form={paymentFormData}
                setForm={setPaymentFormData}
                sc={shortfallMeta.sc}
                required={shortfallMeta.requiredChange}
                cbuRate={cbuRate}
                t={t}
              />
            </div>
          )}
          {shortfallMeta.needs && (
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '0.9em', color: '#555', lineHeight: 1.45 }}>
                {t('completePay.shortfallHint')}
              </p>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={paymentFormData.balance_shortfall_type === 'discount'}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    const defaultDisc =
                      shortfallMeta.short != null && shortfallMeta.short > 0
                        ? (shortfallMeta.sc === 'UZS'
                          ? String(Math.round(shortfallMeta.short))
                          : shortfallMeta.short.toFixed(2))
                        : '';
                    setPaymentFormData({
                      ...paymentFormData,
                      balance_shortfall_type: checked ? 'discount' : '',
                      balance_shortfall_amount: checked
                        ? (paymentFormData.balance_shortfall_amount || defaultDisc)
                        : '',
                    });
                  }}
                />
                <span>{t('completePay.discountOption')}</span>
              </label>
              {paymentFormData.balance_shortfall_type === 'discount' && (
                <div style={{ marginTop: 10, maxWidth: 280 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9em' }}>
                    {t('completePay.discountAmountLabel', { currency: shortfallMeta.sc })}
                  </label>
                  <AmountInput
                    step={shortfallMeta.sc === 'UZS' ? '1' : '0.01'}
                    value={paymentFormData.balance_shortfall_amount ?? ''}
                    onChange={(e) =>
                      setPaymentFormData({
                        ...paymentFormData,
                        balance_shortfall_amount: e.target.value,
                      })
                    }
                  />
                </div>
              )}
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  marginTop: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!paymentFormData.apply_currency_conversion_difference}
                  onChange={(e) =>
                    setPaymentFormData({
                      ...paymentFormData,
                      apply_currency_conversion_difference: e.target.checked,
                    })
                  }
                />
                <span>{t('completePay.conversionDifferenceOption')}</span>
              </label>
              {paymentFormData.apply_currency_conversion_difference
                && shortfallMeta.remainingAfterDiscount != null && (
                <p style={{ margin: '8px 0 0', fontSize: '0.85em', color: '#555' }}>
                  {t('completePay.conversionDifferenceValue', {
                    amount:
                      shortfallMeta.sc === 'UZS'
                        ? Math.round(shortfallMeta.remainingAfterDiscount).toLocaleString()
                        : shortfallMeta.remainingAfterDiscount.toFixed(2),
                    currency: shortfallMeta.sc,
                  })}
                </p>
              )}
            </div>
          )}

          {paymentFormData.dispatch_payment_needed && (
            <>
              <div
                className="form-group"
                style={{ gridColumn: '1 / -1', marginTop: '20px', paddingTop: '20px', borderTop: '2px solid #e0e0e0' }}
              >
                <h3 style={{ margin: '0 0 12px 0', color: '#333' }}>{t('completePay.dispatchPayment')}</h3>
              </div>
              <div className="form-group">
                <label>
                  {t('completePay.dispatchAmount', {
                    currency: paymentFormData.dispatch_payment_currency,
                  })}
                </label>
                <AmountInput
                  value={paymentFormData.dispatch_payment_amount ?? ''}
                  onChange={(e) =>
                    setPaymentFormData({ ...paymentFormData, dispatch_payment_amount: e.target.value })
                  }
                  required={paymentFormData.dispatch_payment_needed}
                />
              </div>
              <div className="form-group">
                <label>{t('completePay.dispatchCurrency')}</label>
                <select
                  value={paymentFormData.dispatch_payment_currency || 'UZS'}
                  onChange={(e) =>
                    setPaymentFormData({ ...paymentFormData, dispatch_payment_currency: e.target.value })
                  }
                  required={paymentFormData.dispatch_payment_needed}
                >
                  <option value="USD">{t('currency.usd', { ns: 'common' })}</option>
                  <option value="UZS">{t('currency.uzs', { ns: 'common' })}</option>
                </select>
              </div>
            </>
          )}

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('completePay.notes')}</label>
            <textarea
              rows={3}
              value={paymentFormData.completion_notes ?? ''}
              onChange={(e) => setPaymentFormData({ ...paymentFormData, completion_notes: e.target.value })}
            />
            <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
              {shortfallMeta.needs ? t('completePay.notesDiscountHint') : t('completePay.notesOptional')}
            </small>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-primary">
            {t('completeSale')}
          </button>
          <button type="button" className="btn-edit" onClick={handleCancel}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
        </div>
      </form>
    </div>
  );
}
