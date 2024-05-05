import { Routes } from '@angular/router';
import { ReplayComponent } from './components/replay/replay.component';
import { HomeComponent } from './components/home/home.component';
import { AdminComponent } from './components/admin/admin/admin.component';
import { UsersComponent } from './components/admin/users/users.component';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  { path: 'home', component: HomeComponent },
  { path: 'replay', component: ReplayComponent },
  {
    path: 'admin',
    component: AdminComponent,
    children: [
      { path: '', redirectTo: 'users', pathMatch: 'full' },
      { path: 'users', component: UsersComponent },
      { path: '**', component: UsersComponent }]
  }
];
