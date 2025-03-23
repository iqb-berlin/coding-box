import { Routes } from '@angular/router';
import { ReplayComponent } from './replay/components/replay/replay.component';
import { HomeComponent } from './components/home/home.component';
import { AdminComponent } from './sys-admin/components/admin/admin.component';
import { UsersComponent } from './sys-admin/components/users/users.component';
import { WorkspacesComponent } from './sys-admin/components/workspaces/workspaces.component';
import { WsAdminComponent } from './ws-admin/components/ws-admin/ws-admin.component';
import { SelectReplayComponent } from './ws-admin/components/select-replay/select-replay.component';
import { TestFilesComponent } from './ws-admin/components/test-files/test-files.component';
import { WsSettingsComponent } from './ws-admin/components/ws-settings/ws-settings.component';
import { SysAdminSettingsComponent } from './sys-admin/components/sys-admin-settings/sys-admin-settings.component';
import { TestGroupsComponent } from './ws-admin/components/test-groups/test-groups.component';
import { WsUsersComponent } from './ws-admin/components/ws-users/ws-users.component';
import { CodingManagementComponent } from './coding/coding-managment/coding-management.component';
import { CodingManagementManualComponent } from './coding/coding-management-manual/coding-management-manual.component';
import { canActivateAuthRole } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  {
    path: 'home',
    component: HomeComponent
  },
  {
    path: 'replay/:testPerson/:unitId/:page',
    canActivate: [canActivateAuthRole],
    component: ReplayComponent
  },
  {
    path: 'replay/:testPerson/:unitId',
    canActivate: [canActivateAuthRole],
    component: ReplayComponent
  },
  { path: 'replay/:testPerson', canActivate: [canActivateAuthRole], component: ReplayComponent },
  { path: 'replay', canActivate: [canActivateAuthRole], component: ReplayComponent },
  { path: 'coding-manual', canActivate: [canActivateAuthRole], component: CodingManagementManualComponent },
  {
    path: 'admin',
    canActivate: [canActivateAuthRole],
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
    canActivate: [canActivateAuthRole],
    component: WsAdminComponent,
    children: [
      { path: '', redirectTo: 'select-unit-play', pathMatch: 'full' },
      { path: 'select-unit-play', component: SelectReplayComponent },
      { path: 'test-files', component: TestFilesComponent },
      { path: 'test-groups', component: TestGroupsComponent },
      { path: 'users', component: WsUsersComponent },
      { path: 'coding', component: CodingManagementComponent },
      { path: 'settings', component: WsSettingsComponent },
      { path: '**', component: SelectReplayComponent }
    ]
  },
  { path: '**', component: HomeComponent }
];
