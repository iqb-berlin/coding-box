import { Injectable, Inject } from '@nestjs/common';

import { WorkspaceFilesService } from './workspace-files.service';

interface CodingSchemeVariable {
  id?: string;
  alias?: string;
  item?: string;
  rules?: unknown[];
  closed?: boolean;
  manual?: boolean;
}

interface CodingScheme {
  version?: string;
  variableCodings?: CodingSchemeVariable[];
}

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

@Injectable()
export class CodingReportService {
  constructor(
    @Inject(WorkspaceFilesService)
    private readonly workspaceFilesService: WorkspaceFilesService
  ) {}

  async getCodingReport(
    workspaceId: number,
    page: number = 1,
    pageSize: number = 50
  ): Promise<CodingReportResponseDto> {
    // Step 1: Fetch all unit coding scheme files for the workspace
    const unitFiles = await this.workspaceFilesService.getUnitsWithFileIds(workspaceId);
    const rows: CodingReportRowDto[] = [];

    for (const unitFile of unitFiles) {
      // Step 2: Parse coding scheme JSON (unitFile.data)
      let codingScheme: CodingScheme;
      try {
        codingScheme = JSON.parse(unitFile.data) as CodingScheme;
      } catch (e) {
        // Skip/report units with invalid coding scheme
        rows.push({
          unit: unitFile.unitId,
          variable: '',
          item: undefined,
          validation: 'Fehler',
          codingType: 'keine Regeln'
        });
        continue;
      }
      // Step 3: Check coding scheme version
      if (!codingScheme.version || parseFloat(codingScheme.version) < 1.5) {
        rows.push({
          unit: unitFile.unitId,
          variable: '',
          item: undefined,
          validation: 'Warnung',
          codingType: 'keine Regeln'
        });
        continue;
      }
      // Step 4: Iterate variables in coding scheme
      if (Array.isArray(codingScheme.variableCodings)) {
        for (const variable of codingScheme.variableCodings) {
          // Determine coding type
          let codingType: CodingReportRowDto['codingType'] = 'keine Regeln';
          if (variable.rules && variable.rules.length > 0) {
            codingType = 'regelbasiert';
          } else if (variable.closed) {
            codingType = 'geschlossen';
          } else if (variable.manual) {
            codingType = 'manuell';
          }
          // Validation logic (configurable: placeholder)
          let validation: CodingReportRowDto['validation'] = 'OK';
          if (!variable.id) {
            validation = 'Fehler';
          } else if (!variable.rules || variable.rules.length === 0) {
            validation = 'Warnung';
          }
          rows.push({
            unit: unitFile.unitId,
            variable: variable.alias || variable.id,
            item: variable.item || undefined,
            validation,
            codingType
          });
        }
      }
    }
    // Pagination
    const total = rows.length;
    const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);
    return {
      rows: pagedRows,
      total,
      page,
      pageSize
    };
  }
}
