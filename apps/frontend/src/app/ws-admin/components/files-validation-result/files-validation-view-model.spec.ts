import {
  buildFilesValidationViewModel,
  createEmptyValidationSummary,
  DataValidation,
  FilesValidation,
  isValidationUnitIgnored,
  ValidationIgnoreContext,
  ValidationSectionKey
} from './files-validation-view-model';

const complete = (): DataValidation => ({ complete: true, missing: [], files: [] });
const result = (testTaker = 'TESTTAKER'): FilesValidation => ({
  testTaker,
  booklets: complete(),
  units: complete(),
  schemes: complete(),
  schemer: complete(),
  definitions: complete(),
  player: complete(),
  metadata: complete()
});
const context = (): ValidationIgnoreContext => ({
  ignoredUnits: new Set(), ignoredBooklets: new Set(), ignoredTestlets: [], bookletData: new Map()
});

describe('File validation display model', () => {
  it('returns independent empty summaries without sharing mutable section arrays', () => {
    const first = createEmptyValidationSummary();
    first.units.missingFileNames.push('UNIT');
    expect(first.booklets.missingFileNames).toEqual([]);
    expect(buildFilesValidationViewModel([], context())).toEqual({ results: [], summary: createEmptyValidationSummary() });
  });

  it('counts invalid XMLs explicitly and deduplicates sorted missing names across testtakers', () => {
    const first = result('A');
    first.testTakerSchemaValid = false;
    first.units = { complete: false, missing: ['Z', 'A'], files: [{ filename: 'Z', exists: false }, { filename: 'A', exists: false }] };
    const second = result('B');
    second.units = { complete: false, missing: ['A'], files: [{ filename: 'A', exists: false }, { filename: 'OK', exists: true }] };
    const view = buildFilesValidationViewModel([first, second], context());
    expect(view.summary).toMatchObject({ totalTestTakers: 2, validTestTakerXmls: 1, invalidTestTakerXmls: 1 });
    expect(view.summary.units).toEqual({
      complete: 0, incomplete: 2, missingFiles: 2, missingFileNames: ['A', 'Z']
    });
    expect(view.results[1].units.existingCount).toBe(1);
  });

  it('keeps raw missing counts while excluding ignored units from display counts and completeness', () => {
    const raw = result();
    raw.units = { complete: false, missing: ['unit'], files: [{ filename: 'unit', exists: false }] };
    const ignored = { ...context(), ignoredUnits: new Set(['UNIT']) };
    const view = buildFilesValidationViewModel([raw], ignored);
    expect(view.results[0].units).toMatchObject({ missingCount: 1, filteredMissingCount: 0, isCompleteForView: true });
    expect(view.summary.units).toEqual({
      complete: 1, incomplete: 0, missingFiles: 0, missingFileNames: []
    });
    expect(buildFilesValidationViewModel([raw], context()).results[0].units.isCompleteForView).toBe(false);
  });

  it.each([true, false])('preserves the empty-missing-list completion rule when complete is %s', completeFlag => {
    const raw = result();
    raw.definitions = { complete: completeFlag, missing: [], files: [{ filename: 'missing', exists: false }] };
    const view = buildFilesValidationViewModel([raw], context());
    expect(view.results[0].definitions.isCompleteForView).toBe(true);
    expect(view.summary.definitions.missingFileNames).toEqual(['missing']);
  });

  it('finds related booklets case-insensitively and keeps a stable unique three-entry preview', () => {
    const raw = result();
    raw.units = {
      complete: false,
      missing: ['UNIT'],
      files: [{ filename: 'UNIT', exists: false }],
      missingUnitsPerBooklet: ['B1', 'B2', 'B1', 'B3', 'B4', 'B5'].map(booklet => ({ booklet, missingUnits: [' unit '] }))
    };
    expect(buildFilesValidationViewModel([raw], context()).results[0].units.relatedEntitiesByMissingFile.UNIT).toEqual({
      all: ['B1', 'B2', 'B3', 'B4', 'B5'], preview: ['B1', 'B2', 'B3'], remaining: 2
    });
  });

  it.each(['schemes', 'schemer', 'definitions', 'player', 'metadata'] as ValidationSectionKey[])(
    'matches related units by full path, basename and extension-free name for %s', section => {
      const raw = result();
      raw[section] = {
        complete: false,
        missing: ['folder/FILE.ext'],
        files: [{ filename: 'folder/FILE.ext', exists: false }],
        missingRefsPerUnit: [
          { unit: 'A', missingRefs: [' FOLDER\\file.ext '] },
          { unit: 'B', missingRefs: ['file.ext'] },
          { unit: 'C', missingRefs: ['FILE'] },
          { unit: 'NO', missingRefs: ['another.ext'] }
        ]
      };
      expect(buildFilesValidationViewModel([raw], context()).results[0][section].relatedEntitiesByMissingFile['folder/FILE.ext'].all)
        .toEqual(['A', 'B', 'C']);
    }
  );

  it('does not project related entities for booklet files', () => {
    const raw = result();
    raw.booklets = {
      complete: false, missing: ['B'], files: [{ filename: 'B', exists: false }], missingRefsPerUnit: [{ unit: 'A', missingRefs: ['B'] }]
    };
    expect(buildFilesValidationViewModel([raw], context()).results[0].booklets.relatedEntitiesByMissingFile).toEqual({});
  });

  it('preserves direct, booklet and testlet exclusions without applying another booklet’s testlet', () => {
    const ignored: ValidationIgnoreContext = {
      ignoredUnits: new Set(['DIRECT']),
      ignoredBooklets: new Set(['BOOK-IGNORED']),
      ignoredTestlets: [{ bookletId: 'BOOK', testletId: 'TL' }],
      bookletData: new Map([['BOOK', {
        metadata: { id: 'BOOK' },
        units: [],
        restrictions: [],
        testlets: [
          { id: 'tl', units: [{ id: 'unit', position: 1 }] }
        ]
      }]])
    };
    expect(isValidationUnitIgnored('direct', ignored)).toBe(true);
    expect(isValidationUnitIgnored('anything', ignored, ['book-ignored'])).toBe(true);
    expect(isValidationUnitIgnored('UNIT', ignored, ['book'])).toBe(true);
    expect(isValidationUnitIgnored('OTHER', ignored, ['book'])).toBe(false);
    expect(isValidationUnitIgnored('UNIT', ignored, ['different-book'])).toBe(false);
    expect(isValidationUnitIgnored('UNIT', ignored)).toBe(false);
    expect(isValidationUnitIgnored('', ignored, ['book-ignored'])).toBe(false);
  });

  it('keeps empty testlet IDs outside inherited exclusions', () => {
    const ignored: ValidationIgnoreContext = {
      ...context(),
      ignoredTestlets: [{ bookletId: 'BOOK', testletId: '' }],
      bookletData: new Map([['BOOK', {
        metadata: { id: 'BOOK' },
        units: [],
        restrictions: [],
        testlets: [
          { id: '', units: [{ id: 'UNIT', position: 1 }] }
        ]
      }]])
    };
    expect(isValidationUnitIgnored('UNIT', ignored, ['BOOK'])).toBe(false);
  });

  it('does not mutate input validation results or exclusion collections', () => {
    const raw = result();
    const ignored = context();
    const before = JSON.stringify(raw);
    buildFilesValidationViewModel([raw], ignored);
    expect(JSON.stringify(raw)).toBe(before);
    expect([...ignored.ignoredUnits]).toEqual([]);
    expect([...ignored.bookletData]).toEqual([]);
  });
});
