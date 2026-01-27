/* eslint-disable max-classes-per-file */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MatDialog, MatDialogRef, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import {
  Component, Input, Output, EventEmitter
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ValidationDialogComponent } from './validation-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { ValidationBatchRunnerService } from '../../../shared/services/validation/validation-batch-runner.service';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';
import { SERVER_URL } from '../../../injection-tokens';
import {
  TestTakersValidationPanelComponent,
  VariablesValidationPanelComponent,
  VariableTypesValidationPanelComponent,
  ResponseStatusValidationPanelComponent,
  GroupResponsesValidationPanelComponent,
  DuplicateResponsesValidationPanelComponent
} from './panels';
import { ValidationResultBannerComponent } from './shared';

// Mock all internal components
@Component({ selector: 'coding-box-validation-result-banner', template: '', standalone: true })
class MockBannerComponent { @Input() status: unknown; @Input() headline: unknown; @Input() subline: unknown; @Input() recommendation: unknown; }

@Component({ selector: 'coding-box-test-takers-validation-panel', template: '', standalone: true })
class MockTestTakersPanel { @Input() disabled: unknown; @Output() validate = new EventEmitter<void>(); }

@Component({ selector: 'coding-box-variables-validation-panel', template: '', standalone: true })
class MockVariablesPanel { @Input() disabled: unknown; @Output() validate = new EventEmitter<void>(); }

@Component({ selector: 'coding-box-variable-types-validation-panel', template: '', standalone: true })
class MockVariableTypesPanel { @Input() disabled: unknown; @Output() validate = new EventEmitter<void>(); }

@Component({ selector: 'coding-box-response-status-validation-panel', template: '', standalone: true })
class MockResponseStatusPanel { @Input() disabled: unknown; @Output() validate = new EventEmitter<void>(); }

@Component({ selector: 'coding-box-group-responses-validation-panel', template: '', standalone: true })
class MockGroupResponsesPanel { @Input() disabled: unknown; @Output() validate = new EventEmitter<void>(); }

@Component({ selector: 'coding-box-duplicate-responses-validation-panel', template: '', standalone: true })
class MockDuplicateResponsesPanel { @Input() disabled: unknown; @Output() validate = new EventEmitter<void>(); }

describe('ValidationDialogComponent', () => {
  let component: ValidationDialogComponent;
  let fixture: ComponentFixture<ValidationDialogComponent>;
  let appServiceMock: Partial<AppService>;
  let stateServiceMock: {
    getAllTaskIds: jest.Mock;
    getAllValidationResults: jest.Mock;
    observeValidationResults: jest.Mock;
    observeTaskIds: jest.Mock;
  };
  let batchRunnerMock: {
    startBatch: jest.Mock;
  };
  let dialogRefMock: {
    close: jest.Mock;
  };
  let dialogMock: {
    open: jest.Mock;
  };

  beforeEach(async () => {
    appServiceMock = { selectedWorkspaceId: 1 };
    stateServiceMock = {
      getAllTaskIds: jest.fn(),
      getAllValidationResults: jest.fn(),
      observeValidationResults: jest.fn(),
      observeTaskIds: jest.fn()
    };
    batchRunnerMock = { startBatch: jest.fn() };
    dialogRefMock = { close: jest.fn() };
    dialogMock = { open: jest.fn() };

    stateServiceMock.observeValidationResults.mockReturnValue(of({}));
    stateServiceMock.observeTaskIds.mockReturnValue(of({}));
    stateServiceMock.getAllTaskIds.mockReturnValue({});
    stateServiceMock.getAllValidationResults.mockReturnValue({});

    await TestBed.configureTestingModule({
      imports: [
        NoopAnimationsModule,
        ValidationDialogComponent
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: AppService, useValue: appServiceMock },
        { provide: ValidationTaskStateService, useValue: stateServiceMock },
        { provide: ValidationBatchRunnerService, useValue: batchRunnerMock },
        { provide: SERVER_URL, useValue: 'http://test' }
      ]
    })

      .overrideComponent(ValidationDialogComponent, {
        add: {
          imports: [
            MockBannerComponent,
            MockTestTakersPanel,
            MockVariablesPanel,
            MockVariableTypesPanel,
            MockResponseStatusPanel,
            MockGroupResponsesPanel,
            MockDuplicateResponsesPanel
          ]
        },
        remove: {
          imports: [
            ValidationResultBannerComponent,
            TestTakersValidationPanelComponent,
            VariablesValidationPanelComponent,
            VariableTypesValidationPanelComponent,
            ResponseStatusValidationPanelComponent,
            GroupResponsesValidationPanelComponent,
            DuplicateResponsesValidationPanelComponent
          ]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ValidationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should close dialog when close is called', () => {
    component.close();
    expect(dialogRefMock.close).toHaveBeenCalled();
  });

  it('should start all validations', () => {
    component.startAllValidations();
    expect(batchRunnerMock.startBatch).toHaveBeenCalledWith(1, { force: true });
  });

  it('should open content dialog for unit XML', () => {
    dialogMock.open.mockReturnValue({
      afterClosed: () => of(true)
    } as unknown as MatDialogRef<ContentDialogComponent>);

    component.showUnitXml('test.xml');
    expect(dialogMock.open).toHaveBeenCalledWith(ContentDialogComponent, expect.anything());
  });

  describe('getOverallStatus', () => {
    it('should return "not-run" if no results', () => {
      expect(component.getOverallStatus()).toBe('not-run');
    });

    it('should return "running" if any task is active', () => {
      (stateServiceMock.getAllTaskIds as jest.Mock).mockReturnValue({ variables: 123 });
      expect(component.getOverallStatus()).toBe('running');
    });

    it('should return "failed" if any result is failed', () => {
      (stateServiceMock.getAllValidationResults as jest.Mock).mockReturnValue({
        variables: { status: 'failed', timestamp: 0 }
      });
      expect(component.getOverallStatus()).toBe('failed');
    });

    it('should return "success" if all results are success', () => {
      (stateServiceMock.getAllValidationResults as jest.Mock).mockReturnValue({
        variables: { status: 'success', timestamp: 0 }
      });
      expect(component.getOverallStatus()).toBe('success');
    });
  });
});
