import { Routes } from '@angular/router';

export const replayRoutes: Routes = [
  {
    path: 'replay/:testPerson/:unitId/:page/:anchor',
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay/:testPerson/:unitId/:page',
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay/:testPerson/:unitId',
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'print-view/:unitId',
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay/:testPerson',
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  },
  {
    path: 'replay',
    loadComponent: () => import('./components/replay/replay.component').then(m => m.ReplayComponent)
  }
];
