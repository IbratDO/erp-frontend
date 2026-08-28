import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  canAccessRoute,
  filterMenuItems,
  getRoleCode,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isCEO,
  isAdmin,
  isInvestor,
  isTargetolog,
  isReadOnly,
  seesFullDashboard,
} from '../utils/permissions';

export function usePermissions() {
  const { user, refreshUser } = useAuth();

  return useMemo(
    () => ({
      user,
      refreshUser,
      roleCode: getRoleCode(user),
      isCEO: isCEO(user),
      isAdmin: isAdmin(user),
      isInvestor: isInvestor(user),
      isTargetolog: isTargetolog(user),
      isReadOnly: isReadOnly(user),
      seesFullDashboard: seesFullDashboard(user),
      hasPermission: (code) => hasPermission(user, code),
      hasAnyPermission: (codes) => hasAnyPermission(user, codes),
      hasAllPermissions: (codes) => hasAllPermissions(user, codes),
      canAccessRoute: (path) => canAccessRoute(user, path),
      menuItems: filterMenuItems(user),
    }),
    [user, refreshUser]
  );
}

export default usePermissions;
