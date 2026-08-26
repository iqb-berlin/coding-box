import type {
  ItemDatasetNotReachedScope,
  ItemMatrixCellFailureReason
} from '../../../../../../../api-dto/coding/export-request.dto';
import {
  ItemDatasetResponseKey,
  ItemDatasetSelectionKey
} from '../../../../../../../api-dto/coding/item-dataset-key';
import { statusNumberToString } from '../../utils/response-status-converter';
import {
  aggregateItemDatasetMissingStates
} from './item-dataset-missing-aggregation.util';
import type {
  ItemDatasetMissingState
} from './item-dataset-missing-aggregation.util';
import type { IqbStandardMissingId } from './missings-profiles.service';
import { ItemDatasetCellExportError } from './item-dataset-cell-export-error';
import { mapCodeForExport } from '../../../utils/coding-utils';

export interface ItemDatasetColumn {
  key: string;
  header: string;
  unitName: string;
  unitId: string;
  variableId: string;
  sourceVariableId: string;
  itemId: string;
  itemLabel: string;
  itemOrder: number;
  isDerived: boolean;
  sourceType?: string;
}

export interface ItemDatasetResponseValue {
  code: number | null;
  score: number | null;
  status: number | null;
}

export interface ItemDatasetBookletUnitPosition {
  unitId: string;
  order: number;
  testletKey: string;
}

export interface ItemDatasetBookletDesign {
  units: Map<string, ItemDatasetBookletUnitPosition>;
}

export interface ItemDatasetMissingValue {
  id: string;
  label: string;
  code: number;
  score: number | null;
}

export interface ItemDatasetProfile {
  byId: Map<IqbStandardMissingId, ItemDatasetMissingValue>;
  byCode: Map<number, ItemDatasetMissingValue>;
}

export interface ItemDatasetCellResolutionConfiguration {
  notReachedScope?: ItemDatasetNotReachedScope;
  recodeTrailingOmissions?: boolean;
}

export interface ResolvedItemDatasetCell {
  state: ItemDatasetMissingState;
  code: number | null;
  score: number | null;
  unresolved: boolean;
  activity: boolean;
  candidate: boolean;
  omission: boolean;
  failureReason?: ItemMatrixCellFailureReason;
}

interface DerivedStateResolution {
  state: ItemDatasetMissingState;
  failureReason?: ItemMatrixCellFailureReason;
  hasResolvedSource: boolean;
  hasOmittedSource: boolean;
  hasIneligibleSource: boolean;
}

const requiredMissingIds: IqbStandardMissingId[] = [
  'mir',
  'mci',
  'mbi_mbo',
  'mnr',
  'mbd'
];

export class ItemDatasetCellResolver {
  private static readonly yieldEveryOperations = 50;

  resolve(
    columns: ItemDatasetColumn[],
    design: ItemDatasetBookletDesign,
    responseValues: Map<string, ItemDatasetResponseValue>,
    profile: ItemDatasetProfile,
    derivedSources: Map<string, string[]>,
    configuration: ItemDatasetCellResolutionConfiguration
  ): ResolvedItemDatasetCell[] {
    const resolution = this.resolveIncrementally(
      columns,
      design,
      responseValues,
      profile,
      derivedSources,
      configuration
    );
    let step = resolution.next();
    while (!step.done) {
      step = resolution.next();
    }
    return step.value;
  }

