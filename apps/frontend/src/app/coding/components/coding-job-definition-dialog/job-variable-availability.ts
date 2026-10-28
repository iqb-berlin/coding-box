import { Variable } from '../../models/coding-job.model';
import { variableUsageKey } from './job-variable-selection';
import { JobDefinition } from './coding-job-definition.models';

/** Case availability and draft reservations, independent of table and selection state. */
export class JobVariableAvailability {
  private baseAvailableCasesByVariable = new Map<string, number>();
  private baseAvailableCasesWithDeriveErrorByVariable = new Map<string, number>();

  snapshotBaseAvailability(variables: Variable[]): void {
    this.baseAvailableCasesByVariable = new Map(
      variables.map(variable => [
        variableUsageKey(variable.unitName, variable.variableId),
        variable.availableCases ?? variable.uniqueCasesAfterAggregation ?? variable.responseCount ?? 0
      ])
    );
    this.baseAvailableCasesWithDeriveErrorByVariable = new Map(
      variables.map(variable => [
        variableUsageKey(variable.unitName, variable.variableId),
        variable.availableCasesWithDeriveError ??
          variable.uniqueCasesAfterAggregationWithDeriveError ??
          variable.availableCases ??
          variable.uniqueCasesAfterAggregation ??
          variable.responseCount ??
          0
      ])
    );
  }

  reserve(variables: Variable[], definitions: JobDefinition[], editingDefinitionId?: number): Variable[] {
    if (variables.length === 0) return variables;

    const regularCasesUsedInDefinitions = new Map<string, number>();
    const totalCasesUsedInDefinitions = new Map<string, number>();
    const makeKey = (u?: string | null, v?: string | null) => variableUsageKey(u, v);
    const makeKeyFromUsageKey = (variableKey: string): string => {
      const [unitName, variableId] = variableKey.split('::');
      return variableId === undefined ?
        variableKey.trim().toLowerCase() :
        makeKey(unitName, variableId);
    };
    const addUsage = (
      target: Map<string, number>,
      variableKey: string,
      usage: number
    ): void => {
      if (!Number.isFinite(usage) || usage <= 0) {
        return;
      }

      target.set(variableKey, (target.get(variableKey) || 0) + usage);
    };

    // Count cases used in each job definition (excluding the current one being edited)
    if (definitions && definitions.length > 0) {
      definitions.forEach(def => {
        // Skip the current definition being edited
        if (editingDefinitionId && def.id === editingDefinitionId) {
          return;
        }

        if ((def.createdJobsCount ?? 0) > 0) {
          return;
        }

        const plannedUsageByStatus = def.plannedVariableUsageByStatus || {};
        Object.entries(plannedUsageByStatus).forEach(([variableKey, usage]) => {
          const normalizedKey = makeKeyFromUsageKey(variableKey);
          addUsage(regularCasesUsedInDefinitions, normalizedKey, usage.regular);
          addUsage(totalCasesUsedInDefinitions, normalizedKey, usage.total);
        });

        if (Object.keys(plannedUsageByStatus).length === 0) {
          Object.entries(def.plannedVariableUsage || {}).forEach(([variableKey, usage]) => {
            const normalizedKey = makeKeyFromUsageKey(variableKey);
            addUsage(regularCasesUsedInDefinitions, normalizedKey, usage);
            addUsage(totalCasesUsedInDefinitions, normalizedKey, usage);
          });
        }
      });
    }

    // Adjust available cases based on cases used in definitions.
    // Start with backend availability so already created coding jobs remain reserved.
    return variables.map(v => {
      const key = makeKey(v.unitName, v.variableId);
      const regularCasesUsed = regularCasesUsedInDefinitions.get(key) || 0;
      const totalCasesUsed = totalCasesUsedInDefinitions.get(key) || 0;
      const originalAvailable = this.baseAvailableCasesByVariable.get(key) ??
        v.availableCases ??
        v.uniqueCasesAfterAggregation ??
        v.responseCount ??
        0;
      const originalAvailableWithDeriveError =
        this.baseAvailableCasesWithDeriveErrorByVariable.get(key) ??
        v.availableCasesWithDeriveError ??
        originalAvailable;
      return {
        ...v,
        availableCases: Math.max(0, originalAvailable - regularCasesUsed),
        availableCasesWithDeriveError: Math.max(0, originalAvailableWithDeriveError - totalCasesUsed)
      };
    });
  }
}
