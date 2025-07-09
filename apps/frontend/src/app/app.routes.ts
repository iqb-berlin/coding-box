import { Routes } from '@angular/router';
import { replayRoutes } from './replay/replay.routes';
import { sysAdminRoutes } from './sys-admin/sys-admin.routes';
import { wsAdminRoutes } from './ws-admin/ws-admin.routes';
import { codingRoutes } from './coding/coding.routes';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  {
    path: 'home',
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent)
  },
  ...replayRoutes,
  ...codingRoutes,
  ...sysAdminRoutes,
  ...wsAdminRoutes,
  { path: '**', loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent) }
];