  * resolveIncrementally(
    columns: ItemDatasetColumn[],
    design: ItemDatasetBookletDesign,
    responseValues: Map<string, ItemDatasetResponseValue>,
    profile: ItemDatasetProfile,
    derivedSources: Map<string, string[]>,
    configuration: ItemDatasetCellResolutionConfiguration
  ): Generator<void, ResolvedItemDatasetCell[], void> {
    const operationCounter = { value: 0 };
    const derivedWithoutResult: boolean[] = [];
    const initialCells: ResolvedItemDatasetCell[] = [];
    for (const column of columns) {
      yield* this.checkpoint(operationCounter);
      const value = responseValues.get(column.key);
      derivedWithoutResult.push(
        column.isDerived &&
          (!value || (value.code === null && value.score === null))
      );
      initialCells.push(
        design.units.has(column.unitId) ?
          this.resolveInitialCell(value, profile) :
          this.fromMissing(profile.byId.get('mbd')!)
      );
    }
    const sourceColumns = yield* this.getDerivedSourceColumns(
      columns,
      derivedSources,
      operationCounter
    );
    const sourceCells: ResolvedItemDatasetCell[] = [];
    for (const column of sourceColumns) {
      yield* this.checkpoint(operationCounter);
      sourceCells.push(
        design.units.has(column.unitId) ?
          this.resolveInitialCell(responseValues.get(column.key), profile) :
          this.fromMissing(profile.byId.get('mbd')!)
      );
    }
    const resolutionColumns = [...columns, ...sourceColumns];
    const resolutionCells = [...initialCells, ...sourceCells];
    yield* this.resolveNotReachedCandidates(
      resolutionCells,
      resolutionColumns,
      design,
      profile,
      configuration.notReachedScope || 'unit',
      configuration.recodeTrailingOmissions === true,
      operationCounter
    );
    const cells = resolutionCells.slice(0, columns.length);
    const cellsByResponseKey = new Map<string, ResolvedItemDatasetCell>();
    for (let index = 0; index < resolutionColumns.length; index += 1) {
      yield* this.checkpoint(operationCounter);
      const column = resolutionColumns[index];
      const cell = resolutionCells[index];
      cellsByResponseKey.set(column.key, cell);
      const sourceKey = ItemDatasetResponseKey.from(
        column.unitName,
        column.sourceVariableId
      ).toString();
      if (!cellsByResponseKey.has(sourceKey)) {
        cellsByResponseKey.set(sourceKey, cell);
      }
    }

    const recursion = new Set<string>();
    for (let index = 0; index < columns.length; index += 1) {
      yield* this.checkpoint(operationCounter);
      const column = columns[index];
      if (!derivedWithoutResult[index] || !design.units.has(column.unitId)) {
        continue;
      }
      const derivedResolution = yield* this.resolveDerivedState(
        column.key,
        responseValues,
        derivedSources,
        profile,
        cellsByResponseKey,
        recursion,
        operationCounter
      );
      const targetValue = responseValues.get(column.key);
      const isPartialInvalidResponse =
        column.sourceType === 'SUM_SCORE' &&
        this.hasStatus(targetValue, 'INVALID') &&
        derivedResolution.hasResolvedSource === true &&
        derivedResolution.hasOmittedSource === true &&
        derivedResolution.hasIneligibleSource === false &&
        !derivedResolution.failureReason;
      if (isPartialInvalidResponse) {
        cells[index] = this.fromMissing(profile.byId.get('mir')!);
      } else if (
        derivedResolution.state !== 'valid' &&
        derivedResolution.state !== 'error'
      ) {
        cells[index] = this.fromMissing(
          profile.byId.get(
            derivedResolution.state as IqbStandardMissingId
          )!
        );
      } else {
        cells[index] = this.unresolvedCell(
          derivedResolution.state === 'valid' ?
            'derived-result-missing' :
            derivedResolution.failureReason || 'derived-source-unresolved'
        );
      }
      cellsByResponseKey.set(column.key, cells[index]);
    }
    return cells;
  }

  getExportValue(
    cell: ResolvedItemDatasetCell,
    requestedValue: 'code' | 'score'
  ): string | number {
    const isMissing = requiredMissingIds.includes(
      cell.state as IqbStandardMissingId
    );
    if (cell.state === 'error' && cell.code === null && cell.score === null) {
      throw new ItemDatasetCellExportError(
        cell.failureReason || 'unresolved-cell'
      );
    }
    if (
      cell.state === 'error' &&
      cell.code !== null &&
      mapCodeForExport(cell.code) === null
    ) {
      throw new ItemDatasetCellExportError('invalid-code');
    }
    if (requestedValue === 'score') {
      if (cell.score !== null) {
        return cell.score;
      }
      if (
        isMissing ||
        (!cell.unresolved && cell.code !== null && cell.code < 0)
      ) {
        return 'NA';
      }
      throw new ItemDatasetCellExportError('missing-score');
    }
    if (cell.code === null) {
      throw new ItemDatasetCellExportError('missing-code');
    }
    return cell.code;
  }

