import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const canActivateAuth: CanActivateFn = () => {
  const authService = inject(AuthService);

  // If user is logged in with valid token, allow access
  if (authService.isLoggedIn()) {
    return true;
  }

  // No valid token, redirect to login
  authService.login();
  return false;
};
