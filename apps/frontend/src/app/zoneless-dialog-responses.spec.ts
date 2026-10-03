import { provideZonelessChangeDetection, Type, ProviderToken } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { SERVER_URL } from './injection-tokens';
import { GithubReleasesDialogComponent } from './ws-admin/components/github-releases-dialog/github-releases-dialog.component';
import { ImpressumDialogComponent } from './shared/dialogs/impressum-dialog.component';
import { ItemListDialogComponent } from './shared/dialogs/item-list-dialog/item-list-dialog.component';
import { ResourcePackagesDialogComponent } from './ws-admin/components/resource-packages-dialog/resource-packages-dialog.component';
import { AccessRightsMatrixDialogComponent } from './ws-admin/components/access-rights-matrix-dialog/access-rights-matrix-dialog.component';
import { VariableBundleManagerComponent } from './coding/components/variable-bundle-manager/variable-bundle-manager.component';
import { EditMissingsProfilesDialogComponent } from './coding/components/edit-missings-profiles-dialog/edit-missings-profiles-dialog.component';
import { JournalComponent } from './ws-admin/components/journal/journal.component';
import { UnitDefinitionPlayerDialogComponent } from './ws-admin/components/unit-definition-player-dialog/unit-definition-player-dialog.component';
import { ExportOptionsDialogComponent } from './ws-admin/components/test-results/export-options-dialog.component';
import { UserAccessRightsDialogComponent } from './sys-admin/components/user-access-rights-dialog/user-access-rights-dialog.component';
import { FileService } from './shared/services/file/file.service';
import { SystemSettingsService } from './core/services/system-settings.service';
import { AppService } from './core/services/app.service';
import { ResourcePackageService } from './shared/services/response/resource-package.service';
import { WorkspaceService } from './workspace/services/workspace.service';
import { VariableBundleService } from './coding/services/variable-bundle.service';
import { CodingJobBackendService } from './coding/services/coding-job-backend.service';
import { MissingsProfileService } from './coding/services/missings-profile.service';
import { JournalService } from './core/services/journal.service';
import { TestResultBackendService } from './shared/services/test-result/test-result-backend.service';
import { WorkspaceBackendService } from './workspace/services/workspace-backend.service';
import { UserBackendService } from './shared/services/user/user-backend.service';

interface DialogCase {
  name: string;
  component: Type<unknown>;
  service: ProviderToken<unknown>;
  method: string;
  result: unknown;
}
const cases: DialogCase[] = [
  {
    name: 'github-releases', component: GithubReleasesDialogComponent, service: FileService, method: 'getGithubReleases', result: []
  },
  {
    name: 'impressum', component: ImpressumDialogComponent, service: SystemSettingsService, method: 'getLegalNotice', result: { html: '<p>Current configured notice</p>', isDefault: false }
  },
  {
    name: 'item-list', component: ItemListDialogComponent, service: FileService, method: 'getItemIdsFromMetadata', result: []
  },
  {
    name: 'resource-packages', component: ResourcePackagesDialogComponent, service: ResourcePackageService, method: 'getResourcePackages', result: []
  },
  {
    name: 'rights-matrix', component: AccessRightsMatrixDialogComponent, service: WorkspaceService, method: 'getAccessRightsMatrix', result: { levels: [], categories: [] }
  },
  {
    name: 'variable-bundles', component: VariableBundleManagerComponent, service: VariableBundleService, method: 'getBundles', result: { bundles: [], total: 0 }
  },
  {
    name: 'missing-profiles', component: EditMissingsProfilesDialogComponent, service: MissingsProfileService, method: 'getMissingsProfiles', result: [{ id: 1, label: 'Audit profile' }]
  },
  {
    name: 'journal',
    component: JournalComponent,
    service: JournalService,
    method: 'getJournalEntries',
    result: {
      data: [], total: 0, page: 1, limit: 20
    }
  },
  {
    name: 'unit-definition-error', component: UnitDefinitionPlayerDialogComponent, service: FileService, method: 'getUnit', result: []
  },
  {
    name: 'export-options',
    component: ExportOptionsDialogComponent,
    service: TestResultBackendService,
    method: 'getExportOptions',
    result: {
      groups: ['Group Audit'], units: [], testPersons: [], booklets: []
    }
  },
  {
    name: 'workspace-user-rights', component: UserAccessRightsDialogComponent, service: WorkspaceBackendService, method: 'getAllWorkspaceUsers', result: [{ userId: 7, workspaceId: 1, accessLevel: 3 }]
  }
];