  unresolvedCell(
    failureReason: ItemMatrixCellFailureReason = 'unresolved-cell'
  ): ResolvedItemDatasetCell {
    return {
      state: 'error',
      code: null,
      score: null,
      unresolved: true,
      activity: true,
      candidate: false,
      omission: false,
      failureReason
    };
  }

  private* getDerivedSourceColumns(
    columns: ItemDatasetColumn[],
    derivedSources: Map<string, string[]>,
    operationCounter: { value: number }
  ): Generator<void, ItemDatasetColumn[], void> {
    const directColumns = new Map<string, ItemDatasetColumn | null>();
    const registerDirectColumn = (
      key: string,
      column: ItemDatasetColumn
    ): void => {
      const existing = directColumns.get(key);
      if (
        existing &&
        ItemDatasetSelectionKey.from(
          existing.unitId,
          existing.itemId
        ).toString() !==
          ItemDatasetSelectionKey.from(column.unitId, column.itemId).toString()
      ) {
        directColumns.set(key, null);
      } else if (existing === undefined) {
        directColumns.set(key, column);
      }
    };
    for (const column of columns) {
      yield* this.checkpoint(operationCounter);
      registerDirectColumn(column.key, column);
      registerDirectColumn(
        ItemDatasetResponseKey.from(
          column.unitName,
          column.sourceVariableId
        ).toString(),
        column
      );
    }

    const sourceAnchors = new Map<string, ItemDatasetColumn | null>();
    const registerSourceAnchor = (
      sourceKey: string,
      anchor: ItemDatasetColumn
    ): void => {
      const existing = sourceAnchors.get(sourceKey);
      if (
        existing &&
        ItemDatasetSelectionKey.from(
          existing.unitId,
          existing.itemId
        ).toString() !==
          ItemDatasetSelectionKey.from(anchor.unitId, anchor.itemId).toString()
      ) {
        sourceAnchors.set(sourceKey, null);
      } else if (existing === undefined) {
        sourceAnchors.set(sourceKey, anchor);
      }
    };
    for (const column of columns) {
      yield* this.checkpoint(operationCounter);
      if (derivedSources.has(column.key)) {
        yield* this.visitDerivedSources(
          column.key,
          column,
          new Set(),
          derivedSources,
          directColumns,
          registerSourceAnchor,
          operationCounter
        );
      }
    }

    const sourceColumns: ItemDatasetColumn[] = [];
    for (const [sourceKey, anchor] of sourceAnchors.entries()) {
      yield* this.checkpoint(operationCounter);
      if (anchor === null) {
        continue;
      }
      const parsedKey = ItemDatasetResponseKey.parse(sourceKey);
      sourceColumns.push({
        ...anchor,
        key: sourceKey,
        variableId: parsedKey?.variableId || '',
        sourceVariableId: parsedKey?.variableId || '',
        isDerived: derivedSources.has(sourceKey)
      });
    }
    return sourceColumns;
  }

  private* visitDerivedSources(
    derivedKey: string,
    fallbackAnchor: ItemDatasetColumn,
    path: Set<string>,
    derivedSources: Map<string, string[]>,
    directColumns: Map<string, ItemDatasetColumn | null>,
    registerSourceAnchor: (
      sourceKey: string,
      anchor: ItemDatasetColumn
    ) => void,
    operationCounter: { value: number }
  ): Generator<void, void, void> {
    if (path.has(derivedKey)) {
      return;
    }
    const nextPath = new Set(path).add(derivedKey);
    for (const sourceKey of derivedSources.get(derivedKey) || []) {
      yield* this.checkpoint(operationCounter);
      const directAnchor = directColumns.get(sourceKey);
      const anchor = directAnchor || fallbackAnchor;
      if (directAnchor === undefined) {
        registerSourceAnchor(sourceKey, anchor);
      }
      if (derivedSources.has(sourceKey)) {
        yield* this.visitDerivedSources(
          sourceKey,
          anchor,
          nextPath,
          derivedSources,
          directColumns,
          registerSourceAnchor,
          operationCounter
        );
      }
    }
  }

