import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { CacheService } from '../../cache/cache.service';
import { ResponseEntity } from '../entities/response.entity';

@Injectable()
export class ExportValidationResultsService {
  private readonly logger = new Logger(ExportValidationResultsService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService
  ) {}

  async exportValidationResultsAsExcel(
    workspaceId: number,
    cacheKey: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting validation results as Excel for workspace ${workspaceId} using cache key ${cacheKey}`);

    if (!cacheKey || typeof cacheKey !== 'string') {
      const errorMessage = 'Invalid cache key provided';
      this.logger.error(`${errorMessage}: ${cacheKey}`);
      throw new Error(errorMessage);
    }

    try {
      this.logger.log(`Attempting to retrieve cached data with key: ${cacheKey}`);
      const cachedData = await this.cacheService.getCompleteValidationResults(cacheKey);

      if (!cachedData) {
        this.logger.error(`No cached validation results found for cache key ${cacheKey}`);
        this.logger.error('Cache key format: validation:{workspaceId}:{hash}');
        this.logger.error(`Expected pattern: validation:${workspaceId}:*`);
      }

      const validationResults = cachedData.results;
      this.logger.log(`Successfully retrieved ${validationResults.length} validation results from cache for export`);

      if (!validationResults || validationResults.length === 0) {
        this.logger.error('Cached data exists but contains no validation results');
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Validation Results');

      worksheet.columns = [
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Unit Key', key: 'unit_key', width: 15 },
        { header: 'Login Name', key: 'login_name', width: 15 },
        { header: 'Login Code', key: 'login_code', width: 15 },
        { header: 'Booklet ID', key: 'booklet_id', width: 15 },
        { header: 'Variable ID', key: 'variable_id', width: 15 },
        { header: 'Response Value', key: 'response_value', width: 20 },
        { header: 'Response Status', key: 'response_status', width: 15 },
        { header: 'Person ID', key: 'person_id', width: 12 },
        { header: 'Unit Name', key: 'unit_name', width: 20 },
        { header: 'Booklet Name', key: 'booklet_name', width: 20 },
        { header: 'Last Modified', key: 'last_modified', width: 20 }
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      for (const result of validationResults) {
        const combination = result.combination;
        let responseData = null;
        let personData = null;
        let unitData = null;
        let bookletData = null;

        if (result.status === 'EXISTS') {
          const query = this.responseRepository
            .createQueryBuilder('response')
            .leftJoin('response.unit', 'unit')
            .leftJoin('unit.booklet', 'booklet')
            .leftJoin('booklet.person', 'person')
            .leftJoin('booklet.bookletinfo', 'bookletinfo')
            .select([
              'response.value',
              'response.status',
              'person.id',
              'person.login',
              'person.code',
              'unit.name',
              'unit.alias',
              'bookletinfo.name'
            ])
            .where('unit.alias = :unitKey', { unitKey: combination.unit_key })
            .andWhere('person.login = :loginName', { loginName: combination.login_name })
            .andWhere('person.code = :loginCode', { loginCode: combination.login_code })
            .andWhere('bookletinfo.name = :bookletId', { bookletId: combination.booklet_id })
            .andWhere('response.variableid = :variableId', { variableId: combination.variable_id })
            .andWhere('response.value IS NOT NULL')
            .andWhere('response.value != :empty', { empty: '' });

          const responseEntity = await query.getOne();
          if (responseEntity) {
            responseData = responseEntity;
            personData = responseEntity.unit?.booklet?.person;
            unitData = responseEntity.unit;
            bookletData = responseEntity.unit?.booklet?.bookletinfo;
          }
        }

        worksheet.addRow({
          status: result.status,
          unit_key: combination.unit_key,
          login_name: combination.login_name,
          login_code: combination.login_code,
          booklet_id: combination.booklet_id,
          variable_id: combination.variable_id,
          response_value: responseData?.value || '',
          response_status: responseData?.status || '',
          person_id: personData?.id || '',
          unit_name: unitData?.name || '',
          booklet_name: bookletData?.name || '',
          last_modified: ''
        });
      }

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip header row
          const statusCell = row.getCell(1);
          if (statusCell.value === 'EXISTS') {
            statusCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF90EE90' }
            };
          } else if (statusCell.value === 'MISSING') {
            statusCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFA0A0' } // Light red
            };
          }
        }
      });

      worksheet.columns.forEach(column => {
        if (column.header) {
          column.width = Math.max(column.width || 10, column.header.length + 2);
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting validation results as Excel: ${error.message}`, error.stack);
      throw new Error('Could not export validation results as Excel. Please check the database connection or query.');
    }
  }
}
