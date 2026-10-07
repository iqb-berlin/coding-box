import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import { CodingJobsComponent } from '../../apps/frontend/src/app/coding/components/coding-jobs/coding-jobs.component';
import { CodingJobBackendService } from '../../apps/frontend/src/app/coding/services/coding-job-backend.service';
import { CodingTrainingBackendService } from '../../apps/frontend/src/app/coding/services/coding-training-backend.service';
import { CoderService } from '../../apps/frontend/src/app/coding/services/coder.service';
import { TestPersonCodingService } from '../../apps/frontend/src/app/coding/services/test-person-coding.service';
import { CodingJob } from '../../apps/frontend/src/app/coding/models/coding-job.model';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { UserBackendService } from '../../apps/frontend/src/app/shared/services/user/user-backend.service';
import { UserService } from '../../apps/frontend/src/app/shared/services/user/user.service';

describe('CodingJobsComponent', () => {
  const mountCodingJob = (overrides: Partial<CodingJob> = {}, level = 3) => {
    cy.viewport(1400, 900);

    const codingJob: CodingJob = {
      id: 1,
      creatorUserId: 1,
      workspace_id: 5,
      name: 'Job Smoke',
      status: 'pending',
      created_at: new Date('2026-05-14T10:00:00Z'),
      updated_at: new Date('2026-05-14T10:00:00Z'),
      assignedCoders: [1],
      assignedVariables: [{ unitName: 'MDV007', variableId: '01' }],
      assignedVariableBundles: [],
      totalUnits: 1,
      codedUnits: 0,
      openUnits: 1,
      progress: 0,
      ...overrides
    };

    return cy.mount(CodingJobsComponent, {
      imports: [TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        {
          provide: CodingJobBackendService,
          useValue: {
            getCodingIncompleteVariables: () => of([]),
            getCodingJobs: () => of({ data: [codingJob] }),
            getBulkCodingProgress: () => of({})
          }
        },
        {
          provide: CodingTrainingBackendService,
          useValue: {
            getCoderTrainings: () => of([])
          }
        },
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 5,
            authData: {
              userId: 1,
              isAdmin: level === 3
            }
          }
        },
        {
          provide: UserService,
          useValue: { getUsers: () => of([{ id: 1, accessLevel: level }]) }
        },
        {
          provide: UserBackendService,
          useValue: {
            getUsers: () => of([{ id: 1, accessLevel: level }])
          }
        },
        {
          provide: CoderService,
          useValue: {
            getCoders: () => of([{ id: 1, name: 'coder1', displayName: 'Coder 1' }])
          }
        },
        {
          provide: TestPersonCodingService,
          useValue: { notifyTestResultsChanged: () => {} }
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
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: {} } }
        }
      ]
    });
  };

  it('shows contextual row actions for a coding job', () => {
    mountCodingJob();

    cy.contains('Job Smoke').should('be.visible');
    cy.contains('button', 'Starten')
      .should('have.attr', 'aria-label', 'Kodierjob starten: Job Smoke');
    cy.get('button[aria-label="Weitere Aktionen: Job Smoke"]').should('exist');
    cy.contains('mat-cell', 'Coder 1').should('be.visible');
    cy.contains('mat-cell', 'MDV007_01').should('be.visible');
  });

  [null, 2].forEach(creatorUserId => {
    it(`keeps jobs of owner ${creatorUserId} readable but not deletable for level 2`, () => {
      mountCodingJob({ creatorUserId, status: 'completed' }, 2);
      cy.contains('Job Smoke').should('be.visible');
      cy.get('button[aria-label="Weitere Aktionen: Job Smoke"]').click();
      cy.get('[aria-label="Kodierjob löschen: Job Smoke"]').should('be.disabled');
      cy.get('[aria-label="Ergebnisse anwenden: Job Smoke"]').should('not.exist');
    });
  });

  it('permits deleting owned level 2 jobs without offering result application', () => {
    mountCodingJob({ status: 'completed' }, 2);
    cy.get('button[aria-label="Weitere Aktionen: Job Smoke"]').click();
    cy.get('[aria-label="Kodierjob löschen: Job Smoke"]').should('be.enabled');
    cy.get('[aria-label="Ergebnisse anwenden: Job Smoke"]').should('not.exist');
  });

  it('offers restart for an active assigned non-training job with open units', () => {
    mountCodingJob({ status: 'active' });

    cy.get('button[aria-label="Weitere Aktionen: Job Smoke"]').click();
    cy.get('[role="menu"]').should('be.visible').within(() => {
      cy.get('button[aria-label="Offene Fälle ansehen: Job Smoke"]').should('be.visible');
    });
  });

  (['review', 'results_applied'] as const).forEach(status => {
    it(`does not offer restart for a ${status} job with open units`, () => {
      mountCodingJob({ status });

      cy.get('button[aria-label="Weitere Aktionen: Job Smoke"]').click();
      cy.get('[role="menu"]').should('be.visible').within(() => {
        cy.get('button[aria-label="Offene Fälle ansehen: Job Smoke"]').should('not.exist');
      });
    });
  });
});
