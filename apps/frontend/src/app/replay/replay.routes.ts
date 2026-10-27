import { Routes } from '@angular/router';
import { pageTitle } from '../core/page-title.resolver';

export const replayRoutes: Routes = [
  {
    path: 'replay/:testPerson/:unitId/:page/:anchor',
    title: pageTitle('replay'),
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay/:testPerson/:unitId/:page',
    title: pageTitle('replay'),
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay/:testPerson/:unitId',
    title: pageTitle('replay'),
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'print-view/:unitId',
    title: pageTitle('replay'),
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay/:testPerson',
    title: pageTitle('replay'),
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay',
    title: pageTitle('replay'),
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  }
];
