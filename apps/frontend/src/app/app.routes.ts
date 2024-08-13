import { Routes } from '@angular/router';
import { ReplayComponent } from './replay/components/replay/replay.component';
import { HomeComponent } from './components/home/home.component';
import { AdminComponent } from './sys-admin/components/admin/admin.component';
import { UsersComponent } from './sys-admin/components/users/users.component';
import { WorkspacesComponent } from './sys-admin/components/workspaces/workspaces.component';
import { WsAdminComponent } from './ws-admin/ws-admin/ws-admin.component';
import { SelectReplayComponent } from './ws-admin/select-replay/select-replay.component';
import { TestFilesComponent } from './ws-admin/test-files/test-files.component';
import { WsSettingsComponent } from './ws-admin/ws-settings/ws-settings.component';
import { SysAdminSettingsComponent } from './sys-admin/components/sys-admin-settings/sys-admin-settings.component';
import { TestGroupsComponent } from './ws-admin/test-groups/test-groups.component';
import { WsUsersComponent } from './ws-admin/ws-users/ws-users.component';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'replay/:testPerson/:unitId/:page', component: ReplayComponent },
  { path: 'replay/:testPerson/:unitId', component: ReplayComponent },
  { path: 'replay/:testPerson', component: ReplayComponent },
  { path: 'replay', component: ReplayComponent },
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
      { path: '', redirectTo: 'select-unit-play', pathMatch: 'full' },
      { path: 'select-unit-play', component: SelectReplayComponent },
      { path: 'test-files', component: TestFilesComponent },
      { path: 'test-groups', component: TestGroupsComponent },
      { path: 'users', component: WsUsersComponent },
      { path: 'settings', component: WsSettingsComponent },
      { path: '**', component: SelectReplayComponent }
    ]
  },
  { path: '**', component: HomeComponent }
];
