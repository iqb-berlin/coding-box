import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { FilesValidationDialogComponent } from './files-validation.component';
import { SERVER_URL } from '../../../injection-tokens';
import { WorkspaceService } from '../../../workspace/services/workspace.service';
import { FileService } from '../../../shared/services/file/file.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';

describe('FilesValidationDialogComponent selection without Zone.js', () => {
  let fixture: ComponentFixture<FilesValidationDialogComponent>;
  let queuedBatches: Array<() => void>;

  beforeEach(async () => {
    const filteredTestTakers = Array.from({ length: 1201 }, (_, index) => ({
      testTaker: 'TESTTAKERS', login: `login-${index}`, mode: 'run-hot-return', consider: false
    }));
    filteredTestTakers.push({
      testTaker: 'TESTTAKERS', login: 'other-login', mode: 'other-mode', consider: false
    });
    await TestBed.configureTestingModule({
      imports: [FilesValidationDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(), provideHttpClient(),
        { provide: SERVER_URL, useValue: '/api/' },
        { provide: MAT_DIALOG_DATA, useValue: { validationResults: [], filteredTestTakers } },
        { provide: MatDialogRef, useValue: { beforeClosed: () => new Subject<void>(), close: jest.fn() } },
        { provide: WorkspaceService, useValue: {} },
        { provide: FileService, useValue: {} },
        { provide: TestResultService, useValue: { invalidateCache: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } }
      ]
    }).overrideProvider(MatDialog, { useValue: { open: jest.fn() } }).compileComponents();
    fixture = TestBed.createComponent(FilesValidationDialogComponent);
    await fixture.whenStable();

    // Hold only the application bulk-selection timers. Angular's scheduler and
    // Material timers remain real, so it can render between individual batches.
    queuedBatches = [];
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (typeof callback === 'function' && delay === 0 && callback.toString().includes('processBatch')) {
        queuedBatches.push(callback as () => void);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fixture.destroy();
  });

  function actionText(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('.exclude-button')!.textContent || '';
  }

  async function finishBatches(): Promise<void> {
    while (queuedBatches.length) {
      queuedBatches.shift()!();
      await fixture.whenStable();
    }
  }

  it('renders all selected TestTakers after the later bulk-selection timer batches', async () => {
    ((fixture.nativeElement as HTMLElement).querySelector('.select-all-row input') as HTMLInputElement).click();
    await fixture.whenStable();
    expect(actionText()).toContain('(500)');
    await finishBatches();
    expect(fixture.componentInstance.selection.selected).toHaveLength(1202);
    expect(actionText()).toContain('(1202)');
  });

  it('renders a selected mode when the final all-selected boolean stays false', async () => {
    ((fixture.nativeElement as HTMLElement).querySelector('.mode-group input') as HTMLInputElement).click();
    await fixture.whenStable();
    expect(actionText()).toContain('(200)');
    await finishBatches();
    expect(fixture.componentInstance.selection.selected).toHaveLength(1201);
    expect(actionText()).toContain('(1201)');
    const modeCheckbox = (fixture.nativeElement as HTMLElement).querySelector('.mode-group input') as HTMLInputElement;
    expect(modeCheckbox.checked).toBe(true);

    modeCheckbox.click();
    await fixture.whenStable();
    await finishBatches();
    expect(fixture.componentInstance.selection.selected).toHaveLength(0);
    expect(actionText()).toContain('(0)');
    expect(modeCheckbox.checked).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.exclude-button')!.disabled).toBe(true);
  });
});
