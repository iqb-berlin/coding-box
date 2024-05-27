import { Routes } from '@angular/router';
import { ReplayComponent } from './replay/components/replay/replay.component';
import { HomeComponent } from './components/home/home.component';
import { AdminComponent } from './sys-admin/components/admin/admin.component';
import { UsersComponent } from './sys-admin/components/users/users.component';
import { WorkspacesComponent } from './sys-admin/components/workspaces/workspaces.component';
import { WsAdminComponent } from './ws-admin/ws-admin/ws-admin.component';
import { SelectReplayComponent } from './ws-admin/select-replay/select-replay.component';
import { FileUploadComponent } from './ws-admin/file-upload/file-upload.component';
import { TestPersonsComponent } from './ws-admin/test-persons/test-persons.component';
import { WsSettingsComponent } from './ws-admin/ws-settings/ws-settings.component';
import { SysAdminSettingsComponent } from './sys-admin/components/sys-admin-settings/sys-admin-settings.component';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'replay/:testPerson/:unitId/:page', component: ReplayComponent },
  {
    path: 'admin',
    component: AdminComponent,
    children: [
      { path: '', redirectTo: 'users', pathMatch: 'full' },
      { path: 'users', component: UsersComponent },
      { path: 'settings', component: SysAdminSettingsComponent },
      { path: 'workspaces', component: WorkspacesComponent },
      { path: 'workspace/:ws', component: WorkspacesComponent },
      { path: '**', component: UsersComponent }]
  }, {
    path: 'workspace-admin/:ws',
    component: WsAdminComponent,
    children: [
      { path: '', redirectTo: 'test-files', pathMatch: 'full' },
      { path: 'select-replay', component: SelectReplayComponent },
      { path: 'test-files', component: FileUploadComponent },
      { path: 'test-persons', component: TestPersonsComponent },
      { path: 'users', component: UsersComponent },
      { path: 'settings', component: WsSettingsComponent },
      { path: '**', component: SelectReplayComponent }
    ]
  },
  { path: '**', component: HomeComponent }
];
