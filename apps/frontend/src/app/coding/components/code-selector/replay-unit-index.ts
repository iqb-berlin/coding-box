import { BundleContext, UnitsReplayUnit } from '../../../replay/services/units-replay.service';

export interface IndexedReplayUnit {
  unit: UnitsReplayUnit;
  index: number;
}

export class ReplayUnitIndex {
  private source: UnitsReplayUnit[] | null | undefined;
  readonly byVariable = new Map<string, IndexedReplayUnit[]>();
  readonly byDefinitionVariable = new Map<string, IndexedReplayUnit[]>();
  readonly byBundle = new Map<number, IndexedReplayUnit[]>();
  readonly byResponseId = new Map<number, IndexedReplayUnit>();

  update(units: UnitsReplayUnit[] | null): void {
    if (units === this.source) {
      return;
    }

    this.source = units;
    this.byVariable.clear();
    this.byDefinitionVariable.clear();
    this.byBundle.clear();
    this.byResponseId.clear();
    if (!units) {
      return;
    }

    units.forEach((unit, index) => {
      const entry = { unit, index };
      this.byResponseId.set(unit.id, entry);

      if (unit.variableId) {
        const variableKey = `${unit.alias || unit.name}::${unit.variableId}`;
        this.addIndexedUnit(
          this.byVariable,
          variableKey,
          entry
        );
        this.addIndexedUnit(
          this.byDefinitionVariable,
          `${unit.name.toUpperCase()}::${unit.variableId}`,
          entry
        );
      }
      if (unit.variableBundleId !== null &&
        unit.variableBundleId !== undefined) {
        this.addIndexedUnit(
          this.byBundle,
          unit.variableBundleId,
          entry
        );
      }
    });
  }

  private addIndexedUnit<TKey>(
    index: Map<TKey, IndexedReplayUnit[]>,
    key: TKey,
    entry: IndexedReplayUnit
  ): void {
    const indexedUnits = index.get(key);
    if (indexedUnits) {
      indexedUnits.push(entry);
    } else {
      index.set(key, [entry]);
    }
  }

  forDefinitionVariable(
    unitName: string,
    variableId: string
  ): IndexedReplayUnit[] {
    return this.byDefinitionVariable.get(
      `${unitName.toUpperCase()}::${variableId}`
    ) || [];
  }
}

export function sameBundleCase(
  unit: UnitsReplayUnit,
  currentUnit: UnitsReplayUnit | undefined,
  context: BundleContext
): boolean {
  if (unit.bundleContext?.caseKey && context.caseKey) {
    return unit.bundleContext.caseKey === context.caseKey;
  }

  if (currentUnit?.testPerson || unit.testPerson) {
    return unit.testPerson === currentUnit?.testPerson;
  }

  return unit === currentUnit;
}
