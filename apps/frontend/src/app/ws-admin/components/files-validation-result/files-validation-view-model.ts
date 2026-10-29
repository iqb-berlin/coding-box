import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';

export type FileStatus = {
  filename: string;
  exists: boolean;
  schemaValid?: boolean;
  schemaErrors?: string[];
  schemaWarnings?: string[];
  ignored?: boolean;
  parents?: string[];
};

export type TestletDto = {
  id: string;
  label?: string;
  ignored?: boolean;
};

export type DataValidation = {
  complete: boolean;
  missing: string[];
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
  missingRefsPerUnit?: { unit: string; missingRefs: string[] }[];
  files: FileStatus[];
  testlets?: TestletDto[];
};

export type FilteredTestTaker = {
  testTaker: string;
  mode: string;
  login: string;
  consider?: boolean | null;
};

export type FilesValidation = {
  testTaker: string,
  testTakerSchemaValid?: boolean;
  testTakerSchemaErrors?: string[];
  booklets: DataValidation;
  units: DataValidation;
  schemes: DataValidation;
  schemer: DataValidation;
  definitions: DataValidation;
  player: DataValidation;
  metadata: DataValidation;
};

export interface ExpandedFilesLists {
  booklets: boolean;
  units: boolean;
  schemes: boolean;
  schemer: boolean;
  definitions: boolean;
  player: boolean;
  metadata: boolean;
}

export interface SectionSummary {
  complete: number;
  incomplete: number;
  missingFiles: number;
  missingFileNames: string[];
}

export interface ValidationSummary {
  totalTestTakers: number;
  validTestTakerXmls: number;
  invalidTestTakerXmls: number;
  booklets: SectionSummary;
  units: SectionSummary;
  schemes: SectionSummary;
  schemer: SectionSummary;
  definitions: SectionSummary;
  player: SectionSummary;
  metadata: SectionSummary;
}

export type ValidationSectionKey = keyof ExpandedFilesLists;

export interface MissingRelationInfo {
  all: string[];
  preview: string[];
  remaining: number;
}

export interface DerivedDataValidation extends DataValidation {
  existingCount: number;
  missingCount: number;
  filteredMissingCount: number;
  isCompleteForView: boolean;
  relatedEntitiesByMissingFile: Record<string, MissingRelationInfo>;
}

export type FilesValidationView = Omit<FilesValidation, ValidationSectionKey> & {
  [K in ValidationSectionKey]: DerivedDataValidation;
};

export interface ValidationIgnoreContext {
  ignoredUnits: ReadonlySet<string>;
  ignoredBooklets: ReadonlySet<string>;
  ignoredTestlets: readonly { bookletId: string; testletId: string }[];
  bookletData: ReadonlyMap<string, BookletInfoDto>;
}

const sections: readonly ValidationSectionKey[] = ['booklets', 'units', 'schemes', 'schemer', 'definitions', 'player', 'metadata'];
const relationPreviewLimit = 3;

export function createEmptyValidationSummary(): ValidationSummary {
  const section = (): SectionSummary => ({
    complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
  });
  return {
    totalTestTakers: 0,
    validTestTakerXmls: 0,
    invalidTestTakerXmls: 0,
    booklets: section(),
    units: section(),
    schemes: section(),
    schemer: section(),
    definitions: section(),
    player: section(),
    metadata: section()
  };
}

export function isValidationUnitIgnored(unit: string, context: ValidationIgnoreContext, parents?: string[]): boolean {
  if (!unit) return false;
  const normalizedUnit = unit.toUpperCase();
  if (context.ignoredUnits.has(normalizedUnit)) return true;
  return !!parents?.some(bookletId => {
    const booklet = bookletId.toUpperCase();
    if (context.ignoredBooklets.has(booklet)) return true;
    return context.bookletData.get(booklet)?.testlets?.some(testlet => (
      !!booklet && !!testlet.id && context.ignoredTestlets.some(ignored => ignored.bookletId === booklet && ignored.testletId === testlet.id.toUpperCase()) &&
      (testlet.units || []).some(candidate => candidate.id.toUpperCase() === normalizedUnit)
    )) || false;
  });
}

function createMissingRelationInfo(values: string[]): MissingRelationInfo {
  const all = [...new Set(values)];
  return { all, preview: all.slice(0, relationPreviewLimit), remaining: Math.max(0, all.length - relationPreviewLimit) };
}

