import { Variable } from '../../models/coding-job.model';
import { JobVariableCasePolicy } from './job-variable-case-policy';

export function filterJobDefinitionVariables(variables: Variable[], filters: { unitName: string; variableId: string; availability: 'all' | 'full' | 'partial' | 'none' }, policy: JobVariableCasePolicy): Variable[] {
  let filteredData = variables;
  if (filters.unitName || filters.variableId) {
    filteredData = filteredData.filter(v => {
      const matchesUnit = !filters.unitName ||
          v.unitName?.toLowerCase().includes(filters.unitName.toLowerCase());
      const matchesVariable = !filters.variableId ||
          v.variableId?.toLowerCase().includes(filters.variableId.toLowerCase());
      return matchesUnit && matchesVariable;
    });
  }

  if (filters.availability !== 'all') {
    filteredData = filteredData.filter(v => {
      const effectiveTotal = policy.getVariableSelectableEffectiveCases(v);
      const availableRaw = policy.getVariableSelectableAvailableCases(v);
      const totalRaw = effectiveTotal !== undefined ?
        effectiveTotal :
        availableRaw;

      const available = Number(availableRaw ?? 0);
      const total = Number(totalRaw ?? 0);

      if (total <= 0) {
        // No cases at all => treat as none
        return filters.availability === 'none';
      }

      const isFull = available >= total;
      const isNone = available <= 0;
      const isPartial = !isFull && !isNone;

      switch (filters.availability) {
        case 'full':
          return isFull;
        case 'partial':
          return isPartial;
        case 'none':
          return isNone;
        default:
          return true;
      }
    });
  }

  return filteredData;
}
