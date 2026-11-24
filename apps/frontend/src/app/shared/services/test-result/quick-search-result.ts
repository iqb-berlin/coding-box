export type QuickSearchResultKind = 'person' | 'booklet' | 'unit' | 'response';

export interface QuickSearchResultItem {
  kind: QuickSearchResultKind;
  id: number;
  label: string;
  secondaryLabel?: string;
  personId?: number;
  personLogin?: string;
  personCode?: string;
  personGroup?: string;
  bookletId?: number;
  bookletName?: string;
  unitId?: number;
  unitName?: string;
  unitAlias?: string | null;
  responseId?: number;
  variableId?: string;
  responseValue?: string;
  responseStatus?: string;
}

export interface QuickSearchResult {
  query: string;
  limit: number;
  persons: QuickSearchResultItem[];
  booklets: QuickSearchResultItem[];
  units: QuickSearchResultItem[];
  responses: QuickSearchResultItem[];
  totals: Record<QuickSearchResultKind, number>;
  hasMoreResponses?: boolean;
}