function findBookletsForMissingUnit(data: DataValidation, unit: string): string[] {
  if (!data.missingUnitsPerBooklet || data.missingUnitsPerBooklet.length === 0 || !unit) {
    return [];
  }
  const normalizedUnit = unit.toUpperCase().trim();
  return data.missingUnitsPerBooklet
    .filter(entry => (entry.missingUnits || []).map(u => u.toUpperCase().trim()).includes(normalizedUnit))
    .map(entry => entry.booklet);
}

function findUnitsForMissingRef(data: DataValidation, ref: string): string[] {
  if (!data.missingRefsPerUnit || data.missingRefsPerUnit.length === 0 || !ref) {
    return [];
  }

  const normalize = (value: string): { full: string; base: string; noExt: string } => {
    const full = (value || '').trim().toUpperCase().replace(/\\/g, '/');
    const base = full.includes('/') ? (full.split('/').pop() || full) : full;
    const dot = base.lastIndexOf('.');
    const noExt = dot > 0 ? base.substring(0, dot) : base;
    return { full, base, noExt };
  };

  const target = normalize(ref);

  const matches = (candidateRaw: string): boolean => {
    const candidate = normalize(candidateRaw);
    return (
      candidate.full === target.full ||
      candidate.base === target.base ||
      candidate.noExt === target.noExt
    );
  };

  return data.missingRefsPerUnit
    .filter(entry => (entry.missingRefs || []).some(r => matches(r || '')))
    .map(entry => entry.unit);
}

function createDerivedValidation(
  data: DataValidation,
  section: ValidationSectionKey,
  context: ValidationIgnoreContext
): DerivedDataValidation {
  const missing = data.files.filter(file => !file.exists);
  const relatedEntitiesByMissingFile: Record<string, MissingRelationInfo> = {};
  if (section !== 'booklets') {
    missing.forEach(file => {
      const related = section === 'units' ? findBookletsForMissingUnit(data, file.filename) : findUnitsForMissingRef(data, file.filename);
      if (related.length) relatedEntitiesByMissingFile[file.filename] = createMissingRelationInfo(related);
    });
  }
  return {
    ...data,
    existingCount: data.files.filter(file => file.exists).length,
    missingCount: missing.length,
    filteredMissingCount: section === 'units' ? missing.filter(file => !isValidationUnitIgnored(file.filename, context)).length : missing.length,
    isCompleteForView: data.complete || !data.missing || data.missing.length === 0 ||
      (section === 'units' && data.missing.every(unit => isValidationUnitIgnored(unit, context))),
    relatedEntitiesByMissingFile
  };
}

function createValidationView(result: FilesValidation, context: ValidationIgnoreContext): FilesValidationView {
  return {
    ...result,
    booklets: createDerivedValidation(result.booklets, 'booklets', context),
    units: createDerivedValidation(result.units, 'units', context),
    schemes: createDerivedValidation(result.schemes, 'schemes', context),
    schemer: createDerivedValidation(result.schemer, 'schemer', context),
    definitions: createDerivedValidation(result.definitions, 'definitions', context),
    player: createDerivedValidation(result.player, 'player', context),
    metadata: createDerivedValidation(result.metadata, 'metadata', context)
  };
}

/** Derives display values only. Selection, requests and cleanup commands stay in the dialog. */
export function buildFilesValidationViewModel(raw: FilesValidation[], context: ValidationIgnoreContext): {
  results: FilesValidationView[];
  summary: ValidationSummary;
} {
  const results = raw.map(result => createValidationView(result, context));
  const summary = createEmptyValidationSummary();
  summary.totalTestTakers = results.length;
  const missingBySection = new Map<ValidationSectionKey, Set<string>>(sections.map(section => [section, new Set<string>()]));
  results.forEach(result => {
    if (result.testTakerSchemaValid === false) summary.invalidTestTakerXmls += 1;
    else summary.validTestTakerXmls += 1;
    sections.forEach(section => {
      const data = result[section];
      if (data.isCompleteForView) summary[section].complete += 1;
      else summary[section].incomplete += 1;
      data.files.forEach(file => {
        if (!file.exists && (section !== 'units' || !isValidationUnitIgnored(file.filename, context))) {
          missingBySection.get(section)?.add(file.filename);
        }
      });
    });
  });
  sections.forEach(section => {
    summary[section].missingFileNames = [...missingBySection.get(section) || []].sort();
    summary[section].missingFiles = summary[section].missingFileNames.length;
  });
  return { results, summary };
}
