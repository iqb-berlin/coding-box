export interface CoverageResponse {
  responseId: number;
  unitName: string;
  variableId: string;
  value: string | null;
  codeV2: number | null;
  statusV2: number | null;
  statusV1: number | null;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
}

export type CoverageResponseRow = Omit<CoverageResponse, 'responseId' | 'codeV2' | 'statusV2' | 'statusV1'> & {
  responseId: number | string;
  codeV2: number | string | null;
  statusV2: number | string | null;
  statusV1: number | string | null;
};

export function mapCoverageRow(row: CoverageResponseRow): CoverageResponse {
  return {
    responseId: Number(row.responseId),
    value: row.value ?? null,
    codeV2: row.codeV2 === null || row.codeV2 === undefined ? null : Number(row.codeV2),
    statusV2: row.statusV2 === null || row.statusV2 === undefined ? null : Number(row.statusV2),
    statusV1: row.statusV1 === null || row.statusV1 === undefined ? null : Number(row.statusV1),
    variableId: row.variableId,
    unitName: row.unitName,
    bookletName: row.bookletName ?? '',
    personLogin: row.personLogin ?? '',
    personCode: row.personCode ?? '',
    personGroup: row.personGroup ?? ''
  };
}
