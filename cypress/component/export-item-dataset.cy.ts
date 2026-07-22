import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { ExportComponent } from '../../apps/frontend/src/app/ws-admin/components/export/export.component';
import { AppService } from '../../apps/frontend/src/app/core/services/app.service';
import { MissingsProfileService } from '../../apps/frontend/src/app/coding/services/missings-profile.service';
import { ExportJobService } from '../../apps/frontend/src/app/shared/services/file/export-job.service';
import { ResponseService } from '../../apps/frontend/src/app/shared/services/response/response.service';

describe('Itemdatensatz-Export', () => {
  it('selects items and starts a configured background export job', () => {
    const startedJobs: unknown[] = [];
    const selectedWorkspaceId$ = new BehaviorSubject(5);

    cy.mount(ExportComponent, {
      imports: [TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 5,
            selectedWorkspaceId$,
            userId: 2
          }
        },
        {
          provide: ResponseService,
          useValue: {
            hasGeogebraResponses: () => of(false)
          }
        },
        {
          provide: MissingsProfileService,
          useValue: {
            getMissingsProfilesOrThrow: () => of([
              { id: 4, label: 'IQB-Standard' }
            ])
          }
        },
        {
          provide: ExportJobService,
          useValue: {
            getItemDatasetOptions: () => of({
              items: [
                {
                  unitId: 'UNIT1',
                  unitLabel: 'Aufgabe 1',
                  itemId: 'ITEM1',
                  itemLabel: 'Item 1',
                  columnName: 'Aufgabe1_ITEM1'
                },
                {
                  unitId: 'UNIT2',
                  unitLabel: 'Aufgabe 2',
                  itemId: 'ITEM2',
                  itemLabel: 'Item 2',
                  columnName: 'Aufgabe2_ITEM2'
                }
              ],
              mappingIssues: [],
              mappingWarnings: [{
                code: 'vomd-fallback-used',
                message: 'UNIT1/ITEM1: eindeutiger Fallback verwendet',
                suggestedAction: 'variableId korrigieren.'
              }]
            }),
            startJob: (_workspaceId: number, config: unknown) => {
              startedJobs.push(config);
              return of({ jobId: 'export-1' });
            }
          }
        },
        {
          provide: MatSnackBar,
          useValue: { open: () => undefined }
        }
      ]
    });

    cy.get('mat-select').first().click();
    cy.get('mat-option[value="item-matrix"]').click();
    cy.get('input').should('exist');
    cy.get('[data-cy="item-dataset-mapping-warnings"]')
      .should('contain.text', 'eindeutiger Fallback verwendet')
      .and('contain.text', 'variableId korrigieren');
    cy.get('[data-cy="item-dataset-mapping-warnings"] .mapping-diagnostic')
      .should('have.length', 1);
    cy.get('mat-select[multiple]').click();
    cy.contains('mat-option', 'Aufgabe2_ITEM2').click();
    cy.get('body').type('{esc}');
    cy.get('button[mat-raised-button]').should('not.be.disabled').click();

    cy.wrap(null).then(() => {
      expect(startedJobs).to.have.length(1);
      expect(startedJobs[0]).to.deep.include({
        exportType: 'item-matrix',
        missingsProfileId: 4,
        notReachedScope: 'unit',
        recodeTrailingOmissions: false,
        downloadFilePrefix: 'Itemdatensatz'
      });
    });
  });
});