async function createDialog(c: DialogCase) {
  const response = new Subject<unknown>();
  const ws = { getAllWorkspaceUsers: () => of([]), getAllWorkspacesList: () => of({ data: [], total: 0 }), getWorkspacesByUserList: () => of([]) };
  const providerMock = c.service === WorkspaceBackendService ? ws : {};
  Object.assign(providerMock, { [c.method]: () => response });
  await TestBed.configureTestingModule({
    imports: [c.component, TranslateModule.forRoot()],
    providers: [
      provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
      { provide: SERVER_URL, useValue: '/api/' },
      { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1, unitId: 'UNIT', selectedWorkspace: [1] } },
      { provide: MatDialogRef, useValue: { close: jest.fn() } },
      { provide: MatSnackBar, useValue: { open: jest.fn(() => ({ dismiss: jest.fn() })) } },
      { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
      { provide: CodingJobBackendService, useValue: {} },
      { provide: WorkspaceBackendService, useValue: ws },
      { provide: UserBackendService, useValue: { getUsersFull: () => of([{ id: 7, username: 'Audit user' }]), getWorkspacesByUserList: () => of([]) } },
      { provide: c.service, useValue: providerMock }
    ]
  }).compileComponents();
  const fixture = TestBed.createComponent(c.component);
  fixture.autoDetectChanges();
  await fixture.whenStable();
  expect(response.observed).toBe(true);
  await new Promise<void>(resolve => { setTimeout(resolve, 30); });
  return { fixture, response };
}

describe('Dialog server responses with zoneless change detection', () => {
  it.each(cases)('$name renders a delayed response', async c => {
    const { fixture, response } = await createDialog(c);
    response.next(c.result);
    response.complete();
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('mat-spinner, mat-progress-spinner')).toBeNull();
    const expectedTexts: Record<string, string> = {
      impressum: 'Current configured notice',
      'missing-profiles': 'Audit profile',
      journal: 'journal.no-entries',
      'unit-definition-error': 'Aufgabe UNIT wurde nicht gefunden.',
      'export-options': 'Group Audit'
    };
    if (expectedTexts[c.name]) expect(element.textContent).toContain(expectedTexts[c.name]);
    if (c.name === 'workspace-user-rights') {
      expect(element.querySelector('input:checked')).toBeTruthy();
      const save = Array.from(element.querySelectorAll('button')).find(button => button.textContent?.includes('save'));
      expect(save).toBeDefined();
      expect(save?.disabled).toBe(false);
    }
  });

  it.each(cases.filter(c => ['github-releases', 'resource-packages', 'variable-bundles', 'journal', 'unit-definition-error'].includes(c.name)))(
    '$name renders a delayed error without remaining in the loading state', async c => {
      const { fixture, response } = await createDialog(c);
      response.error(new Error('Server unavailable'));
      await fixture.whenStable();
      const element: HTMLElement = fixture.nativeElement;
      expect(element.querySelector('mat-spinner, mat-progress-spinner')).toBeNull();
      if (c.name === 'journal') expect(element.textContent).toContain('journal.load-error-title');
      if (c.name === 'unit-definition-error') expect(element.textContent).toContain('Fehler beim Laden der Aufgabendaten.');
    }
  );
});
