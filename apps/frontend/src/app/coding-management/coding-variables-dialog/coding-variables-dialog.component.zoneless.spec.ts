import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { CodingVariablesDialogComponent } from './coding-variables-dialog.component';
import { FileBackendService, ReplayAnchorOverride } from '../../shared/services/file/file-backend.service';
import { FileService } from '../../shared/services/file/file.service';

jest.unmock('@angular/material/snack-bar');

describe('CodingVariablesDialogComponent asynchronous replay anchors', () => {
  let fixture: ComponentFixture<CodingVariablesDialogComponent>;
  let save: Subject<ReplayAnchorOverride>;
  let clear: Subject<{ deleted: boolean }>;
  let input: HTMLInputElement;
  let saveButton: HTMLButtonElement;
  let clearButton: HTMLButtonElement;

  beforeEach(async () => {
    save = new Subject<ReplayAnchorOverride>();
    clear = new Subject<{ deleted: boolean }>();
    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot(),
        MatSnackBarModule,
        CodingVariablesDialogComponent
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1 } },
        {
          provide: FileBackendService,
          useValue: {
            getUnitVariables: () => of([{
              unitName: 'Unit A',
              unitId: 'Unit A',
              variables: [{
                id: 'V1', alias: 'V1', type: 'string', hasCodingScheme: false
              }]
            }]),
            getReplayAnchorOverrides: () => of([{
              unitName: 'Unit A', variableId: 'V1', replayAnchor: 'SAVED'
            }]),
            saveReplayAnchorOverride: () => save,
            deleteReplayAnchorOverride: () => clear
          }
        },
        { provide: FileService, useValue: {} },
        { provide: MatDialog, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingVariablesDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const cell = fixture.nativeElement.querySelector('td.mat-column-replayAnchor') as HTMLElement;
    input = cell.querySelector('input') as HTMLInputElement;
    [saveButton, clearButton] = Array.from(cell.querySelectorAll('button'));
  });

  afterEach(() => fixture.destroy());

  it('renders the saved anchor and reenables controls after a delayed save', async () => {
    input.value = ' ANCHOR ';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(saveButton.disabled).toBe(false);
    saveButton.click();
    await fixture.whenStable();
    expect(input.disabled).toBe(true);
    expect(clearButton.disabled).toBe(true);

    save.next({ unitName: 'Unit A', variableId: 'V1', replayAnchor: 'ANCHOR' });
    save.complete();
    await fixture.whenStable();

    expect(input.value).toBe('ANCHOR');
    expect(input.disabled).toBe(false);
    expect(saveButton.disabled).toBe(true);
    expect(clearButton.disabled).toBe(false);
  });

  it('renders an empty anchor after a delayed reset', async () => {
    expect(input.value).toBe('SAVED');
    clearButton.click();
    await fixture.whenStable();
    expect(input.disabled).toBe(true);

    clear.next({ deleted: true });
    clear.complete();
    await fixture.whenStable();

    expect(input.value).toBe('');
    expect(input.disabled).toBe(false);
    expect(saveButton.disabled).toBe(true);
    expect(clearButton.disabled).toBe(true);
  });

  it.each(['save', 'reset'])('reenables controls and preserves the draft after a delayed %s error', async operation => {
    input.value = 'DRAFT';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (operation === 'save' ? saveButton : clearButton).click();
    await fixture.whenStable();
    expect(input.disabled).toBe(true);

    (operation === 'save' ? save : clear).error(new Error('Request failed'));
    await fixture.whenStable();

    expect(input.value).toBe('DRAFT');
    expect(input.disabled).toBe(false);
    expect(saveButton.disabled).toBe(false);
    expect(clearButton.disabled).toBe(false);
  });
});
