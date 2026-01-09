/**
 * DTO for duplicate response selection
 */
export interface DuplicateResponseSelectionDto {
  key: string;
  unitId: number;
  unitName: string;
  variableId: string;
  subform: string;
  testTakerLogin: string;
  bookletName: string;
  duplicates: {
    responseId: number;
    value: string | null;
    status: string | null;
  }[];
}
