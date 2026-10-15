import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import { DoubleCodedReviewComponent } from '../../apps/frontend/src/app/coding/components/double-coded-review/double-coded-review.component';
import { CodingStatisticsService } from '../../apps/frontend/src/app/coding/services/coding-statistics.service';
import { TestPersonCodingService } from '../../apps/frontend/src/app/coding/services/test-person-coding.service';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { CodingFacadeService } from '../../apps/frontend/src/app/services/facades/coding-facade.service';
import { WorkspaceBackendService } from '../../apps/frontend/src/app/workspace/services/workspace-backend.service';
import { DoubleCodedReviewApiService } from '../../apps/frontend/src/app/coding/services/double-coded-review-api.service';
import { DoubleCodedReviewResponseDto } from '../../api-dto/coding/double-coded-review.dto';

describe('DoubleCodedReviewComponent replay access', () => {
  it('opens editable replay decisions for a study manager without coding permission', () => {
    cy.viewport(1400, 900);

    const getReplayUrl = cy.stub().returns(of({
      replayUrl: 'http://localhost:3333/#/replay/person-1@P001@Booklet%201/Unit%20A/0/VAR_1?workspaceId=1'
    }));

    cy.window().then(win => {
      cy.stub(win, 'open').as('windowOpen');
    });

    cy.mount(DoubleCodedReviewComponent, {
      imports: [TranslateModule.forRoot()],
      providers: [
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 1,
            userId: 99,
            authData: {
              userId: 99,
              isAdmin: false,
              userName: 'Study Manager',
              workspaces: [{ id: 1, accessLevel: 3, canCode: false }]
            },
            loggedUser: undefined,
            createOwnToken: () => of('ct-token')
          }
        },
        {
          provide: MatDialogRef,
          useValue: { close: () => {} }
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { canApplyResults: true }
        },
        {
          provide: WorkspaceBackendService,
          useValue: {
            getWorkspaceCoders: () => of({
              data: [
                { userId: 10, username: 'Coder A' },
                { userId: 20, username: 'Coder B' }
              ]
            })
          }
        },
        {
          provide: CodingFacadeService,
          useValue: {
            getJobDefinitions: () => of([
              { id: 99, status: 'approved', createdJobsCount: 2 }
            ]),
            getCoderTrainings: () => of([])
          }
        },
        {
          provide: TestPersonCodingService,
          useValue: { notifyTestResultsChanged: () => {} }
        },
        {
          provide: DoubleCodedReviewApiService,
          useValue: {
            getDoubleCodedVariablesForReview: () => of({
              data: [{
                responseId: 501,
                sourceUnitId: 1501,
                unitName: 'Unit A',
                variableId: 'VAR_1',
                personLogin: 'person-1',
                personCode: 'P001',
                personGroup: 'Group 1',
                bookletName: 'Booklet 1',
                givenAnswer: 'answer',
                isResolved: false,
                appliedCode: null,
                appliedScore: null,
                appliedComment: null,
                availableCodes: [
                  { code: 1, label: 'Incorrect', score: 0, source: 'schema' },
                  { code: 2, label: 'Correct', score: 1, source: 'schema' }
                ],
                managerDrafts: [],
                managerHistory: [],
                coderResults: [
                  {
                    coderId: 10,
                    coderName: 'Coder A',
                    jobId: 1001,
                    jobName: 'Definition 99 / A',
                    jobDefinitionId: 99,
                    trainingId: null,
                    trainingLabel: null,
                    code: 1,
                    codingIssueOption: null,
                    score: 0,
                    notes: null,
                    supervisorComment: null,
                    codedAt: '2026-05-20T09:00:00.000Z'
                  },
                  {
                    coderId: 20,
                    coderName: 'Coder B',
                    jobId: 1002,
                    jobName: 'Definition 99 / B',
                    jobDefinitionId: 99,
                    trainingId: null,
                    trainingLabel: null,
                    code: 2,
                    codingIssueOption: null,
                    score: 1,
                    notes: null,
                    supervisorComment: null,
                    codedAt: '2026-05-20T09:10:00.000Z'
                  }
                ]
              }],
              total: 1,
              page: 1,
              limit: 50
            } satisfies DoubleCodedReviewResponseDto),
            applyDoubleCodedResolutions: () => of({
              success: true,
              appliedCount: 1,
              failedCount: 0,
              skippedCount: 0,
              message: 'ok'
            })
          }
        },
        {
          provide: CodingStatisticsService,
          useValue: { getReplayUrl }
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: () => ({ dismiss: () => {} })
          }
        },
        {
          provide: MatDialog,
          useValue: {
            open: () => ({ afterClosed: () => of(null) })
          }
        }
      ]
    });

    cy.contains('Unit A').should('be.visible');
    cy.contains('tr', 'Unit A')
      .find('mat-icon')
      .contains('play_circle')
      .parents('button')
      .click({ force: true });

    cy.then(() => {
      expect(getReplayUrl).to.have.been.calledWith(1, 501);
    });
    cy.get('@windowOpen').then(windowOpen => {
      const openStub = windowOpen as unknown as {
        firstCall: { args: [string, string] };
      };
      const openedUrl = openStub.firstCall.args[0];
      expect(openedUrl).to.contain('/#/replay/person-1@P001@Booklet%201/Unit%20A/0/VAR_1');
      expect(openedUrl).to.contain('workspaceId=1');
      expect(openedUrl).to.contain('mode=coding-decision');
      expect(openedUrl).to.contain('originResponseId=501');
      expect(openStub.firstCall.args[1]).to.equal('_blank');
    });
  });
});
