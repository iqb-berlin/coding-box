// DTOs for backend use only. Frontend uses its own CodingReportDto class.
export interface CodingReportRowDto {
  unit: string;
  variable: string;
  item?: string;
  validation: 'OK' | 'Fehler' | 'Warnung';
  codingType: 'geschlossen' | 'manuell' | 'regelbasiert' | 'keine Regeln';
}

export interface CodingReportResponseDto {
  rows: CodingReportRowDto[];
  total: number;
  page: number;
  pageSize: number;
}
