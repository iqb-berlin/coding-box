export interface CodingResult {
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  variablePage?: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  testPerson: string;
  testPersonSearch: string;
  code?: string | number | null;
  codeLabel?: string;
  score?: number | null;
  codingIssueOption?: number;
  codingIssueOptionLabel?: string;
  givenCode?: string | number;
  givenScore?: number;
  notes?: string;
  isDoubleCoded?: boolean;
  otherCoders?: string[];
  unresolvedMissing?: boolean;
}

function matchesUnitFilter(data: CodingResult, filter: string): boolean {
  return !filter || data.unitName.toLowerCase().includes(filter) ||
    !!data.unitAlias?.toLowerCase().includes(filter);
}

export function createCodingResultFilter(): (data: CodingResult, filter: string) => boolean {
  return (data: CodingResult, filter: string): boolean => {
    let filters: {
      unitName?: string;
      variable?: string;
      codingIssue?: string;
      testPerson?: string;
    };

    try {
      filters = JSON.parse(filter);
    } catch {
      return true;
    }

    // Check unit name filter (includes unitName and unitAlias)
    const unitFilter = filters.unitName?.toLowerCase() || '';
    if (!matchesUnitFilter(data, unitFilter)) {
      return false;
    }

    // Check variable filter
    const variableFilter = filters.variable?.toLowerCase() || '';
    if (variableFilter &&
        !data.variableId.toLowerCase().includes(variableFilter) &&
        !data.variableAnchor.toLowerCase().includes(variableFilter)) {
      return false;
    }

    // Check coding issue filter
    const codingIssueFilter = filters.codingIssue?.toLowerCase() || '';
    if (codingIssueFilter && !(data.codingIssueOptionLabel && data.codingIssueOptionLabel.toLowerCase().includes(codingIssueFilter))) {
      return false;
    }

    // Check test person filter
    const testPersonFilter = filters.testPerson?.toLowerCase() || '';
    return !(testPersonFilter && !data.testPersonSearch.toLowerCase().includes(testPersonFilter));
  };
}

export function createCodingResultSorter(): (data: CodingResult, sortHeaderId: string) => string | number {
  return (result: CodingResult, sortHeaderId: string): string | number => {
    switch (sortHeaderId) {
      case 'testPerson':
        return result.testPerson;
      case 'code':
        return result.code ?? Number.NEGATIVE_INFINITY;
      case 'score':
        return result.score ?? result.givenScore ?? Number.NEGATIVE_INFINITY;
      case 'codingIssueOption':
        return result.codingIssueOptionLabel || '';
      case 'doubleCoding':
        return result.otherCoders?.length || 0;
      case 'notes':
        return result.notes || '';
      default:
        return (result as unknown as Record<string, string | number | null | undefined>)[sortHeaderId] ?? '';
    }
  };
}
