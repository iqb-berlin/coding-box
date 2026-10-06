import { MetadataResolver } from '@iqb/metadata-resolver';
import { computed, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { FilesValidationDialogComponent } from './files-validation.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';
import { WorkspaceService } from '../../../workspace/services/workspace.service';
import { FileService } from '../../../shared/services/file/file.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import {
  DuplicateTestTaker, FileValidationResultDto, UnusedTestFile
} from '../../../../../../../api-dto/files/file-validation-result.dto';

describe('FilesValidationComponent', () => {
  let closing: Subject<void>;
  let component: FilesValidationDialogComponent;
  let fixture: ComponentFixture<FilesValidationDialogComponent>;
  let workspaceService: jest.Mocked<WorkspaceService>;
  let fileService: jest.Mocked<FileService>;

  afterEach(() => jest.restoreAllMocks());

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
    closing = new Subject<void>();
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
      getFilesList: jest.fn(),
      getBookletInfo: jest.fn(),
      getCodingSchemeFile: jest.fn(),
      getTestTakerContentXml: jest.fn(),
      validateFiles: jest.fn().mockReturnValue(of(true)),
      getUnitInfo: jest.fn(),
      downloadFile: jest.fn(),
      deleteFiles: jest.fn(),
      deleteFilesWithResult: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [FilesValidationDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialog, useValue: { open: jest.fn() } },
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatDialogRef,
          useValue: { beforeClosed: () => closing, close: jest.fn() }
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { validationResults: [] }
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn().mockReturnValue({ dismiss: jest.fn() }) }
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
    }).overrideProvider(MatDialog, { useValue: { open: jest.fn() } }).compileComponents();

    workspaceService = TestBed.inject(WorkspaceService) as jest.Mocked<WorkspaceService>;
    fileService = TestBed.inject(FileService) as jest.Mocked<FileService>;

    fixture = TestBed.createComponent(FilesValidationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it.each(['constructor', 'refresh'])('initializes a large duplicate selection in linear work during %s', path => {
    const duplicates: DuplicateTestTaker[] = Array.from({ length: 2000 }, (_, index) => ({
      login: `login-${index}`,
      occurrences: [
        { testTaker: 'FIRST_FILE', mode: 'run-hot-return' },
        { testTaker: 'SECOND_FILE', mode: 'run-hot-return' }
      ]
    }));
    duplicates.push({ login: 'empty', occurrences: [] });
    const previousSelection = new Map([['obsolete', 'OLD_FILE']]);
    component.duplicateSelection.set(previousSelection);
    let copiedSelectionEntries = 0;
    const originalIterator = Map.prototype[Symbol.iterator];
    const iteratorSpy = jest.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function countSelectionCopies(this: Map<unknown, unknown>) {
      // Count entries copied from selection maps, including intermediate snapshots.
      if (this.get('login-0') === 'FIRST_FILE') copiedSelectionEntries += this.size;
      return originalIterator.call(this);
    });
    try {
      if (path === 'constructor') {
        fixture.destroy();
        const data = TestBed.inject(MAT_DIALOG_DATA) as FilesValidationDialogComponent['data'];
        data.duplicateTestTakers = duplicates;
        fixture = TestBed.createComponent(FilesValidationDialogComponent);
        component = fixture.componentInstance;
      } else {
        (component as unknown as {
          applyValidationResultData: (result: FileValidationResultDto) => void;
        }).applyValidationResultData({
          testTakersFound: true,
          validationResults: [],
          duplicateTestTakers: duplicates
        });
      }
    } finally {
      iteratorSpy.mockClear();
      iteratorSpy.mockRestore();
    }

    expect(component.duplicateSelection().size).toBe(2000);
    expect(component.duplicateSelection().get('login-0')).toBe('FIRST_FILE');
    expect(component.duplicateSelection().get('login-1999')).toBe('FIRST_FILE');
    expect(component.duplicateSelection().has('empty')).toBe(false);
    expect(component.duplicateSelection().has('obsolete')).toBe(false);
    expect(previousSelection).toEqual(new Map([['obsolete', 'OLD_FILE']]));
    expect(copiedSelectionEntries).toBeLessThanOrEqual(2 * duplicates.length);
  });

  it('preserves expansion states for retained files and drops obsolete files on refresh', () => {
    const expanded = {
      booklets: true,
      units: false,
      schemes: false,
      schemer: false,
      definitions: false,
      player: false,
      metadata: true
    };
    const previous = new Map([['KEEP', expanded], ['OBSOLETE', expanded]]);
    component.expandedFilesLists.set(previous);
    (component as unknown as {
      applyValidationResultData: (result: FileValidationResultDto) => void;
    }).applyValidationResultData({
      testTakersFound: true,
      validationResults: [createValidationResult('KEEP', []), createValidationResult('NEW', [])]
    });

    expect(component.expandedFilesLists().get('KEEP')).toEqual(expanded);
    expect(component.expandedFilesLists().get('NEW')).toEqual({
      ...expanded, booklets: false, metadata: false
    });
    expect(component.expandedFilesLists().has('OBSOLETE')).toBe(false);
    expect(previous.has('OBSOLETE')).toBe(true);
  });

  it('updates reactive expansion readers without changing previous snapshots', () => {
    const sections = {
      booklets: false,
      units: false,
      schemes: false,
      schemer: false,
      definitions: false,
      player: false,
      metadata: false
    };
    const previous = new Map([['FILE', sections], ['OTHER', sections]]);
    component.expandedFilesLists.set(previous);
    const expanded = computed(() => component.isFilesListExpanded('FILE', 'booklets'));
    expect(expanded()).toBe(false);

    component.toggleFilesList('FILE', 'booklets');

    expect(expanded()).toBe(true);
    expect(previous.get('FILE')?.booklets).toBe(false);
    expect(component.isFilesListExpanded('OTHER', 'booklets')).toBe(false);
    component.toggleFilesList('FILE', 'booklets');
    expect(expanded()).toBe(false);
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

    expect(component.summary().totalTestTakers).toBe(3);
    expect(component.summary().validTestTakerXmls).toBe(2);
    expect(component.summary().invalidTestTakerXmls).toBe(1);

    expect(component.summary().booklets.complete).toBe(1);
    expect(component.summary().booklets.incomplete).toBe(2);
    expect(component.summary().booklets.missingFiles).toBe(2);
    expect(component.summary().booklets.missingFileNames).toEqual(['b2', 'b3']);

    expect(component.summary().units.complete).toBe(2);
    expect(component.summary().units.incomplete).toBe(1);
    expect(component.summary().units.missingFiles).toBe(1);
    expect(component.summary().units.missingFileNames).toEqual(['u1']);
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
    component.ignoredTestlets.set([
      { bookletId: 'BOOK1', testletId: 'TL1' },
      { bookletId: 'BOOK2', testletId: 'TL1' },
      { bookletId: 'BOOK3', testletId: 'TL9' }
    ]);

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

  it('should delete all selected unused file IDs and refresh validation data', () => {
    const unusedFiles: UnusedTestFile[] = [
      {
        id: 101, fileId: 'u1', filename: 'unit-1.xml', fileType: 'Unit'
      },
      {
        id: 102, fileId: 'u2', filename: 'unit-2.xml', fileType: 'Unit'
      },
      {
        id: 103, fileId: 'b1', filename: 'booklet.xml', fileType: 'Booklet'
      }
    ];
    const refreshSpy = jest
      .spyOn(
        component as unknown as {
          refreshValidationData: (message?: string) => void;
        },
        'refreshValidationData'
      )
      .mockImplementation(() => undefined);

    component.data = {
      workspaceId: 1,
      validationResults: [],
      unusedTestFiles: unusedFiles
    };
    component.unusedTestFiles.set([...unusedFiles]);
    component.unusedFilesSelection.select(...unusedFiles);
    fileService.deleteFilesWithResult.mockReturnValue(of({
      success: true,
      requestHandled: true
    }));

    component.deleteSelectedUnusedFiles();

    expect(fileService.deleteFilesWithResult).toHaveBeenCalledWith(1, [101, 102, 103]);
    expect(component.filesDeleted()).toBe(true);
    expect(component.unusedTestFiles()).toEqual([]);
    expect(component.unusedFilesSelection.selected).toHaveLength(0);
    expect(refreshSpy).toHaveBeenCalledWith('Validierungsergebnisse wurden aktualisiert');
  });

  it('should refresh validation data when unused file deletion was handled but incomplete', () => {
    const unusedFiles: UnusedTestFile[] = [
      {
        id: 101, fileId: 'u1', filename: 'unit-1.xml', fileType: 'Unit'
      },
      {
        id: 102, fileId: 'u2', filename: 'unit-2.xml', fileType: 'Unit'
      }
    ];
    const refreshSpy = jest
      .spyOn(
        component as unknown as {
          refreshValidationData: (message?: string) => void;
        },
        'refreshValidationData'
      )
      .mockImplementation(() => undefined);

    component.data = {
      workspaceId: 1,
      validationResults: [],
      unusedTestFiles: unusedFiles
    };
    component.unusedTestFiles.set([...unusedFiles]);
    component.unusedFilesSelection.select(...unusedFiles);
    fileService.deleteFilesWithResult.mockReturnValue(of({
      success: false,
      requestHandled: true
    }));

    component.deleteSelectedUnusedFiles();

    expect(component.filesDeleted()).toBe(true);
    expect(component.unusedFilesSelection.selected).toHaveLength(0);
    expect(refreshSpy).toHaveBeenCalledWith();
  });
  it.each(['booklet', 'unit', 'scheme'].flatMap(kind => ['destroy', 'closing'].flatMap(end => ['success', 'error'].map(outcome => ({ kind, end, outcome })))))('ignores delayed $kind $outcome after $end', async ({ kind, end, outcome }) => {
    const response = new Subject<never>();
    fileService.getBookletInfo.mockReturnValue(response);
    fileService.getUnitInfo.mockReturnValue(response);
    fileService.getCodingSchemeFile.mockReturnValue(response);
    component.data.workspaceId = 1;
    if (kind === 'booklet') component.openBookletInfo('BOOKLET');
    else if (kind === 'unit') component.openUnitInfo('UNIT');
    else component.openSchemeFile('SCHEME');
    const snack = TestBed.inject(MatSnackBar).open as jest.Mock;
    const loading = snack.mock.results[0].value;
    if (end === 'destroy') fixture.destroy();
    else closing.next();
    if (outcome === 'error') response.error(new Error('Synthetic error'));
    else {
      response.next((kind === 'scheme' ? { base64Data: btoa('{}'), filename: 'SCHEME' } : {}) as never);
      response.complete();
    }
    await fixture.whenStable();
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    expect(snack).toHaveBeenCalledTimes(1);
    expect(loading.dismiss).toHaveBeenCalled();
  });

  it.each(['destroy', 'closing'].flatMap(end => ['xml', 'empty'].map(outcome => ({ end, outcome }))))('ignores delayed test taker $outcome after $end', async ({ end, outcome }) => {
    const response = new Subject<string | null>();
    fileService.getTestTakerContentXml.mockReturnValue(response);
    component.data.workspaceId = 1;
    component.showTestTakerXml('TESTTAKER');
    if (end === 'destroy') fixture.destroy();
    else closing.next();
    response.next(outcome === 'xml' ? '<TestTakers/>' : null);
    response.complete();
    await fixture.whenStable();
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
  });

  it.each(['booklet', 'unit', 'scheme', 'xml'])('opens delayed %s information while the parent remains open', async kind => {
    const response = new Subject<never>();
    fileService.getBookletInfo.mockReturnValue(response);
    fileService.getUnitInfo.mockReturnValue(response);
    fileService.getCodingSchemeFile.mockReturnValue(response);
    fileService.getTestTakerContentXml.mockReturnValue(response);
    component.data.workspaceId = 1;
    if (kind === 'booklet') component.openBookletInfo('BOOKLET');
    else if (kind === 'unit') component.openUnitInfo('UNIT');
    else if (kind === 'scheme') component.openSchemeFile('SCHEME');
    else component.showTestTakerXml('TESTTAKER');
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    let data: unknown = {};
    if (kind === 'scheme') data = { base64Data: btoa('{}'), filename: 'SCHEME' };
    else if (kind === 'xml') data = '<TestTakers/>';
    response.next(data as never);
    response.complete();
    await fixture.whenStable();
    expect(TestBed.inject(MatDialog).open).toHaveBeenCalledTimes(1);
    const snack = TestBed.inject(MatSnackBar).open as jest.Mock;
    if (kind !== 'xml') expect(snack.mock.results[0].value.dismiss).toHaveBeenCalled();
  });

  it.each(['booklet', 'unit', 'scheme'])('retries %s information after a delayed error', async kind => {
    const failed = new Subject<never>();
    const retry = new Subject<never>();
    const request = { booklet: fileService.getBookletInfo, unit: fileService.getUnitInfo, scheme: fileService.getCodingSchemeFile }[kind]!;
    request.mockReturnValueOnce(failed).mockReturnValueOnce(retry);
    component.data.workspaceId = 1;
    const open = () => {
      if (kind === 'booklet') component.openBookletInfo('BOOKLET');
      else if (kind === 'unit') component.openUnitInfo('UNIT');
      else component.openSchemeFile('SCHEME');
    };
    open();
    failed.error(new Error('Synthetic error'));
    await fixture.whenStable();
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    expect(TestBed.inject(MatSnackBar).open).toHaveBeenLastCalledWith(expect.stringContaining('Fehler beim Laden'), 'Fehler', { duration: 3000 });
    open();
    retry.next((kind === 'scheme' ? { base64Data: btoa('{}'), filename: 'SCHEME' } : {}) as never);
    retry.complete();
    await fixture.whenStable();
    expect(TestBed.inject(MatDialog).open).toHaveBeenCalledTimes(1);
  });
  it.each(['search', 'download', 'unit-profile', 'item-profile'].flatMap(stage => ['destroy', 'closing', 'open'].flatMap(end => ['success', 'error'].map(outcome => ({ stage, end, outcome })))))('handles metadata $stage $outcome with parent $end', async ({ stage, end, outcome }) => {
    const response = new Subject<never>();
    let resolveProfile!: (value: never) => void;
    let rejectProfile!: (error: Error) => void;
    const profileResponse = new Promise<never>((resolve, reject) => { resolveProfile = resolve; rejectProfile = reject; });
    let reached!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const files = { data: [{ id: 17, filename: 'metadata.vomd' }] };
    const download = { base64Data: btoa(JSON.stringify({ profiles: [{ profileId: 'UNIT_PROFILE' }], items: [{ profiles: [{ profileId: 'ITEM_PROFILE' }] }] })), filename: 'metadata.vomd' };
    fileService.getFilesList.mockImplementation(() => {
      if (stage === 'search') { reached(); return response; }
      return of(files as never);
    });
    fileService.downloadFile.mockImplementation(() => {
      if (stage === 'download') { reached(); return response; }
      return of(download);
    });
    const profiles = jest.spyOn(MetadataResolver.prototype, 'loadProfileWithVocabularies').mockImplementation(url => {
      if ((stage === 'unit-profile' && url === 'UNIT_PROFILE') || (stage === 'item-profile' && url === 'ITEM_PROFILE')) {
        reached(); return profileResponse;
      }
      return Promise.resolve({ profile: {}, vocabularies: [] } as never);
    });
    component.data.workspaceId = 1;
    const operation = component.openMetadataFile('metadata.vomd');
    await ready;
    const snack = TestBed.inject(MatSnackBar).open as jest.Mock;
    const loading = snack.mock.results[0].value;
    if (end === 'destroy') fixture.destroy();
    else if (end === 'closing') closing.next();
    if (end !== 'open') {
      expect(loading.dismiss).toHaveBeenCalled();
      await operation;
      expect(response.observed).toBe(false);
    }
    if (stage === 'search' || stage === 'download') {
      if (outcome === 'error') response.error(new Error('Synthetic error'));
      else { response.next((stage === 'search' ? files : download) as never); response.complete(); }
    } else if (outcome === 'error') rejectProfile(new Error('Synthetic error'));
    else resolveProfile({ profile: {}, vocabularies: [] } as never);
    await operation;
    expect(TestBed.inject(MatDialog).open).toHaveBeenCalledTimes(end === 'open' && outcome === 'success' ? 1 : 0);
    expect(snack).toHaveBeenCalledTimes(end === 'open' && outcome === 'error' ? 2 : 1);
    expect(loading.dismiss).toHaveBeenCalled();
    if (stage === 'search' && end !== 'open') expect(fileService.downloadFile).not.toHaveBeenCalled();
    const expectedProfileCalls = {
      search: 0, download: 0, 'unit-profile': 1, 'item-profile': 2
    };
    expect(profiles).toHaveBeenCalledTimes(end === 'open' && outcome === 'success' ? 2 : expectedProfileCalls[stage]);
    expect(closing.observed).toBe(false);
    profiles.mockRestore();
  });
});
