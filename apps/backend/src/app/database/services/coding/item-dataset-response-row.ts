export interface RawResponseValueRow {
  id: number;
  bookletId: number | string;
  bookletName: string;
  unitId: number | string;
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  status: number | string | null;
  statusV1: number | string | null;
  codeV1: number | string | null;
  scoreV1: number | string | null;
  statusV2: number | string | null;
  codeV2: number | string | null;
  scoreV2: number | string | null;
  statusV3: number | string | null;
  codeV3: number | string | null;
  scoreV3: number | string | null;
}
