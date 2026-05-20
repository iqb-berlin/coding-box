import { Routes } from '@angular/router';
import { canActivateAuth } from '../core/guards/auth.guard';
import { canActivatePersonalCodingJobs } from '../core/guards/personal-coding-jobs.guard';

export const codingRoutes: Routes = [
  {
    path: 'coding-manual',
    canActivate: [canActivateAuth],
    loadComponent: () => import('./components/coding-management-manual/coding-management-manual.component').then(m => m.CodingManagementManualComponent)
  },
  {
    path: 'test-person-coding/:workspace_id',
    canActivate: [canActivateAuth],
    loadComponent: () => import('./components/test-person-coding/test-person-coding.component').then(m => m.TestPersonCodingComponent)
  },
  {
    path: 'coding',
    canActivate: [canActivatePersonalCodingJobs],
    loadComponent: () => import('./components/my-coding-jobs/my-coding-jobs.component').then(m => m.MyCodingJobsComponent)
  }
];
