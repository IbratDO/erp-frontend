import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api';
import useCbuExchangeRate from '../hooks/useCbuExchangeRate';
import useAppTranslation from '../hooks/useAppTranslation';
import { usdToUzs, uzsToUsd } from '../utils/saleCompletePayHelpers';
import AmountInput from './AmountInput';
import BusyForm, { SubmitButton } from './BusyForm';

const PL_TOLERANCE_USD = 0.005;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function computeConversionPreview(direction, sourceAmount, targetAmount, rate) {
  if (!sourceAmount || !rate || rate <= 0) return null;
  let expected;
  let plUsd;
  if (direction === 'usd_to_uzs') {
    expected = usdToUzs(sourceAmount, rate);
    const actual = targetAmount != null && targetAmount > 0 ? targetAmount : expected;
    plUsd = uzsToUsd(actual - expected, rate);
  } else {
    expected = uzsToUsd(sourceAmount, rate);
    const actual = targetAmount != null && targetAmount > 0 ? targetAmount : expected;
    plUsd = actual - expected;
  }
  return {
    source_amount: sourceAmount,
    expected_target_amount: expected,
    target_amount: targetAmount != null && targetAmount > 0 ? targetAmount : expected,
    pl_effect_usd: plUsd,
    has_pl_effect: Math.abs(plUsd) > PL_TOLERANCE_USD,
  };
}

