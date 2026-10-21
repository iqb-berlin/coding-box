/** Inputs already reflect availability, aggregation and explicit DERIVE_ERROR choices. */
export interface WorkloadVariable {
  unitName: string;
  variableId: string;
  effectiveCases: number;
  availableCases: number;
}

export interface CodingWorkloadInput {
  mode: 'definition' | 'job';
  variables: WorkloadVariable[];
  bundles: { id: number; variables: WorkloadVariable[]; caseOrderingMode?: 'continuous' | 'alternating' }[];
  caseOrderingMode: 'continuous' | 'alternating';
  distributionSeed: string;
  maxCodingCases: number | null;
  doubleCodingMode: 'absolute' | 'percentage';
  doubleCodingAbsolute: number;
  doubleCodingPercentage: number;
  durationSeconds: number;
  coderCapacityPercent: number[];
  preview: DistributionPreviewSummary | null;
}

interface EstimatedDistributionGroup {
  variableKey: string;
  remaining: number;
}

interface EstimatedDistributionItem {
  groups: EstimatedDistributionGroup[];
  nextGroupIndex: number;
  remaining: number;
}

export interface CodingWorkloadSummary {
  jobCount: number;
  selectedCases: number;
  distributableCases: number;
  unavailableCases: number;
  limitReduction: number;
  totalCases: number;
  doubleCodedCases: number;
  totalCodingTasks: number;
  totalTimeSeconds: number;
  timePerCoderSeconds: number;
  formattedTotalTime: string;
  formattedTimePerCoder: string;
}

export interface DistributionPreviewSummary {
  totalCases: number;
  doubleCodedCases: number;
  totalCodingTasks: number;
  tasksPerCoder?: Record<string, number>;
}

/** Deterministic fallback estimate; authoritative server previews take precedence. */
export class CodingWorkload {
  constructor(private readonly input: CodingWorkloadInput) {}

  private allVariables(): WorkloadVariable[] {
    return [...this.input.variables, ...this.input.bundles.flatMap(bundle => bundle.variables)];
  }

  estimateVariableCaseCounts(): number[] {
    const items = this.getSelectedDistributionItems();
    const maxCases = this.input.maxCodingCases;
    const total = items.reduce((sum, item) => sum + item.remaining, 0);
    const targetCases =
      this.input.mode === 'definition' &&
      typeof maxCases === 'number' &&
      maxCases > 0 ?
        Math.min(total, maxCases) :
        total;
    const selectedCaseCountsByVariable = new Map<string, number>();
    let selectedCases = 0;

    while (selectedCases < targetCases) {
      let progressed = false;

      for (const item of items) {
        if (selectedCases >= targetCases) {
          break;
        }

        const variableKey = this.takeNextEstimatedItemCase(item);
        if (!variableKey) {
          continue;
        }

        selectedCaseCountsByVariable.set(
          variableKey,
          (selectedCaseCountsByVariable.get(variableKey) || 0) + 1
        );
        selectedCases += 1;
        progressed = true;
      }

      if (!progressed) {
        break;
      }
    }

    return Array.from(selectedCaseCountsByVariable.values());
  }

  private takeNextEstimatedItemCase(item: EstimatedDistributionItem): string | undefined {
    if (item.remaining <= 0 || item.groups.length === 0) {
      return undefined;
    }

    for (let attempts = 0; attempts < item.groups.length; attempts += 1) {
      const group = item.groups[item.nextGroupIndex % item.groups.length];
      item.nextGroupIndex = (item.nextGroupIndex + 1) % item.groups.length;

      if (group.remaining <= 0) {
        continue;
      }

      group.remaining -= 1;
      item.remaining -= 1;
      return group.variableKey;
    }

    return undefined;
  }

  private getSelectedDistributionItems(): EstimatedDistributionItem[] {
    const caseOrderingMode = this.input.caseOrderingMode || 'continuous';
    const items: EstimatedDistributionItem[] = [];

    this.input.bundles.forEach(bundle => {
      const itemKey = `bundle:${bundle.id}`;
      const itemCaseOrderingMode = bundle.caseOrderingMode || caseOrderingMode;
      const cases = this.getEstimatedItemCases(
        bundle.variables as WorkloadVariable[],
        itemCaseOrderingMode,
        itemKey
      );

      if (cases.remaining > 0) {
        items.push(cases);
      }
    });

    this.input.variables.forEach(variable => {
      const itemKey = `${variable.unitName}::${variable.variableId}`;
      const cases = this.getEstimatedItemCases([variable], caseOrderingMode, itemKey);

      if (cases.remaining > 0) {
        items.push(cases);
      }
    });

    return items;
  }

