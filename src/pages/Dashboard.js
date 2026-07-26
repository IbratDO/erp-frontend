import React from 'react';
import { usePermissions } from '../hooks/usePermissions';
import DashboardModern from './DashboardModern';
import DashboardLegacy from './DashboardLegacy';

const Dashboard = () => {
  const { isAdmin } = usePermissions();
  return isAdmin ? <DashboardModern /> : <DashboardLegacy />;
};

export default Dashboard;
