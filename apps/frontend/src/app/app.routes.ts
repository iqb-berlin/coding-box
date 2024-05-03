import { Routes } from '@angular/router';
import { ReplayComponent } from './components/replay/replay.component';
import { HomeComponent } from './components/home/home.component';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'replay', component: ReplayComponent },
];
