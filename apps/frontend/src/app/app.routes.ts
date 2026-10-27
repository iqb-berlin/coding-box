import { Routes } from '@angular/router';
import { pageTitle } from './core/page-title.resolver';
import { replayRoutes } from './replay/replay.routes';
import { sysAdminRoutes } from './sys-admin/sys-admin.routes';
import { wsAdminRoutes } from './ws-admin/ws-admin.routes';
import { codingRoutes } from './coding/coding.routes';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  {
    path: 'home',
    title: pageTitle('home'),
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent)
  },
  ...replayRoutes,
  ...codingRoutes,
  ...sysAdminRoutes,
  ...wsAdminRoutes,
  { path: '**', title: pageTitle('home'), loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent) }
];
