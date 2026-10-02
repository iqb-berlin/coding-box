import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import {
  DoubleCodedManagerDecisionDto,
  DoubleCodedReviewItemDto
} from '../../api-dto/coding/double-coded-review.dto';
import { DoubleCodedReviewComponent } from '../../apps/frontend/src/app/coding/components/double-coded-review/double-coded-review.component';
import { CodingStatisticsService } from '../../apps/frontend/src/app/coding/services/coding-statistics.service';
import { DoubleCodedReviewApiService } from '../../apps/frontend/src/app/coding/services/double-coded-review-api.service';
import { TestPersonCodingService } from '../../apps/frontend/src/app/coding/services/test-person-coding.service';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { SERVER_URL } from '../../apps/frontend/src/app/injection-tokens';
import { CodingFacadeService } from '../../apps/frontend/src/app/services/facades/coding-facade.service';
import { WorkspaceBackendService } from '../../apps/frontend/src/app/workspace/services/workspace-backend.service';

describe('Double-coded review flow', () => {
  it('persists a draft, applies it, and keeps a historical code visible', () => {
    cy.viewport(1400, 900);

    let component: DoubleCodedReviewComponent;
    let savedDraft: DoubleCodedManagerDecisionDto | null = null;
    let appliedDecision: DoubleCodedManagerDecisionDto | null = null;

    const buildReviewItem = (): DoubleCodedReviewItemDto => ({
      responseId: 501,
      sourceUnitId: 1501,
      unitName: 'Unit A',
      variableId: 'VAR_1',
      personLogin: 'person-1',
      personCode: 'P001',
      personGroup: 'Group 1',
      bookletName: 'Booklet 1',
      givenAnswer: 'answer',
      isResolved: appliedDecision !== null,
      appliedCode: appliedDecision?.effectiveCode ?? null,
      appliedScore: appliedDecision?.score ?? null,
      appliedComment: appliedDecision?.comment ?? null,
      availableCodes: [
        { code: 1, label: 'Incorrect', score: 0, source: 'schema' },
        { code: 2, label: 'Correct', score: 1, source: 'schema' },
        { code: -3, label: 'Invalid', score: null, source: 'general' },
        { code: -4, label: 'Not scorable', score: null, source: 'general' }
      ],
      managerDrafts: savedDraft ? [{ ...savedDraft }] : [],
      managerHistory: appliedDecision ? [{ ...appliedDecision }] : [],
      coderResults: [
        {
          coderId: 10,
          coderName: 'Coder A',
          jobId: 1001,
          jobName: 'Definition 99 / A',
          jobDefinitionId: 99,
          trainingId: null,
          trainingLabel: null,
          code: 999,
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
          code: 1,
          codingIssueOption: null,
          score: 0,
          notes: null,
          supervisorComment: null,
          codedAt: '2026-05-20T09:10:00.000Z'
        }
      ]
    });

    cy.intercept(
      'GET',
      '**/api/admin/workspace/1/coding/double-coded-review*',
      request => {
        expect(request.query).to.include({
          page: '1',
          limit: '50',
          onlyConflicts: 'false',
          excludeTrainings: 'false'
        });
        request.reply({
          data: [buildReviewItem()],
          total: 1,
          page: 1,
          limit: 50
        });
      }
    ).as('getReview');
    cy.intercept(
      'PUT',
      '**/api/admin/workspace/1/coding/double-coded-review/501/draft',
      request => {
        expect(request.body).to.deep.equal({
          sourceUnitId: 1501,
          code: 2,
          score: 1,
          comment: null
        });
        savedDraft = {
          id: 41,
          responseId: 501,
          managerUserId: 99,
          managerKey: '99',
          managerName: 'Study Manager',
          state: 'draft',
          effectiveCode: request.body.code,
          selectedCode: request.body.code,
          score: request.body.score ?? null,
          comment: request.body.comment ?? null,
          createdAt: '2026-05-20T10:00:00.000Z',
          updatedAt: '2026-05-20T10:00:00.000Z',
          finalizedAt: null,
          legacy: false
        };
        request.reply({ ...savedDraft });
      }
    ).as('saveDraft');
    cy.intercept(
      'POST',
      '**/api/admin/workspace/1/coding/double-coded-review/apply-resolutions',
      request => {
        expect(request.body).to.deep.equal({
          decisions: [{
            responseId: 501,
            sourceUnitId: 1501,
            code: 2,
            score: 1
          }]
        });
        const decision = request.body.decisions[0];
        appliedDecision = {
          id: 42,
          responseId: decision.responseId,
          managerUserId: 99,
          managerKey: '99',
          managerName: 'Study Manager',
          state: 'applied',
          effectiveCode: decision.code ?? null,
          selectedCode: decision.code ?? null,
          score: decision.score ?? null,
          comment: decision.resolutionComment ?? null,
          createdAt: '2026-05-20T10:00:00.000Z',
          updatedAt: '2026-05-20T10:05:00.000Z',
          finalizedAt: '2026-05-20T10:05:00.000Z',
          legacy: false
        };
        savedDraft = null;
        request.reply({
          success: true,
          appliedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          message: 'ok',
          results: [{ responseId: decision.responseId, status: 'applied' as const }]
        });
      }
    ).as('applyResolutions');

    cy.mount(DoubleCodedReviewComponent, {
      imports: [TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideNoopAnimations(),
        { provide: SERVER_URL, useValue: '/api/' },
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 1,
            userId: 99,
            authData: { userName: 'Study Manager', isAdmin: false },
            loggedUser: undefined,
            createOwnToken: () => of('token')
          }
        },
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: MAT_DIALOG_DATA, useValue: { canApplyResults: true } },
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
        DoubleCodedReviewApiService,
        {
          provide: TestPersonCodingService,
          useValue: { notifyTestResultsChanged: () => {} }
        },
        {
          provide: CodingStatisticsService,
          useValue: { getReplayUrl: () => of({ replayUrl: '' }) }
        },
        { provide: MatSnackBar, useValue: { open: () => ({ dismiss: () => {} }) } },
        {
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of(true) }) }
        }
      ]
    }).then(result => {
      component = result.component;
    });

    cy.wait('@getReview');
    cy.contains('tr', 'Unit A').as('reviewRow');
    cy.get('@reviewRow').find('.coder-code-value').should('contain.text', '999');
    cy.get('@reviewRow').find('.decision-select-field mat-select').click();
    cy.get('.decision-option-code').should('not.contain.text', '999');
    cy.contains('.decision-option-code', /^2$/).click();

    cy.wait('@saveDraft');
    cy.then(() => component.loadData());
    cy.wait('@getReview');
    cy.get('@reviewRow').find('.decision-code-value').should('contain.text', '2');

    cy.get('@reviewRow').find('.row-actions button').click();
    cy.wait('@applyResolutions');
    cy.get('@reviewRow').find('.decision-select-field').should('not.exist');
    cy.get('@reviewRow').find('.applied-code-value').should('contain.text', '2');
    cy.get('@reviewRow').find('.coder-code-value').should('contain.text', '999');
  });
});
