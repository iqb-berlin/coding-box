import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { TestCenterImportComponent } from '../../apps/frontend/src/app/ws-admin/components/test-center-import/test-center-import.component';
import { ImportService, Result } from '../../apps/frontend/src/app/shared/services/file/import.service';
import { UserBackendService } from '../../apps/frontend/src/app/shared/services/user/user-backend.service';
import { WorkspaceAdminService } from '../../apps/frontend/src/app/ws-admin/services/workspace-admin.service';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import translations from '../../apps/frontend/src/assets/i18n/de.json';

describe('Testcenter interrupted import feedback', () => {
  const imported = (group: string, success = true): Result => ({ success, testFiles: 0, responses: 1,
    logs: 0, persons: 1, booklets: 1, units: 1, importedGroups: success ? [group] : [],
    issues: success ? [] : [{ level: 'error', message: 'Antwortspeicherung fehlgeschlagen' }] });

  const groups = () => ['Gruppe-1', 'Gruppe-2', 'Gruppe-3'].map(groupName => ({ groupName,
    groupLabel: groupName, bookletsStarted: 1, numUnitsTotal: 1, numUnitsMin: 1,
    numUnitsMax: 1, numUnitsAvg: 1, lastChange: 0, existsInDatabase: false, hasBookletLogs: false }));

  const mountImport = (importWorkspaceFiles: unknown, getProgress: unknown) => cy.mount(TestCenterImportComponent, {
    imports: [TranslateModule.forRoot()],
    providers: [provideHttpClient(), provideNoopAnimations(),
      { provide: MAT_DIALOG_DATA, useValue: { importType: 'testResults' } },
      { provide: MatDialogRef, useValue: { close: cy.stub().as('closeDialog') } },
      { provide: UserBackendService, useValue: {} },
      { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
      { provide: ImportService, useValue: { importWorkspaceFiles, getImportWorkspaceFilesProgress: getProgress,
        importTestcenterGroups: () => of(groups()), getTestGroupsLoadProgress: () => of(null) } },
      { provide: WorkspaceAdminService, useValue: { getAuthToken: () => '', getClaims: () => [],
        getlastTestcenterInstance: () => [], getTestGroups: () => [], getLastServer: () => '', getLastUrl: () => '', setTestGroups: () => {} } }
    ]
  }).then(({ component, fixture }) => {
    const translate = fixture.debugElement.injector.get(TranslateService);
    translate.setTranslation('de', translations);
    translate.use('de');
    component.authenticated = true;
    component.showTestGroups = true;
    component.authToken = 'test-token';
    component.workspaces = [{ id: 'tc', label: 'Testcenter', type: 'tc', flags: { mode: 'full' } }];
    component.loginForm.patchValue({ testCenter: 1 });
    component.importFilesForm.patchValue({ workspace: 'tc', responses: true });
    component.testGroups = groups();
    component.selectedRows = [...component.testGroups];
    fixture.autoDetectChanges();
    fixture.detectChanges();
  });

  [1200, 420].forEach(width => it(`shows preserved groups and safe retry guidance at ${width}px`, () => {
    cy.viewport(width, 900);
    const run = cy.stub().as('runImport');
    run.onFirstCall().returns(of(imported('Gruppe-1')));
    run.onSecondCall().returns(of(imported('Gruppe-2', false)));
    mountImport(run, () => of(null));
    cy.contains('button', 'Importieren').click();
    cy.get('[role="alert"]').should('contain.text', 'Import nicht vollständig abgeschlossen')
      .and('contain.text', 'Bestätigte Gruppen: Gruppe-1 (1 / 3)')
      .and('contain.text', 'Betroffene Testgruppe: Gruppe-2')
      .and('contain.text', 'Noch nicht gestartete Gruppen: Gruppe-3')
      .and('contain.text', 'Fehlende Antwortwerte ergänzen');
    cy.get('@runImport').should('have.been.calledTwice');
    cy.get('@closeDialog').should('not.have.been.called');
    cy.get('[role="alert"] > div').then(element => {
      expect(element[0].scrollWidth).to.be.at.most(element[0].clientWidth);
    });
    cy.screenshot(`testcenter-partial-import-${width}`);
  }));

  it('preserves remaining groups through an options change and retries without confirmed groups', () => {
    cy.viewport(1200, 900);
    const run = cy.stub().as('runImport');
    run.onFirstCall().returns(of(imported('Gruppe-1')));
    run.onSecondCall().returns(of(imported('Gruppe-2', false)));
    run.onThirdCall().returns(of(imported('Gruppe-2')));
    run.onCall(3).returns(of(imported('Gruppe-3')));
    mountImport(run, () => of(null));
    cy.contains('button', 'Importieren').click();
    cy.contains('button', 'Zurück zu Optionen').click();
    cy.get('mat-select[formControlName="responseOverwriteMode"]').click();
    cy.contains('mat-option', 'Fehlende Antwortwerte ergänzen').click();
    cy.contains('button', 'Weiter').click();
    cy.get('tr.mat-mdc-row').eq(0).find('input[type="checkbox"]').should('not.be.checked');
    cy.get('tr.mat-mdc-row').eq(1).find('input[type="checkbox"]').should('be.checked');
    cy.get('tr.mat-mdc-row').eq(2).find('input[type="checkbox"]').should('be.checked');
    cy.contains('button', 'Importieren').click();
    cy.get('@runImport').should('have.been.calledWithMatch', 1, 'tc', '1', '', 'test-token', { responses: true }, ['Gruppe-2']);
    cy.then(() => {
      expect(run.getCalls().map(call => call.args[6])).to.deep.equal([['Gruppe-1'], ['Gruppe-2'], ['Gruppe-2'], ['Gruppe-3']]);
      expect(run.getCalls().slice(2).map(call => call.args[10])).to.deep.equal(['merge', 'merge']);
    });
    cy.get('@closeDialog').should('have.been.calledWithMatch', { didImport: true });
  });

  it('shows the authorization failure and allows another attempt after a rejected request', () => {
    cy.viewport(1200, 900);
    const run = cy.stub().returns(throwError(() => ({ status: 403, error: { message: 'Access level not sufficient' } })));
    mountImport(run, () => of(null));
    cy.contains('button', 'Importieren').click();
    cy.get('.error-message').should('contain.text', 'Der Import wurde nicht gestartet')
      .and('contain.text', 'Access level not sufficient');
    cy.contains('button', 'Importieren').should('not.be.disabled');
    cy.contains('button', 'Zurück zu Optionen').should('not.be.disabled');
    cy.contains('button', 'Status prüfen').should('not.exist');
  });

  it('blocks another start until the server result is confirmed', () => {
    cy.viewport(1200, 900);
    const run = cy.stub().as('runImport');
    run.onFirstCall().returns(throwError(() => new Error('Connection lost')));
    run.onSecondCall().returns(of(imported('Gruppe-2')));
    run.onThirdCall().returns(of(imported('Gruppe-3')));
    let terminal = false;
    mountImport(run, () => of({ importRunId: 'run', status: terminal ? 'completed' : 'running',
      totalPlanned: 1, totalProcessed: 0, totalUploaded: 0, totalFailed: 0, options: [],
      updatedAt: Date.now(), result: terminal ? imported('Gruppe-1') : undefined }));
    cy.contains('button', 'Importieren').click();
    cy.get('[role="alert"]').should('contain.text', 'Importstatus noch unklar')
      .and('contain.text', 'Nicht erneut importieren');
    cy.contains('button', 'Importieren').should('be.disabled');
    cy.get('@runImport').should('have.been.calledOnce');
    cy.then(() => { terminal = true; });
    cy.contains('button', 'Status prüfen').click();
    cy.get('@runImport').should('have.been.calledThrice');
    cy.get('@closeDialog').should('have.been.calledWithMatch', { didImport: true });
  });
});
