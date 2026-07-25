import React from 'react';
import { usePermissions } from '../hooks/usePermissions';
import useAppTranslation from '../hooks/useAppTranslation';
import {
  groupSettlementActiveStep,
  groupHasPendingDeclinedReturns,
  lineNeedsSettlement,
  shopDeliverySettlementRequiredForGroup,
  shopDeliverySettlementStep3Label,
} from '../utils/saleCompletePayHelpers';

/**
 * One settlement control at a time: only the current step's button is shown; earlier steps disappear
 * from the row after they are recorded (sale data advances to the next timestamp).
 * Group-aware: computes the active step across every still-open line in the delivery group, and
 * keeps showing a button when any line has a declined item awaiting physical-return confirmation.
 */
export default function ShopDeliverySettlementButtons({
  sale,
  groupSales = null,
  onOpenSettlement,
  classNameButton = 'btn-status',
}) {
  const { t } = useAppTranslation('sales');
  const { hasAnyPermission, hasPermission } = usePermissions();
  const canShopRemittance = hasPermission('sales.delivery_shop_received');
  const canPayDispatchFee = hasAnyPermission([
    'sales.delivery_pay_dispatch_fee',
    'sales.complete_pay',
  ]);
  const canConfirmReturn = hasPermission('sales.delivery_confirm_return');

  const lines = groupSales?.length ? groupSales : [sale];
  const saleOrGroup = groupSales?.length ? { groupSales: lines } : sale;
  if (!shopDeliverySettlementRequiredForGroup(saleOrGroup)) return null;

  const step = groupSettlementActiveStep(lines);
  const hasPendingReturns = groupHasPendingDeclinedReturns(lines);

  const statusSpanStyle = { fontSize: '0.82rem', lineHeight: 1.3 };

  const open = () => {
    if (sale?.id) onOpenSettlement(sale.id, groupSales);
  };

  const btnProps = {
    type: 'button',
    className: classNameButton,
    onClick: open,
    style: {
      fontSize: '0.82rem',
      lineHeight: 1.2,
      whiteSpace: 'normal',
      textAlign: 'left',
    },
  };

  if (!step) {
    if (hasPendingReturns) {
      if (!canConfirmReturn) {
        return (
          <span style={{ ...statusSpanStyle, color: '#b45309' }}>
            {t('deliverySettlement.returnPendingNoPerm')}
          </span>
        );
      }
      return <button {...btnProps}>{t('deliverySettlement.btnConfirmReturn')}</button>;
    }
    return (
      <span style={{ ...statusSpanStyle, color: '#059669' }}>
        {t('deliverySettlement.settlementFinished')}
      </span>
    );
  }

  if (step === 3 && !canPayDispatchFee) {
    return (
      <span style={{ ...statusSpanStyle, color: '#64748b' }}>
        {t('deliverySettlement.awaitingShopFee')}
      </span>
    );
  }

  if (step === 1) {
    return <button {...btnProps}>{t('deliverySettlement.btnStep1')}</button>;
  }
  if (step === 2) {
    if (!canShopRemittance) {
      return (
        <span style={{ ...statusSpanStyle, color: '#64748b' }}>
          {t('deliverySettlement.awaitingShopRemittance')}
        </span>
      );
    }
    return <button {...btnProps}>{t('deliverySettlement.btnStep2')}</button>;
  }
  const step3Line = lines.find((l) => lineNeedsSettlement(l) && l && l.delivery_shop_remittance_at) || sale;
  return <button {...btnProps}>{shopDeliverySettlementStep3Label(step3Line)}</button>;
}
