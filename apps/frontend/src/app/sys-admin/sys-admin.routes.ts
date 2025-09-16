import { Routes } from '@angular/router';
import { canActivateAdmin } from '../core/guards/admin.guard';

export const sysAdminRoutes: Routes = [
  {
    path: 'admin',
    canActivate: [canActivateAdmin],
    loadComponent: () => import('./components/admin/admin.component').then(m => m.AdminComponent),
    children: [
      { path: '', redirectTo: 'users', pathMatch: 'full' },
      { path: 'users', loadComponent: () => import('./components/users/users.component').then(m => m.UsersComponent) },
      { path: 'settings', loadComponent: () => import('./components/sys-admin-settings/sys-admin-settings.component').then(m => m.SysAdminSettingsComponent) },
      { path: 'workspaces', loadComponent: () => import('./components/workspaces/workspaces.component').then(m => m.WorkspacesComponent) },
      { path: 'workspace/:ws', loadComponent: () => import('./components/workspaces/workspaces.component').then(m => m.WorkspacesComponent) },
      { path: '**', loadComponent: () => import('./components/users/users.component').then(m => m.UsersComponent) }
    ]
  }
];
