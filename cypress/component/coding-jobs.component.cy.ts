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
import { CodingJob } from '../../apps/frontend/src/app/coding/models/coding-job.model';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { UserBackendService } from '../../apps/frontend/src/app/shared/services/user/user-backend.service';

describe('CodingJobsComponent', () => {
  it('shows contextual row actions for a coding job', () => {
    cy.viewport(1400, 900);

    const codingJob: CodingJob = {
      id: 1,
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
      progress: 0
    };

    cy.mount(CodingJobsComponent, {
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
              isAdmin: true
            }
          }
        },
        {
          provide: UserBackendService,
          useValue: {
            getUsers: () => of([])
          }
        },
        {
          provide: CoderService,
          useValue: {
            getCoders: () => of([{ id: 1, name: 'coder1', displayName: 'Coder 1' }])
          }
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

    cy.contains('Job Smoke').should('be.visible');
    cy.contains('button', 'Starten')
      .should('have.attr', 'aria-label', 'Kodierjob starten: Job Smoke');
    cy.get('button[aria-label="Weitere Aktionen: Job Smoke"]').should('exist');
    cy.contains('mat-cell', 'Coder 1').should('be.visible');
    cy.contains('mat-cell', 'MDV007_01').should('be.visible');
  });
});
