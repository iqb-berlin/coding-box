import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { DoubleCodedReviewComponent } from './double-coded-review.component';

describe('DoubleCodedReviewComponent', () => {
  let component: DoubleCodedReviewComponent;
  let fixture: ComponentFixture<DoubleCodedReviewComponent>;
  let overlayContainer: OverlayContainer;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        DoubleCodedReviewComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        provideNoopAnimations(),
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 1,
            authData: { userName: 'Reviewer' },
            loggedUser: undefined,
            createOwnToken: jest.fn(() => of('token'))
          }
        },
        {
          provide: WorkspaceBackendService,
          useValue: {
            getWorkspaceCoders: jest.fn(() => of({
              data: [
                { userId: 10, username: 'Coder A' },
                { userId: 20, username: 'Coder B' }
              ]
            }))
          }
        },
        {
          provide: CodingFacadeService,
          useValue: {
            getJobDefinitions: jest.fn(() => of([
              { id: 99, status: 'approved', createdJobsCount: 2 }
            ])),
            getCoderTrainings: jest.fn(() => of([]))
          }
        },
        {
          provide: TestPersonCodingService,
          useValue: {
            getDoubleCodedVariablesForReview: jest.fn(() => of({
              data: [
                {
                  responseId: 501,
                  unitName: 'Unit A',
                  variableId: 'VAR_1',
                  personLogin: 'person-1',
                  personCode: 'P001',
                  bookletName: 'Booklet 1',
                  givenAnswer: 'answer',
                  isResolved: false,
                  coderResults: [
                    {
                      coderId: 10,
                      coderName: 'Coder A',
                      jobId: 1001,
                      jobName: 'Definition 99 / A',
                      code: 1,
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
                      code: 2,
                      score: 1,
                      notes: 'Check manually',
                      supervisorComment: null,
                      codedAt: '2026-05-20T09:10:00.000Z'
                    }
                  ]
                }
              ],
              total: 1,
              page: 1,
              limit: 50
            })),
            applyDoubleCodedResolutions: jest.fn(() => of({
              success: true,
              appliedCount: 1,
              failedCount: 0,
              skippedCount: 0,
              message: 'ok'
            }))
          }
        },
        {
          provide: CodingStatisticsService,
          useValue: {
            getReplayUrl: jest.fn(() => of({ replayUrl: '' }))
          }
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: MatDialog,
          useValue: {
            open: jest.fn(() => ({ afterClosed: () => of(false) }))
          }
        }
      ]
    }).compileComponents();

    overlayContainer = TestBed.inject(OverlayContainer);
    fixture = TestBed.createComponent(DoubleCodedReviewComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
  });

  it('renders the reusable decision cell and updates its selection through Material select', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const selectionCell = nativeElement.querySelector('td.mat-column-selection .selection-cell') as HTMLElement;

    expect(selectionCell).toBeTruthy();
    expect(selectionCell.querySelector('.decision-status.conflict')?.textContent)
      .toContain('double-coded-review.decision.status-conflict');
    expect(selectionCell.querySelector('.decision-code-value')?.textContent?.trim()).toBe('1');
    expect(selectionCell.querySelector('.decision-source')?.textContent).toContain('Coder A');
    expect(selectionCell.querySelector('.comment-field')).toBeTruthy();

    const selectTrigger = selectionCell.querySelector('.mat-mdc-select-trigger') as HTMLElement;
    selectTrigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const options = Array.from(
      overlayContainer.getContainerElement().querySelectorAll('mat-option')
    ) as HTMLElement[];

    expect(options).toHaveLength(2);

    options[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const reviewItem = component.dataSource.data[0];
    expect(component.selectionForm.get(component.getItemControlName(reviewItem))?.value).toBe('1002');
    expect(selectionCell.querySelector('.decision-code-value')?.textContent?.trim()).toBe('2');
    expect(selectionCell.querySelector('.decision-source')?.textContent).toContain('Coder B');
  });
});