  private resolveInitialCell(
    value: ItemDatasetResponseValue | undefined,
    profile: ItemDatasetProfile
  ): ResolvedItemDatasetCell {
    if (value && (value.code !== null || value.score !== null)) {
      if (value.code === -3 || value.code === -4) {
        return this.fromMissing(
          profile.byId.get(value.code === -3 ? 'mir' : 'mci')!
        );
      }
      const storedMissing =
        value.code !== null && value.code < 0 ?
          profile.byCode.get(value.code) :
          undefined;
      if (storedMissing && value.score === storedMissing.score) {
        return {
          ...this.fromMissing(storedMissing),
          code: value.code,
          score: value.score
        };
      }
      return {
        state:
          (value.code !== null && value.code >= 0) ||
          (value.code === null && value.score !== null) ?
            'valid' :
            'error',
        code: value.code,
        score: value.score,
        unresolved: value.code === null,
        activity: true,
        candidate: false,
        omission: false
      };
    }

    const status =
      value?.status === null || value?.status === undefined ?
        null :
        statusNumberToString(value.status);
    if (status === 'INVALID') {
      return this.fromMissing(profile.byId.get('mir')!);
    }
    if (status === 'CODING_ERROR') {
      return this.fromMissing(profile.byId.get('mci')!);
    }
    if (
      status === 'UNSET' ||
      status === 'DISPLAYED' ||
      status === 'PARTLY_DISPLAYED'
    ) {
      return {
        ...this.fromMissing(profile.byId.get('mbi_mbo')!),
        omission: true,
        activity: true
      };
    }
    if (status === 'NOT_REACHED' || !value) {
      return {
        ...this.unresolvedCell(),
        state: 'mnr',
        candidate: true,
        activity: false
      };
    }
    return this.unresolvedCell('unresolved-status');
  }

  private* resolveNotReachedCandidates(
    cells: ResolvedItemDatasetCell[],
    columns: ItemDatasetColumn[],
    design: ItemDatasetBookletDesign,
    profile: ItemDatasetProfile,
    scope: ItemDatasetNotReachedScope,
    recodeTrailingOmissions: boolean,
    operationCounter: { value: number }
  ): Generator<void, void, void> {
    const groups = new Map<string, number[]>();
    for (let index = 0; index < columns.length; index += 1) {
      yield* this.checkpoint(operationCounter);
      const column = columns[index];
      const position = design.units.get(column.unitId);
      if (!position) {
        continue;
      }
      let group = column.unitId;
      if (scope === 'booklet') {
        group = 'booklet';
      } else if (scope === 'testlet') {
        group = position.testletKey;
      }
      const indexes = groups.get(group) || [];
      indexes.push(index);
      groups.set(group, indexes);
    }

    for (const indexes of groups.values()) {
      indexes.sort((left, right) => {
        const leftPosition = design.units.get(columns[left].unitId)!;
        const rightPosition = design.units.get(columns[right].unitId)!;
        return (
          leftPosition.order - rightPosition.order ||
          columns[left].itemOrder - columns[right].itemOrder
        );
      });
      let laterActivity = false;
      let position = indexes.length - 1;
      while (position >= 0) {
        yield* this.checkpoint(operationCounter);
        const referenceIndex = indexes[position];
        const referencePosition = design.units.get(
          columns[referenceIndex].unitId
        )!;
        const itemOrder = columns[referenceIndex].itemOrder;
        let firstAtPosition = position;
        while (firstAtPosition > 0) {
          yield* this.checkpoint(operationCounter);
          const previousIndex = indexes[firstAtPosition - 1];
          const previousPosition = design.units.get(
            columns[previousIndex].unitId
          )!;
          if (
            previousPosition.order !== referencePosition.order ||
            columns[previousIndex].itemOrder !== itemOrder
          ) {
            break;
          }
          firstAtPosition -= 1;
        }
        const positionIndexes = indexes.slice(firstAtPosition, position + 1);
        for (const cellIndex of positionIndexes) {
          yield* this.checkpoint(operationCounter);
          const cell = cells[cellIndex];
          if (cell.candidate) {
            cells[cellIndex] = this.fromMissing(
              profile.byId.get(laterActivity ? 'mbi_mbo' : 'mnr')!
            );
          } else if (
            cell.omission &&
            recodeTrailingOmissions &&
            !laterActivity
          ) {
            cells[cellIndex] = this.fromMissing(profile.byId.get('mnr')!);
          }
        }
        for (const cellIndex of positionIndexes) {
          yield* this.checkpoint(operationCounter);
          if (cells[cellIndex].activity) {
            laterActivity = true;
            break;
          }
        }
        position = firstAtPosition - 1;
      }
    }
  }

