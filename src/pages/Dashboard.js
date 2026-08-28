import React from 'react';
import { usePermissions } from '../hooks/usePermissions';
import DashboardModern from './DashboardModern';
import DashboardLegacy from './DashboardLegacy';

/**
 * Which dashboard a role is shown.
 *
 * Not `isAdmin`: the Investor is entitled to the same picture the owner reads — that is the whole
 * point of the role — and keying this off "who runs the place" quietly handed them the older,
 * thinner one. `seesFullDashboard` asks the question this switch actually cares about.
 *
 * What is *inside* the modern dashboard stays gated on `dashboard.ceo`, so this changes which
 * page loads, never who may see what on it.
 */
const Dashboard = () => {
  const { seesFullDashboard } = usePermissions();
  return seesFullDashboard ? <DashboardModern /> : <DashboardLegacy />;
};

export default Dashboard;
