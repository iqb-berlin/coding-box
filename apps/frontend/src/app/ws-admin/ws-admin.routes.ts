import { Routes } from '@angular/router';
import { canActivateAuth } from '../auth/guards/auth.guard';

export const wsAdminRoutes: Routes = [
  {
    path: 'workspace-admin/:ws',
    canActivate: [canActivateAuth],
    loadComponent: () => import('./components/ws-admin/ws-admin.component').then(m => m.WsAdminComponent),
    children: [
      { path: '', redirectTo: 'test-files', pathMatch: 'full' },
      { path: 'test-files', loadComponent: () => import('./components/test-files/test-files.component').then(m => m.TestFilesComponent) },
      { path: 'test-results', loadComponent: () => import('./components/test-groups/test-groups.component').then(m => m.TestGroupsComponent) },
      { path: 'users', loadComponent: () => import('./components/ws-users/ws-users.component').then(m => m.WsUsersComponent) },
      { path: 'coding', loadComponent: () => import('../coding/coding-managment/coding-management.component').then(m => m.CodingManagementComponent) },
      { path: 'settings', loadComponent: () => import('./components/ws-settings/ws-settings.component').then(m => m.WsSettingsComponent) },
      { path: '**', loadComponent: () => import('./components/test-files/test-files.component').then(m => m.TestFilesComponent) }
    ]
  }
];
