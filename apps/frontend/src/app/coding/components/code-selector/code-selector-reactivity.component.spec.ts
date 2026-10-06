import { Component, inject, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { ReplayCodingService } from '../../../replay/services/replay-coding.service';
import { UnitsReplay } from '../../../replay/services/units-replay.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodeSelectorComponent } from './code-selector.component';

@Component({
  imports: [CodeSelectorComponent],
  template: `<app-code-selector [showProgress]="true" [unitsData]="units"
    [codingService]="service" [hasSaveError]="service.hasSaveError" />`
})
class ReplayHostComponent {
  readonly service = inject(ReplayCodingService);
  readonly units: UnitsReplay = {
    id: 1,
    name: 'Job',
    currentUnitIndex: 0,
    units: [1, 2].map(id => ({
      id, name: 'UNIT', alias: 'UNIT', bookletId: 0, testPerson: `person${id}`, variableId: 'V1'
    }))
  };
}

describe('CodeSelectorComponent reactive replay state', () => {
  let fixture: ComponentFixture<ReplayHostComponent>;
  let service: ReplayCodingService;
  let response: Subject<void>;

  const nextButton = (): HTMLButtonElement => fixture.nativeElement.querySelector('.next-button');

  beforeEach(async () => {
    response = new Subject<void>();
    await TestBed.configureTestingModule({
      imports: [ReplayHostComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CodingJobBackendService, useValue: { saveCodingProgress: jest.fn(() => response) } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ReplayHostComponent);
    service = fixture.componentInstance.service;
    service.codingJobId = 1;
    service.restoreRecoverySnapshot({
      codingJobId: 1,
      currentVariableId: 'V1',
      selectedCodes: [[service.generateCompositeKey('person1', 'UNIT', 'V1'), { id: 1, label: 'Code' }]],
      pendingSelections: [],
      openUnitKeys: [],
      notes: [],
      codingJobComment: ''
    });
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('disables navigation during a repeated save and enables it after the response', async () => {
    expect(nextButton().disabled).toBe(false);
    const save = service.saveCodingProgress(1, 1, 'person1', 'UNIT', 'V1', { id: 1, label: 'Code' });
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(true);

    response.next();
    await save;
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(false);
  });

  it('keeps navigation disabled after a save error and enables it after a successful retry', async () => {
    const save = service.saveCodingProgress(1, 1, 'person1', 'UNIT', 'V1', { id: 1, label: 'Code' });
    const failedSave = expect(save).rejects.toThrow('offline');
    await fixture.whenStable();
    response.error(new Error('offline'));
    await failedSave;
    await fixture.whenStable();
    expect(service.hasSaveError).toBe(true);
    expect(nextButton().disabled).toBe(true);

    response = new Subject<void>();
    const retry = service.saveCodingProgress(1, 1, 'person1', 'UNIT', 'V1', { id: 1, label: 'Code' });
    await fixture.whenStable();
    response.next();
    await retry;
    await fixture.whenStable();
    expect(service.hasSaveError).toBe(false);
    expect(nextButton().disabled).toBe(false);
  });

  it('updates navigation after resetting the same service instance', async () => {
    expect(nextButton().disabled).toBe(false);
    service.resetCodingData();
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(true);
  });

  it('updates completion when the required note for a new code is added and removed', async () => {
    service.restoreRecoverySnapshot({
      codingJobId: 1,
      currentVariableId: 'V1',
      selectedCodes: [[service.generateCompositeKey('person1', 'UNIT', 'V1'), {
        id: -2, label: 'New code needed', codingIssueOption: -2
      }]],
      pendingSelections: [],
      openUnitKeys: [],
      notes: [],
      codingJobComment: ''
    });
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(true);

    service.updateLocalNotes('person1', 'UNIT', 'V1', 'Proposed code');
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(false);

    service.updateLocalNotes('person1', 'UNIT', 'V1', '');
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(true);
  });

  it('updates completion after persisting a first selection', async () => {
    service.resetCodingData();
    service.codingJobId = 1;
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(true);
    const save = service.handleCodeSelected({
      variableId: 'V1',
      code: {
        id: 1,
        label: 'Code',
        type: 'FULL_CREDIT',
        score: 1,
        ruleSetOperatorAnd: false,
        ruleSets: [],
        manualInstruction: ''
      },
      codingIssueOption: null
    }, 'person1', 'UNIT', 1, fixture.componentInstance.units);
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(true);

    response.next();
    await save;
    await fixture.whenStable();
    expect(nextButton().disabled).toBe(false);
  });

  it('shows validation triggered by a parent call without a child event', async () => {
    const selector = fixture.debugElement.query(By.directive(CodeSelectorComponent)).componentInstance as CodeSelectorComponent;
    selector.selectedCodingIssueOption = -2;
    expect(selector.canLeaveCurrentUnit()).toBe(false);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.notes-validation-error')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.support-section.collapsed')).toBeNull();
  });
});
