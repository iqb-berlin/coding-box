export interface DuplicateResponseDto {
  unitName: string;
  unitId: number;
  variableId: string;
  subform: string;
  bookletName: string;
  testTakerLogin: string;
  duplicates: {
    responseId: number;
    value: string;
    status: string;
    timestamp?: number;
  }[];
}

export interface DuplicateResponsesResultDto {
  data: DuplicateResponseDto[];
  total: number;
  page: number;
  limit: number;
}
