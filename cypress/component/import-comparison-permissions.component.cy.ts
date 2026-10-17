import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
  NEVER, Observable, of, Subject
} from 'rxjs';
import { ImportComparisonDialogComponent } from '../../apps/frontend/src/app/coding/components/import-comparison-dialog/import-comparison-dialog.component';
import { TestPersonCodingService } from '../../apps/frontend/src/app/coding/services/test-person-coding.service';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { UserService } from '../../apps/frontend/src/app/shared/services/user/user.service';

describe('External coding import permissions', () => {
  function mountPreview(level: number, isAdmin = false, roleResponse?: Observable<Array<{ id: number; accessLevel: number }>>) {
    const start = cy.stub().as('startImport').returns(NEVER);
    return cy.mount(ImportComparisonDialogComponent, {
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: MAT_DIALOG_DATA,
          useValue: { message: 'preview', processedRows: 1, updatedRows: 1, errors: [], affectedRows: [], isPreview: true,
            workspaceId: 12, fileData: 'encoded', fileName: 'coding.csv' } },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
        { provide: AppService, useValue: { selectedWorkspaceId: 12, authData: { userId: 7, isAdmin } } },
        { provide: UserService, useValue: { getUsers: () => roleResponse ?? of(isAdmin ? [] : [{ id: 7, accessLevel: level }]) } },
        { provide: TestPersonCodingService, useValue: { startExternalCodingImportJob: start } }
      ]
    });
  }

  it('lets Level 2 inspect and cancel a preview without an apply action', () => {
    mountPreview(2);
    cy.contains('Dies ist eine Vorschau.').should('be.visible');
    cy.contains('button', 'Änderungen anwenden').should('not.exist');
    cy.contains('button', 'Abbrechen').should('be.visible');
    cy.get('@startImport').should('not.have.been.called');
  });

  it('waits for delayed apply rights and renders them without another interaction', () => {
    const roles = new Subject<Array<{ id: number; accessLevel: number }>>();
    mountPreview(3, false, roles);
    cy.contains('button', 'Änderungen anwenden').should('not.exist');
    cy.then(() => { roles.next([{ id: 7, accessLevel: 3 }]); });
    cy.contains('button', 'Änderungen anwenden').should('be.enabled');
    cy.get('@startImport').should('not.have.been.called');
  });

  [false, true].forEach(isAdmin => {
    it(`lets ${isAdmin ? 'an administrator' : 'a study manager'} apply a preview`, () => {
      mountPreview(isAdmin ? 0 : 3, isAdmin);
      cy.contains('button', 'Änderungen anwenden').should('be.enabled').click();
      cy.get('@startImport').should('have.been.calledOnce');
      cy.contains('.apply-progress', '0%').should('be.visible');
    });
  });
});
