import { Routes } from '@angular/router';
import { canActivateAuth } from '../core/guards/auth.guard';
import { canActivateAccessLevel, canActivateCodingJobs } from '../core/guards/access-level.guard';

export const wsAdminRoutes: Routes = [
  {
    path: 'workspace-admin/:ws',
    canActivate: [canActivateAuth, canActivateAccessLevel(1)],
    loadComponent: () => import('./components/ws-admin/ws-admin.component').then(m => m.WsAdminComponent),
    children: [
      { path: '', redirectTo: 'coding', pathMatch: 'full' },
      {
        path: 'test-files',
        canActivate: [canActivateAccessLevel(3)],
        loadComponent: () => import('./components/test-files/test-files.component').then(m => m.TestFilesComponent)
      },
      {
        path: 'test-results',
        canActivate: [canActivateAccessLevel(3)],
        loadComponent: () => import('./components/test-groups/test-groups.component').then(m => m.TestGroupsComponent)
      },
      {
        path: 'users',
        canActivate: [canActivateAccessLevel(3)],
        loadComponent: () => import('./components/ws-users/ws-users.component').then(m => m.WsUsersComponent)
      },
      {
        path: 'coding',
        children: [
          { path: '', redirectTo: 'management', pathMatch: 'full' },
          {
            path: 'management',
            canActivate: [canActivateAccessLevel(2)],
            loadComponent: () => import('../coding/components/coding-management/coding-management.component').then(m => m.CodingManagementComponent)
          },
          {
            path: 'my-jobs',
            canActivate: [canActivateCodingJobs()],
            loadComponent: () => import('../coding/components/my-coding-jobs/my-coding-jobs.component').then(m => m.MyCodingJobsComponent)
          },
          {
            path: 'statistics',
            canActivate: [canActivateAccessLevel(2)],
            loadComponent: () => import('../coding/components/coding-statistics-view/coding-statistics-view.component').then(m => m.CodingStatisticsViewComponent)
          },
          {
            path: 'manual',
            canActivate: [canActivateAccessLevel(2)],
            loadComponent: () => import('../coding/components/coding-management-manual/coding-management-manual.component').then(m => m.CodingManagementManualComponent)
          },
          {
            path: 'export',
            canActivate: [canActivateAccessLevel(2)],
            loadComponent: () => import('./components/export/export.component').then(m => m.ExportComponent)
          }
        ]
      },
      {
        path: 'cleaning',
        canActivate: [canActivateAccessLevel(3)],
        loadComponent: () => import('./components/cleaning/cleaning.component').then(m => m.CleaningComponent)
      },
      {
        path: 'export',
        canActivate: [canActivateAccessLevel(3)],
        loadComponent: () => import('./components/export/export.component').then(m => m.ExportComponent)
      },
      {
        path: 'settings',
        canActivate: [canActivateAccessLevel(3)],
        loadComponent: () => import('./components/ws-settings/ws-settings.component').then(m => m.WsSettingsComponent)
      },
      { path: '**', redirectTo: 'coding' }
    ]
  }
];