  private getEstimatedItemCases(
    variables: WorkloadVariable[],
    mode: 'continuous' | 'alternating',
    itemKey: string
  ): EstimatedDistributionItem {
    const distributionSeed = this.input.distributionSeed;
    const variableGroups = variables
      .map(variable => ({
        variableKey: `${variable.unitName.trim().toLowerCase()}::${variable.variableId.trim().toLowerCase()}`,
        stratumKey: this.getEstimatedResponseStratumKey(variable, mode),
        remaining: variable.availableCases
      }))
      .filter(group => group.remaining > 0)
      .sort((a, b) => {
        const hashA = this.stableHash(`${distributionSeed}:${itemKey}:stratum:${a.stratumKey}`);
        const hashB = this.stableHash(`${distributionSeed}:${itemKey}:stratum:${b.stratumKey}`);
        return hashA - hashB || a.stratumKey.localeCompare(b.stratumKey);
      });

    return {
      groups: variableGroups.map(group => ({
        variableKey: group.variableKey,
        remaining: group.remaining
      })),
      nextGroupIndex: 0,
      remaining: variableGroups.reduce((sum, group) => sum + group.remaining, 0)
    };
  }

  private getEstimatedResponseStratumKey(
    variable: Pick<WorkloadVariable, 'unitName' | 'variableId'>,
    mode: 'continuous' | 'alternating'
  ): string {
    if (mode === 'alternating') {
      return `::::${variable.unitName}::${variable.variableId}`;
    }

    return `${variable.unitName}::${variable.variableId}::::`;
  }

  private stableHash(value: string): number {
    let hash = 0;

    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) % 4294967291;
    }

    return hash;
  }

  private getDoubleCodedCasesForVariable(totalCases: number): number {
    const { doubleCodingAbsolute, doubleCodingPercentage } = this.input;

    if (this.input.doubleCodingMode === 'absolute') {
      return Math.min(doubleCodingAbsolute || 0, totalCases);
    }

    return Math.min(
      Math.ceil(((doubleCodingPercentage || 0) / 100) * totalCases),
      totalCases
    );
  }

  summarize(variableCaseCounts: number[]): CodingWorkloadSummary {
    const { maxCodingCases, durationSeconds } = this.input;
    const selectedCases = this.allVariables().reduce((sum, variable) => sum + variable.effectiveCases, 0);
    const distributableCases = this.allVariables().reduce((sum, variable) => sum + variable.availableCases, 0);
    const limitedCases = this.input.mode === 'definition' && typeof maxCodingCases === 'number' && maxCodingCases > 0 ?
      Math.min(distributableCases, maxCodingCases) : distributableCases;
    const preview = this.input.preview;
    const totalCases = preview?.totalCases ?? limitedCases;
    const doubleCodedCases = preview?.doubleCodedCases ?? variableCaseCounts
      .reduce((sum, cases) => sum + this.getDoubleCodedCasesForVariable(cases), 0);
    const totalCodingTasks = preview?.totalCodingTasks ?? totalCases + doubleCodedCases;
    const durationPerCase = durationSeconds || 1;
    const totalTimeSeconds = totalCodingTasks * durationPerCase;
    const capacityWeights = this.input.coderCapacityPercent.map(capacity => capacity / 100);
    const totalCapacityWeight = capacityWeights.reduce((sum, weight) => sum + weight, 0);
    const previewTaskCounts = Object.values(preview?.tasksPerCoder ?? {}).map(Number).filter(Number.isFinite);
    let timePerCoderSeconds = totalTimeSeconds;
    if (previewTaskCounts.length > 0) {
      timePerCoderSeconds = Math.max(...previewTaskCounts) * durationPerCase;
    } else if (totalCapacityWeight > 0) {
      timePerCoderSeconds = Math.ceil((totalTimeSeconds / totalCapacityWeight) * Math.max(...capacityWeights));
    }

    return {
      jobCount: (this.input.variables.length + this.input.bundles.length) * this.input.coderCapacityPercent.length,
      selectedCases,
      distributableCases,
      unavailableCases: Math.max(0, selectedCases - distributableCases),
      limitReduction: distributableCases - limitedCases,
      totalCases,
      doubleCodedCases,
      totalCodingTasks,
      totalTimeSeconds,
      timePerCoderSeconds,
      formattedTotalTime: this.formatTime(totalTimeSeconds),
      formattedTimePerCoder: this.formatTime(timePerCoderSeconds)
    };
  }

  private formatTime(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }
}
