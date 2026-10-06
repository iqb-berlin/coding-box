import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';

import { TestResultsComponent } from '../../apps/frontend/src/app/ws-admin/components/test-results/test-results.component';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { SERVER_URL } from '../../apps/frontend/src/app/injection-tokens';
import { TestResultService } from '../../apps/frontend/src/app/shared/services/test-result/test-result.service';
import { TestResultBackendService } from '../../apps/frontend/src/app/shared/services/test-result/test-result-backend.service';
import { ValidationService } from '../../apps/frontend/src/app/shared/services/validation/validation.service';
import { ValidationTaskStateService } from '../../apps/frontend/src/app/shared/services/validation/validation-task-state.service';
import { UnitNoteService } from '../../apps/frontend/src/app/shared/services/unit/unit-note.service';
import { UnitService } from '../../apps/frontend/src/app/shared/services/unit/unit.service';
import { FileService } from '../../apps/frontend/src/app/shared/services/file/file.service';
import { ResponseService } from '../../apps/frontend/src/app/shared/services/response/response.service';
import { VariableAnalysisService } from '../../apps/frontend/src/app/shared/services/response/variable-analysis.service';
import { CodingStatisticsService } from '../../apps/frontend/src/app/coding/services/coding-statistics.service';
import { TestPersonCodingService } from '../../apps/frontend/src/app/coding/services/test-person-coding.service';
import { UnitsReplayService } from '../../apps/frontend/src/app/replay/services/units-replay.service';
import { WorkspaceSettingsService } from '../../apps/frontend/src/app/ws-admin/services/workspace-settings.service';

describe('TestResultsComponent view switching', () => {
  (['pending', 'failed'] as const).forEach(personListState => {
    it(`shows flat responses while the person-list request is ${personListState}`, () => {
      const personListResponse = new Subject<{ data: []; total: number }>();
      const getFlatResponses = cy.stub().as('getFlatResponses');
      getFlatResponses.returns(of({
        data: [{
          bookletId: 11,
          responseId: 12,
          unitId: 13,
          personId: 14,
          code: 'P001',
          group: 'G1',
          login: 'flat-person',
          booklet: 'B1',
          unit: 'U1',
          response: 'VAR_1',
          responseStatus: 'VALUE_CHANGED',
          responseValue: '42',
          tags: []
        }],
        total: 1,
        page: 1,
        limit: 100
      }));
      cy.viewport(1400, 900);
      cy.mount(TestResultsComponent, {
        imports: [TranslateModule.forRoot()],
        providers: [
          provideHttpClient(),
          provideNoopAnimations(),
          provideRouter([]),
          { provide: SERVER_URL, useValue: '/api/' },
          {
            provide: AppService,
            useValue: { selectedWorkspaceId: 1, loggedUser: { sub: 'user' } }
          },
          { provide: MatSnackBar, useValue: { open: () => ({ dismiss: () => {} }) } },
          { provide: MatDialog, useValue: { open: () => {}, closeAll: () => {} } },
          {
            provide: TestResultBackendService,
            useValue: { getExportTestResultsJobs: () => of([]) }
          },
          {
            provide: TestResultService,
            useValue: {
              getTestResults: () => personListResponse,
              getWorkspaceOverview: () => of({}),
              flatResponseFilterRequests$: of(),
              workspaceCacheInvalidated$: of(),
              getFlatResponses,
              getFlatResponseFrequencies: () => of({}),
              getFlatResponseFilterOptions: () => of({
                codes: [],
                groups: [],
                logins: [],
                booklets: [],
                units: [],
                responses: [],
                responseStatuses: [],
                tags: [],
                processingDurations: [],
                unitProgresses: [],
                sessionBrowsers: [],
                sessionOs: [],
                sessionScreens: [],
                sessionIds: []
              })
            }
          },
          { provide: ValidationService, useValue: { getValidationStatus: () => of({}) } },
          {
            provide: ValidationTaskStateService,
            useValue: {
              getValidationStatus: () => of({}),
              getAllTaskIds: () => ({}),
              getAllValidationResults: () => ({}),
              observeTaskIds: () => of({}),
              observeValidationResults: () => of({}),
              observeBatchState: () => of({ status: 'idle' })
            }
          },
          {
            provide: UnitNoteService,
            useValue: {
              getUnitNotes: () => of([]),
              getNotesForMultipleUnits: () => of({})
            }
          },
          { provide: UnitService, useValue: {} },
          { provide: FileService, useValue: {} },
          { provide: ResponseService, useValue: {} },
          { provide: VariableAnalysisService, useValue: {} },
          { provide: UnitsReplayService, useValue: {} },
          {
            provide: CodingStatisticsService,
            useValue: { getCodingFreshness: () => of({ workspaceId: 1, currentRevision: 0, items: [] }) }
          },
          { provide: TestPersonCodingService, useValue: {} },
          {
            provide: WorkspaceSettingsService,
            useValue: {
              getShowTestResultsLogAnomalies: () => of(false),
              getEnableRegexSearch: () => of(false),
              getAutoRefreshManualCodingJobs: () => of(false)
            }
          }
        ]
      }).then(({ fixture }) => {
        fixture.autoDetectChanges();
        if (personListState === 'failed') {
          personListResponse.error(new Error('person-list failure'));
          fixture.detectChanges();
        }
      });

      if (personListState === 'failed') {
        cy.get('.test-results-load-error').should('be.visible');
      } else {
        cy.get('.loading-container').should('be.visible');
      }

      cy.contains('button', 'Tabellenansicht').click();
      cy.get('coding-box-test-results-flat-table').should('be.visible');
      cy.contains('td', 'flat-person').should('be.visible');
      cy.contains('td', 'VAR_1').should('be.visible');
      cy.get('@getFlatResponses').should('have.been.calledWith', 1);
      cy.get('.test-results-load-error').should('not.exist');
      cy.get('.loading-container').should('not.exist');
      cy.contains('Keine Testergebnisse vorhanden').should('not.exist');

      cy.contains('button', 'Ergebnisbrowser').click();
      cy.get('coding-box-test-results-flat-table').should('not.exist');
      if (personListState === 'failed') {
        cy.get('.test-results-load-error').should('be.visible');
      } else {
        cy.get('.loading-container').should('be.visible');
      }
    });
  });
});