export default function CurrencyConversionForm({ onSuccess, onCancel }) {
  const { t } = useAppTranslation(['moneyBalance', 'common']);
  const { exchangeRate, exchangeRateError, cbuRate: latestCbuRate } = useCbuExchangeRate();
  const [form, setForm] = useState({
    direction: 'usd_to_uzs',
    source_amount: '',
    target_amount: '',
    conversion_date: todayIso(),
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [targetManual, setTargetManual] = useState(false);
  const [rateForDate, setRateForDate] = useState(null);
  const [rateForDateLoading, setRateForDateLoading] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  const effectiveRate = rateForDate?.rate ?? latestCbuRate;
  const rateDateLabel = rateForDate?.rate_date ?? exchangeRate?.rate_date;

  useEffect(() => {
    const convDate = form.conversion_date || todayIso();
    if (!convDate) return undefined;

    if (exchangeRate?.rate_date && convDate === exchangeRate.rate_date) {
      setRateForDate(null);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setRateForDateLoading(true);
      try {
        const res = await api.post('/cash-balance/preview-conversion/', {
          direction: 'usd_to_uzs',
          source_amount: 1,
          conversion_date: convDate,
        });
        if (!cancelled) {
          setRateForDate({
            rate: res.data.cb_rate,
            rate_date: res.data.cb_rate_date,
          });
        }
      } catch {
        if (!cancelled) setRateForDate(null);
      } finally {
        if (!cancelled) setRateForDateLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.conversion_date, exchangeRate?.rate_date]);

  useEffect(() => {
    if (targetManual || !effectiveRate) return;
    const src = parseFloat(form.source_amount);
    if (!src || src <= 0) return;
    const expected =
      form.direction === 'usd_to_uzs'
        ? usdToUzs(src, effectiveRate)
        : uzsToUsd(src, effectiveRate);
    const next = String(expected);
    setForm((f) => (f.target_amount === next ? f : { ...f, target_amount: next }));
  }, [form.direction, form.source_amount, effectiveRate, targetManual]);

  const preview = useMemo(() => {
    const src = parseFloat(form.source_amount);
    const tgt = parseFloat(form.target_amount);
    if (!src || src <= 0 || !effectiveRate) return null;
    return computeConversionPreview(
      form.direction,
      src,
      tgt > 0 ? tgt : undefined,
      effectiveRate,
    );
  }, [form.direction, form.source_amount, form.target_amount, effectiveRate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const src = parseFloat(form.source_amount);
    const tgt = parseFloat(form.target_amount);
    if (!src || src <= 0 || !tgt || tgt <= 0) {
      alert(t('conversion.errAmounts'));
      return;
    }
    if (!effectiveRate) {
      alert(t('conversion.errRate'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/cash-balance/convert-currency/', {
        direction: form.direction,
        source_amount: src,
        target_amount: tgt,
        conversion_date: form.conversion_date || todayIso(),
        notes: form.notes.trim(),
        idempotency_key: idempotencyKey.current,
      });
      onSuccess?.();
    } catch (err) {
      alert(err.response?.data?.error || t('conversion.errFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const srcCur = form.direction === 'usd_to_uzs' ? 'USD' : 'UZS';
  const tgtCur = form.direction === 'usd_to_uzs' ? 'UZS' : 'USD';
  const rateBusy = rateForDateLoading && form.conversion_date !== exchangeRate?.rate_date;

  return (
    <div className="form-card" style={{ marginBottom: '20px' }}>
      <h2>{t('conversion.title')}</h2>
      <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '12px' }}>{t('conversion.intro')}</p>
      {exchangeRateError ? (
        <p style={{ fontSize: '0.85rem', color: '#dc3545', marginBottom: '12px' }}>{exchangeRateError}</p>
      ) : rateBusy ? (
        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '12px' }}>{t('conversion.loadingRate')}</p>
      ) : exchangeRate?.label && !rateForDate ? (
        <p style={{ fontSize: '0.85rem', color: '#0d6efd', marginBottom: '12px' }}>{exchangeRate.label}</p>
      ) : effectiveRate ? (
        <p style={{ fontSize: '0.85rem', color: '#0d6efd', marginBottom: '12px' }}>
          {t('conversion.rateLine', { rate: Number(effectiveRate).toLocaleString() })}
          {rateDateLabel ? ` ${t('conversion.rateAsOf', { date: rateDateLabel })}` : ''}
        </p>
      ) : null}

      <BusyForm onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-group">
            <label>{t('conversion.direction')}</label>
            <select
              value={form.direction}
              onChange={(e) => {
                setTargetManual(false);
                setForm({
                  ...form,
                  direction: e.target.value,
                  source_amount: '',
                  target_amount: '',
                });
              }}
              required
            >
              <option value="usd_to_uzs">{t('conversion.usdToUzs')}</option>
              <option value="uzs_to_usd">{t('conversion.uzsToUsd')}</option>
            </select>
          </div>
          <div className="form-group">
            <label>{t('conversion.conversionDate')}</label>
            <input
              type="date"
              value={form.conversion_date}
              onChange={(e) => setForm({ ...form, conversion_date: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('conversion.sourceAmount', { currency: srcCur })}</label>
            <AmountInput
              step={form.direction === 'usd_to_uzs' ? '0.01' : '1'}
              value={form.source_amount}
              onChange={(e) => {
                setTargetManual(false);
                setForm({ ...form, source_amount: e.target.value });
              }}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('conversion.convertedAmount', { currency: tgtCur })}</label>
            <AmountInput
              step={form.direction === 'usd_to_uzs' ? '1' : '0.01'}
              value={form.target_amount}
              onChange={(e) => {
                setTargetManual(true);
                setForm({ ...form, target_amount: e.target.value });
              }}
              required
            />
            {preview?.expected_target_amount != null ? (
              <small style={{ color: '#666' }}>
                {t('conversion.cbExpected', {
                  amount: Number(preview.expected_target_amount).toLocaleString(),
                  currency: tgtCur,
                })}
              </small>
            ) : null}
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('conversion.notesOptional')}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows="2"
            />
          </div>
        </div>

        {preview?.has_pl_effect ? (
          <p
            style={{
              margin: '12px 0',
              padding: '10px 12px',
              background: preview.pl_effect_usd > 0 ? '#ecfdf5' : '#fef2f2',
              borderRadius: 6,
              fontSize: '0.9rem',
            }}
          >
            {preview.pl_effect_usd > 0 ? t('conversion.profit') : t('conversion.loss')}:{' '}
            <strong>
              $
              {Math.abs(preview.pl_effect_usd).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </strong>{' '}
            {t('conversion.recordedInPl')}
          </p>
        ) : preview?.source_amount ? (
          <p style={{ margin: '12px 0', fontSize: '0.9rem', color: '#666' }}>{t('conversion.noPlEffect')}</p>
        ) : null}

        <div className="form-actions">
          <button type="button" className="btn-edit" onClick={onCancel} disabled={submitting}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <SubmitButton className="btn-primary" disabled={submitting || rateBusy || !effectiveRate}>
            {submitting ? t('conversion.converting') : t('conversion.convert')}
          </SubmitButton>
        </div>
      </BusyForm>
    </div>
  );
}
