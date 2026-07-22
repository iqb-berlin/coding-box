import type { ItemDatasetNotReachedScope } from '../../../../../../../api-dto/coding/export-request.dto';
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
      const state = yield* this.resolveDerivedState(
        column.key,
        responseValues,
        derivedSources,
        profile,
        cellsByResponseKey,
        recursion,
        operationCounter
      );
      cells[index] =
        state !== 'valid' && state !== 'error' ?
          this.fromMissing(profile.byId.get(state as IqbStandardMissingId)!) :
          this.unresolvedCell();
      cellsByResponseKey.set(column.key, cells[index]);
    }
    return cells;
  }

  getExportValue(
    cell: ResolvedItemDatasetCell,
    requestedValue: 'code' | 'score'
  ): string | number {
    if (requestedValue === 'score') {
      return cell.score === null ? '' : cell.score;
    }
    return cell.unresolved || cell.code === null ? 'NA' : cell.code;
  }

  unresolvedCell(): ResolvedItemDatasetCell {
    return {
      state: 'error',
      code: null,
      score: null,
      unresolved: true,
      activity: true,
      candidate: false,
      omission: false
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
      if (storedMissing) {
        return {
          ...this.fromMissing(storedMissing),
          code: value.code,
          score: value.score ?? storedMissing.score
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
    return this.unresolvedCell();
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
  ): Generator<void, ItemDatasetMissingState, void> {
    if (recursion.has(key)) {
      return 'error';
    }
    const sources = derivedSources.get(key);
    if (!sources || sources.length === 0) {
      return cellsByResponseKey.get(key)?.state || 'error';
    }
    recursion.add(key);
    const states: ItemDatasetMissingState[] = [];
    for (const sourceKey of sources) {
      yield* this.checkpoint(operationCounter);
      const sourceValue = responseValues.get(sourceKey);
      if (
        sourceValue &&
        (sourceValue.code !== null || sourceValue.score !== null)
      ) {
        states.push(
          cellsByResponseKey.get(sourceKey)?.state ||
            this.resolveInitialCell(sourceValue, profile).state
        );
        continue;
      }
      if (derivedSources.has(sourceKey)) {
        states.push(
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
        states.push(resolvedSource.state);
        continue;
      }
      states.push(
        sourceValue ?
          this.resolveInitialCell(sourceValue, profile).state :
          'error'
      );
    }
    recursion.delete(key);
    return aggregateItemDatasetMissingStates(states);
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
