import { Routes } from '@angular/router';
import { canActivateAuth } from '../core/guards/auth.guard';
import { canActivateAccessLevel } from '../core/guards/access-level.guard';

export const wsAdminRoutes: Routes = [
  {
    path: 'workspace-admin/:ws',
    canActivate: [canActivateAuth, canActivateAccessLevel(1)],
    loadComponent: () => import('./components/ws-admin/ws-admin.component').then(m => m.WsAdminComponent),
    children: [
      { path: '', redirectTo: 'coding', pathMatch: 'full' },
      {
        path: 'test-files',
        loadComponent: () => import('./components/test-files/test-files.component').then(m => m.TestFilesComponent)
      },
      {
        path: 'test-results',
        loadComponent: () => import('./components/test-groups/test-groups.component').then(m => m.TestGroupsComponent)
      },
      {
        path: 'users',
        loadComponent: () => import('./components/ws-users/ws-users.component').then(m => m.WsUsersComponent)
      },
      {
        path: 'coding',
        children: [
          { path: '', redirectTo: 'management', pathMatch: 'full' },
          {
            path: 'management',
            loadComponent: () => import('../coding/components/coding-management/coding-management.component').then(m => m.CodingManagementComponent)
          },
          {
            path: 'my-jobs',
            loadComponent: () => import('../coding/components/my-coding-jobs/my-coding-jobs.component').then(m => m.MyCodingJobsComponent)
          }
        ]
      },
      {
        path: 'cleaning',
        loadComponent: () => import('./components/cleaning/cleaning.component').then(m => m.CleaningComponent)
      },
      {
        path: 'export',
        loadComponent: () => import('./components/export/export.component').then(m => m.ExportComponent)
      },
      {
        path: 'settings',
        loadComponent: () => import('./components/ws-settings/ws-settings.component').then(m => m.WsSettingsComponent)
      },
      { path: '**', redirectTo: 'coding' }
    ]
  }
];