  private* resolveDerivedState(
    key: string,
    responseValues: Map<string, ItemDatasetResponseValue>,
    derivedSources: Map<string, string[]>,
    profile: ItemDatasetProfile,
    cellsByResponseKey: Map<string, ResolvedItemDatasetCell>,
    recursion: Set<string>,
    operationCounter: { value: number }
  ): Generator<void, DerivedStateResolution, void> {
    if (recursion.has(key)) {
      return {
        state: 'error',
        failureReason: 'derived-cycle',
        hasResolvedSource: false,
        hasOmittedSource: false,
        hasIneligibleSource: true
      };
    }
    const sources = derivedSources.get(key);
    if (!sources || sources.length === 0) {
      const state = cellsByResponseKey.get(key)?.state || 'error';
      const sourceValue = responseValues.get(key);
      const hasResolvedSource = state === 'valid';
      const hasOmittedSource = state === 'mbi_mbo' ||
        this.isOmittedResponse(sourceValue);
      return {
        state,
        hasResolvedSource,
        hasOmittedSource,
        hasIneligibleSource: !hasResolvedSource && !hasOmittedSource,
        ...(state === 'error' ?
          { failureReason: 'derived-source-unresolved' as const } :
          {})
      };
    }
    recursion.add(key);
    const resolutions: DerivedStateResolution[] = [];
    for (const sourceKey of sources) {
      yield* this.checkpoint(operationCounter);
      const sourceValue = responseValues.get(sourceKey);
      if (
        sourceValue &&
        (sourceValue.code !== null || sourceValue.score !== null)
      ) {
        const state =
          cellsByResponseKey.get(sourceKey)?.state ||
          this.resolveInitialCell(sourceValue, profile).state;
        const hasResolvedSource = state === 'valid';
        const hasOmittedSource = state === 'mbi_mbo';
        resolutions.push({
          state,
          hasResolvedSource,
          hasOmittedSource,
          hasIneligibleSource: !hasResolvedSource && !hasOmittedSource
        });
        continue;
      }
      if (derivedSources.has(sourceKey)) {
        resolutions.push(
          yield* this.resolveDerivedState(
            sourceKey,
            responseValues,
            derivedSources,
            profile,
            cellsByResponseKey,
            recursion,
            operationCounter
          )
        );
        continue;
      }
      const resolvedSource = cellsByResponseKey.get(sourceKey);
      if (resolvedSource) {
        const hasResolvedSource = resolvedSource.state === 'valid';
        const hasOmittedSource =
          resolvedSource.state === 'mbi_mbo' ||
          this.isOmittedResponse(sourceValue);
        resolutions.push({
          state: resolvedSource.state,
          failureReason: resolvedSource.failureReason,
          hasResolvedSource,
          hasOmittedSource,
          hasIneligibleSource: !hasResolvedSource && !hasOmittedSource
        });
        continue;
      }
      if (sourceValue) {
        const sourceCell = this.resolveInitialCell(sourceValue, profile);
        const hasResolvedSource = sourceCell.state === 'valid';
        const hasOmittedSource = sourceCell.state === 'mbi_mbo' ||
          this.isOmittedResponse(sourceValue);
        resolutions.push({
          state: sourceCell.state,
          failureReason: sourceCell.failureReason,
          hasResolvedSource,
          hasOmittedSource,
          hasIneligibleSource: !hasResolvedSource && !hasOmittedSource
        });
      } else {
        resolutions.push({
          state: 'error',
          failureReason: 'derived-source-unresolved',
          hasResolvedSource: false,
          hasOmittedSource: false,
          hasIneligibleSource: true
        });
      }
    }
    recursion.delete(key);
    const hasResolvedSource = resolutions.some(
      resolution => resolution.hasResolvedSource === true
    );
    const hasOmittedSource = resolutions.some(
      resolution => resolution.hasOmittedSource === true
    );
    const hasIneligibleSource = resolutions.some(
      resolution => resolution.hasIneligibleSource === true
    );
    const failureReason = this.getDerivedFailureReason(resolutions);
    if (failureReason) {
      return {
        state: 'error',
        failureReason,
        hasResolvedSource,
        hasOmittedSource,
        hasIneligibleSource
      };
    }
    const states = resolutions.map(resolution => resolution.state);
    const state = aggregateItemDatasetMissingStates(states);
    if (
      state === 'error' &&
      states.includes('mbd') &&
      states.some(sourceState => sourceState !== 'mbd')
    ) {
      return {
        state,
        failureReason: 'derived-design-conflict',
        hasResolvedSource,
        hasOmittedSource,
        hasIneligibleSource
      };
    }
    return {
      state,
      hasResolvedSource,
      hasOmittedSource,
      hasIneligibleSource,
      ...(state === 'error' ?
        { failureReason: 'derived-source-unresolved' as const } :
        {})
    };
  }

