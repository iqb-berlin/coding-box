import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import { CodingJobResultDialogComponent } from '../../apps/frontend/src/app/coding/components/coding-jobs/coding-job-result-dialog/coding-job-result-dialog.component';
import { CodingJobBackendService } from '../../apps/frontend/src/app/coding/services/coding-job-backend.service';
import { CodingJob } from '../../apps/frontend/src/app/coding/models/coding-job.model';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { FileService } from '../../apps/frontend/src/app/shared/services/file/file.service';
import { base64ToUtf8 } from '../../apps/frontend/src/app/shared/utils/common-utils';

describe('CodingJobResultDialogComponent review flow', () => {
  it('opens the review replay on the variable page returned for the coding job unit', () => {
    cy.viewport(1400, 900);

    const createUrlTree = cy.stub().returns({});
    const serializeUrl = cy.stub().returns('/replay/generated');
    const createOwnToken = cy.stub().returns(of('review-token'));

    const codingJob: CodingJob = {
      id: 1,
      workspace_id: 5,
      name: 'Job Review',
      status: 'completed',
      created_at: new Date('2026-05-26T08:00:00Z'),
      updated_at: new Date('2026-05-26T08:00:00Z'),
      assignedCoders: [1],
      assignedVariables: [{ unitName: 'UNIT_1', variableId: 'VAR_ON_ONLY_PAGE' }],
      assignedVariableBundles: []
    };

    cy.window().then(win => {
      cy.stub(win, 'open').as('windowOpen');
    });

    cy.mount(CodingJobResultDialogComponent, {
      imports: [TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        {
          provide: MatDialogRef,
          useValue: { close: () => {} }
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            codingJob,
            workspaceId: 5,
            canApplyResults: false
          }
        },
        {
          provide: CodingJobBackendService,
          useValue: {
            getCodingJobUnits: () => of([{
              responseId: 1,
              unitName: 'UNIT_1',
              unitAlias: 'UNIT_1',
              variableId: 'VAR_ON_ONLY_PAGE',
              variableAnchor: 'VAR_ON_ONLY_PAGE',
              variablePage: '0',
              bookletName: 'BOOKLET_A',
              personLogin: 'login',
              personCode: 'code',
              personGroup: 'group',
              isDoubleCoded: false,
              otherCoders: []
            }]),
            getCodingProgress: () => of({
              'login@code@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_ON_ONLY_PAGE': {
                id: -1,
                label: 'Code-Vergabe unsicher'
              }
            }),
            getCodingNotes: () => of({})
          }
        },
        {
          provide: AppService,
          useValue: {
            createOwnToken
          }
        },
        {
          provide: FileService,
          useValue: {}
        },
        {
          provide: Router,
          useValue: {
            createUrlTree,
            serializeUrl
          }
        },
        {
          provide: MatDialog,
          useValue: {
            open: () => ({ afterClosed: () => of(null) })
          }
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: () => ({ dismiss: () => {} })
          }
        }
      ]
    });

    cy.contains('1 von 1 Ergebnissen').should('be.visible');
    cy.get('button[aria-label="Kodierungs-Hinweis überprüfen"]').click();

    cy.get('@windowOpen').then(windowOpen => {
      const openStub = windowOpen as unknown as {
        firstCall: { args: [string, string] };
      };
      const openedUrl = openStub.firstCall.args[0];
      expect(openedUrl).to.match(/\/#\/replay\/generated$/);
      expect(openedUrl).not.to.contain('#//replay');
      expect(openStub.firstCall.args[1]).to.equal('_blank');
    });
    cy.then(() => {
      expect(createOwnToken).to.have.been.calledWith(5, 1);
      expect(createUrlTree).to.have.been.calledWith(
        ['replay/login@code@group@BOOKLET_A/UNIT_1/0/VAR_ON_ONLY_PAGE'],
        Cypress.sinon.match.object
      );

      const queryParams = createUrlTree.firstCall.args[1].queryParams;
      expect(queryParams.auth).to.equal('review-token');
      expect(queryParams.mode).to.equal('coding');

      const unitsData = JSON.parse(base64ToUtf8(queryParams.unitsData));
      expect(unitsData.units[0]).to.include({
        name: 'UNIT_1',
        testPerson: 'login@code@group@BOOKLET_A',
        variableId: 'VAR_ON_ONLY_PAGE',
        variableAnchor: 'VAR_ON_ONLY_PAGE',
        variablePage: '0'
      });
    });
  });
});
