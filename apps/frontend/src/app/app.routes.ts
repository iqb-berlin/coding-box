import { Routes } from '@angular/router';

import { canActivateAuth } from './auth/auth.guard';
import { canActivateWithToken } from './auth/token.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  {
    path: 'home',
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'replay/:testPerson/:unitId/:page/:anchor',
    canActivate: [canActivateWithToken],
    loadComponent: () => import('./replay/components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay/:testPerson/:unitId/:page',
    canActivate: [canActivateWithToken],
    loadComponent: () => import('./replay/components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay/:testPerson/:unitId',
    canActivate: [canActivateAuth],
    loadComponent: () => import('./replay/components/replay/replay.component').then(m => m.ReplayComponent)
  },
  { path: 'print-view/:unitId', canActivate: [canActivateWithToken], loadComponent: () => import('./replay/components/replay/replay.component').then(m => m.ReplayComponent) },
  { path: 'replay/:testPerson', canActivate: [canActivateWithToken], loadComponent: () => import('./replay/components/replay/replay.component').then(m => m.ReplayComponent) },
  { path: 'replay', canActivate: [canActivateWithToken], loadComponent: () => import('./replay/components/replay/replay.component').then(m => m.ReplayComponent) },
  { path: 'coding-manual', canActivate: [canActivateAuth], loadComponent: () => import('./coding/coding-management-manual/coding-management-manual.component').then(m => m.CodingManagementManualComponent) },
  {
    path: 'admin',
    canActivate: [canActivateAuth],
    loadComponent: () => import('./sys-admin/components/admin/admin.component').then(m => m.AdminComponent),
    children: [
      { path: '', redirectTo: 'users', pathMatch: 'full' },
      { path: 'users', loadComponent: () => import('./sys-admin/components/users/users.component').then(m => m.UsersComponent) },
      { path: 'settings', loadComponent: () => import('./sys-admin/components/sys-admin-settings/sys-admin-settings.component').then(m => m.SysAdminSettingsComponent) },
      { path: 'workspaces', loadComponent: () => import('./sys-admin/components/workspaces/workspaces.component').then(m => m.WorkspacesComponent) },
      { path: 'workspace/:ws', loadComponent: () => import('./sys-admin/components/workspaces/workspaces.component').then(m => m.WorkspacesComponent) },
      { path: '**', loadComponent: () => import('./sys-admin/components/users/users.component').then(m => m.UsersComponent) }]
  }, {
    path: 'workspace-admin/:ws',
    canActivate: [canActivateAuth],
    loadComponent: () => import('./ws-admin/components/ws-admin/ws-admin.component').then(m => m.WsAdminComponent),
    children: [
      { path: '', redirectTo: 'test-files', pathMatch: 'full' },
      { path: 'test-files', loadComponent: () => import('./ws-admin/components/test-files/test-files.component').then(m => m.TestFilesComponent) },
      { path: 'test-results', loadComponent: () => import('./ws-admin/components/test-groups/test-groups.component').then(m => m.TestGroupsComponent) },
      { path: 'users', loadComponent: () => import('./ws-admin/components/ws-users/ws-users.component').then(m => m.WsUsersComponent) },
      { path: 'coding', loadComponent: () => import('./coding/coding-managment/coding-management.component').then(m => m.CodingManagementComponent) },
      { path: 'settings', loadComponent: () => import('./ws-admin/components/ws-settings/ws-settings.component').then(m => m.WsSettingsComponent) },
      { path: '**', loadComponent: () => import('./ws-admin/components/test-files/test-files.component').then(m => m.TestFilesComponent) }
    ]
  },
  { path: '**', loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent) }
];
