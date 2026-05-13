import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { CoderTrainingsListComponent } from './coder-trainings-list.component';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { AppService } from '../../../core/services/app.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';
import { CoderTraining } from '../../models/coder-training.model';

describe('CoderTrainingsListComponent', () => {
  let fixture: ComponentFixture<CoderTrainingsListComponent>;
  let component: CoderTrainingsListComponent;

  const trainings: CoderTraining[] = [
    {
      id: 10,
      workspace_id: 1,
      label: 'Duplicate Label',
      created_at: new Date('2026-05-13T10:00:00'),
      updated_at: new Date('2026-05-13T10:00:00'),
      jobsCount: 2
    },
    {
      id: 11,
      workspace_id: 1,
      label: 'Duplicate Label',
      created_at: new Date('2026-05-13T11:00:00'),
      updated_at: new Date('2026-05-13T11:00:00'),
      jobsCount: 1
    },
    {
      id: 12,
      workspace_id: 1,
      label: 'Unique Label',
      created_at: new Date('2026-05-13T12:00:00'),
      updated_at: new Date('2026-05-13T12:00:00'),
      jobsCount: 1
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CoderTrainingsListComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: CodingTrainingBackendService,
          useValue: {
            getCoderTrainings: jest.fn().mockReturnValue(of(trainings)),
            getCodingJobsForTraining: jest.fn().mockReturnValue(of([])),
            deleteCoderTraining: jest.fn().mockReturnValue(of({ success: true }))
          }
        },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: BackendMessageTranslatorService, useValue: { translateMessage: jest.fn((message: string) => message) } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn(() => ({ afterClosed: () => of(null) })) } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CoderTrainingsListComponent);
    component = fixture.componentInstance;
    component.originalData = trainings;
    component.coderTrainings = trainings;
    component.rebuildTrainingNameFilterOptions();
  });

  it('keeps duplicate labels selectable but disambiguates list and filter display', () => {
    const filterOptions = component.getTrainingNameFilterOptions();

    expect(filterOptions).toEqual([
      { label: 'Duplicate Label', count: 2 },
      { label: 'Unique Label', count: 1 }
    ]);
    expect(component.getTrainingNameFilterLabel(filterOptions[0])).toBe('Duplicate Label (2 Schulungen)');
    expect(component.isDuplicateTrainingLabel(trainings[0])).toBe(true);
    expect(component.isDuplicateTrainingLabel(trainings[2])).toBe(false);
    expect(component.getTrainingTableMeta(trainings[0])).toContain('ID 10');
    expect(component.getTrainingTableMeta(trainings[0])).toContain('2 Jobs');

    component.selectedTrainingName = 'Duplicate Label';
    component.onTrainingNameFilterChange();

    expect(component.coderTrainings.map(training => training.id)).toEqual([10, 11]);
  });
});
