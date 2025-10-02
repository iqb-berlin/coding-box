import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const canActivateAdmin: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isLoggedIn()) {
    authService.login();
    return false;
  }

  const userRoles = authService.getRoles();
  const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
  const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase())
  );

  if (!hasAdminRole) {
    // Redirect to unauthorized page or home
    router.navigate(['/']);
    return false;
  }

  return true;
};
