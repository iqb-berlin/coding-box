import { Routes } from '@angular/router';
import { ReplayComponent } from './components/replay/replay.component';
import { HomeComponent } from './components/home/home.component';
import { AdminComponent } from './components/admin/components/admin/admin.component';
import { UsersComponent } from './components/admin/components/users/users.component';
import { WorkspacesComponent } from './components/admin/components/workspaces/workspaces.component';
import { WsAdminComponent } from './components/ws-admin/ws-admin/ws-admin.component';
import { FileUploadComponent } from './components/ws-admin/file-upload/file-upload.component';
import { TestPersonsComponent } from './components/ws-admin/test-persons/test-persons.component';
import { SelectReplayComponent } from './components/ws-admin/select-replay/select-replay.component';

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
      { path: 'workspaces', component: WorkspacesComponent },
      { path: 'workspace/:ws', component: WorkspacesComponent },
      { path: '**', component: UsersComponent }]
  }, {
    path: 'workspace-admin',
    component: WsAdminComponent,
    children: [
      { path: '', redirectTo: 'test-files', pathMatch: 'full' },
      { path: 'select-replay', component: SelectReplayComponent },
      { path: 'test-files', component: FileUploadComponent },
      { path: 'test-persons', component: TestPersonsComponent },
      { path: 'users', component: UsersComponent },
      { path: '**', component: UsersComponent }
    ]
  }
];