  private hasStatus(
    value: ItemDatasetResponseValue | undefined,
    status: string
  ): boolean {
    return value?.status !== null && value?.status !== undefined &&
      statusNumberToString(value.status) === status;
  }

  private isOmittedResponse(
    value: ItemDatasetResponseValue | undefined
  ): boolean {
    return this.hasStatus(value, 'UNSET') ||
      this.hasStatus(value, 'DISPLAYED') ||
      this.hasStatus(value, 'PARTLY_DISPLAYED');
  }

  private getDerivedFailureReason(
    resolutions: DerivedStateResolution[]
  ): ItemMatrixCellFailureReason | undefined {
    if (resolutions.some(
      resolution => resolution.failureReason === 'derived-cycle'
    )) {
      return 'derived-cycle';
    }
    if (resolutions.some(resolution => resolution.state === 'error')) {
      return 'derived-source-unresolved';
    }
    return undefined;
  }

  private* checkpoint(operationCounter: {
    value: number;
  }): Generator<void, void, void> {
    operationCounter.value += 1;
    if (
      operationCounter.value % ItemDatasetCellResolver.yieldEveryOperations ===
      0
    ) {
      yield;
    }
  }

  private fromMissing(
    missing: ItemDatasetMissingValue
  ): ResolvedItemDatasetCell {
    return {
      state: this.toItemDatasetMissingState(missing.id),
      code: missing.code,
      score: missing.score,
      unresolved: false,
      activity: missing.id !== 'mnr' && missing.id !== 'mbd',
      candidate: false,
      omission: missing.id === 'mbi_mbo'
    };
  }

  private toItemDatasetMissingState(id: string): ItemDatasetMissingState {
    return requiredMissingIds.includes(id as IqbStandardMissingId) ?
      (id as IqbStandardMissingId) :
      'error';
  }
}
