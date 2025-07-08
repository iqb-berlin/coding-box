import { Routes } from '@angular/router';
import { canActivateAuth } from '../auth/guards/auth.guard';

export const codingRoutes: Routes = [
  {
    path: 'coding-manual',
    canActivate: [canActivateAuth],
    loadComponent: () => import('./coding-management-manual/coding-management-manual.component').then(m => m.CodingManagementManualComponent)
  }
];
