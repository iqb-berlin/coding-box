export interface ExternalCodingImportResultDto {
  message: string;
  processedRows: number;
  updatedRows: number;
  errors: string[];
  affectedRows: Array<{
    unitAlias: string;
    variableId: string;
    personCode?: string;
    personLogin?: string;
    personGroup?: string;
    bookletName?: string;
    originalCodedStatus: string;
    originalCode: number | null;
    originalScore: number | null;
    updatedCodedStatus: string | null;
    updatedCode: number | null;
    updatedScore: number | null;
  }>;
}
