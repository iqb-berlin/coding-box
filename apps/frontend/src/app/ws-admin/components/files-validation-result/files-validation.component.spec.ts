import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { FilesValidationDialogComponent } from './files-validation.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';
import { WorkspaceService } from '../../../workspace/services/workspace.service';
import { FileService } from '../../../shared/services/file/file.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';

describe('FilesValidationComponent', () => {
  let component: FilesValidationDialogComponent;
  let fixture: ComponentFixture<FilesValidationDialogComponent>;
  let workspaceService: jest.Mocked<WorkspaceService>;
  let fileService: jest.Mocked<FileService>;

  const createValidationResult = (testTaker: string, bookletNames: string[]) => ({
    testTaker,
    testTakerSchemaValid: true,
    booklets: {
      complete: true,
      missing: [],
      files: bookletNames.map(filename => ({ filename, exists: true }))
    },
    units: { complete: true, missing: [], files: [] },
    schemes: { complete: true, missing: [], files: [] },
    schemer: { complete: true, missing: [], files: [] },
    definitions: { complete: true, missing: [], files: [] },
    player: { complete: true, missing: [], files: [] },
    metadata: { complete: true, missing: [], files: [] }
  });

  const createBookletInfo = (bookletId: string, testletIds: string[]): BookletInfoDto => ({
    metadata: { id: bookletId },
    units: [],
    restrictions: [],
    testlets: testletIds.map(testletId => ({ id: testletId, units: [] }))
  });

  beforeEach(async () => {
    const workspaceServiceMock = {
      getWorkspaceSettings: jest.fn().mockReturnValue(of({
        ignoredUnits: [],
        ignoredBooklets: [],
        ignoredTestlets: []
      })),
      saveWorkspaceSettings: jest.fn().mockReturnValue(of(true)),
      markTestTakersAsExcluded: jest.fn(),
      markTestTakersAsConsidered: jest.fn(),
      resolveDuplicateTestTakers: jest.fn()
    };

    const fileServiceMock = {
      getBookletInfo: jest.fn(),
      validateFiles: jest.fn().mockReturnValue(of(true)),
      getUnitInfo: jest.fn(),
      downloadFile: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [FilesValidationDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatDialogRef,
          useValue: []
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { validationResults: [] }
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: WorkspaceService,
          useValue: workspaceServiceMock
        },
        {
          provide: FileService,
          useValue: fileServiceMock
        },
        {
          provide: TestResultService,
          useValue: { invalidateCache: jest.fn() }
        }
      ]
    }).compileComponents();

    workspaceService = TestBed.inject(WorkspaceService) as jest.Mocked<WorkspaceService>;
    fileService = TestBed.inject(FileService) as jest.Mocked<FileService>;

    fixture = TestBed.createComponent(FilesValidationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should calculate summary correctly', () => {
    // Mock data
    component.data = {
      validationResults: [
        {
          testTaker: 'test1',
          testTakerSchemaValid: true,
          booklets: { complete: true, missing: [], files: [{ filename: 'b1', exists: true }] },
          units: { complete: false, missing: ['u1'], files: [{ filename: 'u1', exists: false }] },
          schemes: { complete: true, missing: [], files: [] },
          schemer: { complete: true, missing: [], files: [] },
          definitions: { complete: true, missing: [], files: [] },
          player: { complete: true, missing: [], files: [] },
          metadata: { complete: true, missing: [], files: [] }
        },
        {
          testTaker: 'test2',
          testTakerSchemaValid: false,
          booklets: { complete: false, missing: ['b2', 'b3'], files: [{ filename: 'b2', exists: false }, { filename: 'b3', exists: false }] },
          units: { complete: true, missing: [], files: [{ filename: 'u2', exists: true }] },
          schemes: { complete: true, missing: [], files: [] },
          schemer: { complete: true, missing: [], files: [] },
          definitions: { complete: true, missing: [], files: [] },
          player: { complete: true, missing: [], files: [] },
          metadata: { complete: true, missing: [], files: [] }
        },
        {
          testTaker: 'test3',
          testTakerSchemaValid: true,
          booklets: { complete: false, missing: ['b2'], files: [{ filename: 'b2', exists: false }] }, // Duplicate missing file b2
          units: { complete: true, missing: [], files: [] },
          schemes: { complete: true, missing: [], files: [] },
          schemer: { complete: true, missing: [], files: [] },
          definitions: { complete: true, missing: [], files: [] },
          player: { complete: true, missing: [], files: [] },
          metadata: { complete: true, missing: [], files: [] }
        }
      ]
    };

    // Rebuild derived view data and summary after replacing injected data in test.
    (component as unknown as { rebuildValidationResults: () => void }).rebuildValidationResults();

    expect(component.summary.totalTestTakers).toBe(3);
    expect(component.summary.validTestTakerXmls).toBe(2);
    expect(component.summary.invalidTestTakerXmls).toBe(1);

    expect(component.summary.booklets.complete).toBe(1);
    expect(component.summary.booklets.incomplete).toBe(2);
    expect(component.summary.booklets.missingFiles).toBe(2);
    expect(component.summary.booklets.missingFileNames).toEqual(['b2', 'b3']);

    expect(component.summary.units.complete).toBe(2);
    expect(component.summary.units.incomplete).toBe(1);
    expect(component.summary.units.missingFiles).toBe(1);
    expect(component.summary.units.missingFileNames).toEqual(['u1']);
  });

  it('should ignore a testlet across all matching booklets', async () => {
    component.data = {
      workspaceId: 1,
      validationResults: [createValidationResult('test1', ['BOOK1', 'BOOK2', 'BOOK3'])]
    };

    (component as unknown as { rebuildValidationResults: () => void }).rebuildValidationResults();

    fileService.getBookletInfo.mockImplementation((_, bookletId: string) => {
      const id = bookletId.toUpperCase();
      if (id === 'BOOK1' || id === 'BOOK2') {
        return of(createBookletInfo(id, ['TL1']));
      }
      return of(createBookletInfo(id, ['TL2']));
    });

    await component.toggleTestletIgnoreForAllBooklets('BOOK1', 'TL1');

    expect(workspaceService.saveWorkspaceSettings).toHaveBeenCalled();
    const settingsCalls = workspaceService.saveWorkspaceSettings.mock.calls;
    const settings = settingsCalls[settingsCalls.length - 1][1];
    expect(settings.ignoredTestlets).toEqual(
      expect.arrayContaining([
        { bookletId: 'BOOK1', testletId: 'TL1' },
        { bookletId: 'BOOK2', testletId: 'TL1' }
      ])
    );
    expect(settings.ignoredTestlets).toHaveLength(2);
  });

  it('should restore a testlet across all matching booklets', async () => {
    component.data = {
      workspaceId: 1,
      validationResults: [createValidationResult('test1', ['BOOK1', 'BOOK2', 'BOOK3'])]
    };
    component.ignoredTestlets = [
      { bookletId: 'BOOK1', testletId: 'TL1' },
      { bookletId: 'BOOK2', testletId: 'TL1' },
      { bookletId: 'BOOK3', testletId: 'TL9' }
    ];

    (component as unknown as { rebuildValidationResults: () => void }).rebuildValidationResults();

    fileService.getBookletInfo.mockImplementation((_, bookletId: string) => {
      const id = bookletId.toUpperCase();
      if (id === 'BOOK1' || id === 'BOOK2') {
        return of(createBookletInfo(id, ['TL1']));
      }
      return of(createBookletInfo(id, ['TL2']));
    });

    await component.toggleTestletIgnoreForAllBooklets('BOOK1', 'TL1');

    expect(workspaceService.saveWorkspaceSettings).toHaveBeenCalled();
    const settingsCalls = workspaceService.saveWorkspaceSettings.mock.calls;
    const settings = settingsCalls[settingsCalls.length - 1][1];
    expect(settings.ignoredTestlets).toEqual(
      expect.arrayContaining([{ bookletId: 'BOOK3', testletId: 'TL9' }])
    );
    expect(settings.ignoredTestlets).not.toEqual(
      expect.arrayContaining([
        { bookletId: 'BOOK1', testletId: 'TL1' },
        { bookletId: 'BOOK2', testletId: 'TL1' }
      ])
    );
  });
});
