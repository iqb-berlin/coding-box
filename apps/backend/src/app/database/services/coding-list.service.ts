import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import FileUpload from '../entities/file_upload.entity';
import { ResponseEntity } from '../entities/response.entity';
import { extractVariableLocation } from '../../utils/voud/extractVariableLocation';
import { statusStringToNumber } from '../utils/response-status-converter';

@Injectable()
export class CodingListService {
  private readonly logger = new Logger(CodingListService.name);

  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>
  ) {}

  async getCodingList(
    workspace_id: number,
    authToken: string,
    serverUrl?: string
  ): Promise<{
      items: {
        unit_key: string;
        unit_alias: string;
        login_name: string;
        login_code: string;
        booklet_id: string;
        variable_id: string;
        variable_page: string;
        variable_anchor: string;
        url: string;
      }[];
      total: number;
    }> {
    try {
      const server = serverUrl;

      // 1) Preload VOUD files and build variable->page mapping
      const voudFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspace_id,
          file_type: 'Resource',
          filename: Like('%.voud')
        }
      });

      this.logger.log(`Found ${voudFiles.length} VOUD files for workspace ${workspace_id}`);

      const variablePageMap = new Map<string, Map<string, string>>();
      for (const voudFile of voudFiles) {
        try {
          const respDefinition = { definition: (voudFile).data };
          const variableLocation = extractVariableLocation([respDefinition]);
          const unitVarPages = new Map<string, string>();
          for (const pageInfo of variableLocation[0].variable_pages) {
            unitVarPages.set(pageInfo.variable_ref, pageInfo.variable_path?.pages?.toString() || '0');
          }
          variablePageMap.set(voudFile.file_id.replace('.VOUD', ''), unitVarPages);
        } catch (error) {
          this.logger.error(`Error parsing VOUD file ${voudFile.filename}: ${error.message}`);
        }
      }
      // 2) Query all coding incomplete responses
      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status_v1 = :status', { status: 'CODING_INCOMPLETE' })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id })
        .orderBy('response.id', 'ASC');

      const [responses, total] = await queryBuilder.getManyAndCount();

      // 3) Build exclusion Set from VOCS files where sourceType == BASE_NO_VALUE
      const unitNames = Array.from(
        new Set(
          responses
            .map(r => r.unit?.name)
            .filter((u): u is string => typeof u === 'string' && !!u)
        )
      );

      interface VocsScheme { variableCodings?: { id: string; sourceType?: string }[] }

      const vocsFiles = unitNames.length ?
        await this.fileUploadRepository.find({
          where: {
            workspace_id,
            file_type: 'Resource',
            file_id: In(unitNames.map(u => `${u}.VOCS`))
          },
          select: ['file_id', 'data']
        }) :
        [];

      const excludedPairs = new Set<string>(); // key: `${unitKey}||${variableId}`
      for (const file of vocsFiles) {
        try {
          const unitKey = file.file_id.replace('.VOCS', '');
          const data = typeof (file).data === 'string' ? JSON.parse((file).data) : (file).data;
          const scheme = data as VocsScheme;
          const vars = scheme?.variableCodings || [];
          for (const vc of vars) {
            if (vc && vc.id && vc.sourceType && vc.sourceType === 'BASE_NO_VALUE') {
              excludedPairs.add(`${unitKey}||${vc.id}`);
            }
          }
        } catch (e) {
          this.logger.error(`Error parsing VOCS file ${file.file_id}: ${e.message}`);
        }
      }

      // 4) Map responses to output and filter by excludedPairs and variable id substrings
      const filtered = (responses).filter(r => {
        const unitKey = r.unit?.name || '';
        const variableId = r.variableid || '';
        const hasExcludedPair = excludedPairs.has(`${unitKey}||${variableId}`);
        const hasExcludedSubstring = /image|text|audio|frame|video|_0/i.test(variableId);
        return !hasExcludedPair && !hasExcludedSubstring;
      });

      const result = filtered.map(response => {
        const unit = response.unit;
        const booklet = unit?.booklet;
        const person = booklet?.person;
        const bookletInfo = booklet?.bookletinfo;
        const loginName = person?.login || '';
        const loginCode = person?.code || '';
        const bookletId = bookletInfo?.name || '';
        const unitKey = unit?.name || '';
        const unitAlias = unit?.alias || '';
        const variableId = response.variableid || '';
        const unitVarPages = variablePageMap.get(unitKey);
        const variablePage = unitVarPages?.get(variableId) || '0';
        const variableAnchor = variableId;

        const url = `${server}/#/replay/${loginName}@${loginCode}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

        return {
          unit_key: unitKey,
          unit_alias: unitAlias,
          login_name: loginName,
          login_code: loginCode,
          booklet_id: bookletId,
          variable_id: variableId,
          variable_page: variablePage,
          variable_anchor: variableAnchor,
          url
        };
      });

      // 5) Sort
      const sortedResult = result.sort((a, b) => {
        const unitKeyComparison = a.unit_key.localeCompare(b.unit_key);
        if (unitKeyComparison !== 0) {
          return unitKeyComparison;
        }
        return a.variable_id.localeCompare(b.variable_id);
      });

      this.logger.log(`Found ${sortedResult.length} coding items after filtering derived variables, total raw ${total}`);
      return { items: sortedResult, total };
    } catch (error) {
      this.logger.error(`Error fetching coding list: ${error.message}`);
      return { items: [], total: 0 };
    }
  }

  // Stream-based CSV generator to avoid loading everything into memory
  async getCodingListCsvStream(workspace_id: number, authToken: string, serverUrl?: string) {
    this.logger.log(`Streaming CSV export for workspacee${workspace_id}`);

    // Prepare CSV transform stream with headers
    const csvStream = fastCsv.format({ headers: true });

    // Kick off async producer without awaiting, write into csvStream in batches
    (async () => {
      try {
        // Preload VOUD files and build variable-page mapping once
        const voudFiles = await this.fileUploadRepository.find({
          where: {
            workspace_id: workspace_id,
            file_type: 'Resource',
            filename: Like('%.voud')
          }
        });

        const variablePageMap = new Map<string, Map<string, string>>();
        for (const voudFile of voudFiles) {
          try {
            const respDefinition = { definition: voudFile.data as string };
            const variableLocation = extractVariableLocation([respDefinition]);
            const unitVarPages = new Map<string, string>();
            for (const pageInfo of variableLocation[0].variable_pages) {
              unitVarPages.set(pageInfo.variable_ref, pageInfo.variable_path?.pages?.toString() || '0');
            }
            variablePageMap.set(voudFile.file_id.replace('.VOUD', ''), unitVarPages);
          } catch (error) {
            this.logger.error(`Error parsing VOUD file ${voudFile.filename}: ${error.message}`);
          }
        }

        // Preload all VOCS files and build exclusion set once per stream
        interface VocsScheme {
          variableCodings?: { id: string; sourceType?: string }[]
        }

        const vocsFiles = await this.fileUploadRepository.find({
          where: {
            workspace_id,
            file_type: 'Resource',
            file_id: Like('%.VOCS')
          },
          select: ['file_id', 'data']
        });
        const excludedPairs = new Set<string>(); // key: `${unitKey}||${variableId}`
        for (const file of vocsFiles) {
          try {
            const unitKey = file.file_id.replace('.VOCS', '');
            const data = typeof (file).data === 'string' ? JSON.parse((file).data) : (file).data;
            const scheme = data as VocsScheme;
            const vars = scheme?.variableCodings || [];
            for (const vc of vars) {
              if (vc && vc.id && vc.sourceType && vc.sourceType === 'BASE_NO_VALUE') {
                excludedPairs.add(`${unitKey}||${vc.id}`);
              }
            }
          } catch (e) {
            this.logger.error(`Error parsing VOCS file ${file.file_id}: ${e.message}`);
          }
        }

        const batchSize = 5000;
        let lastId = 0;
        let totalWritten = 0;

        for (; ;) {
          const responses = await this.responseRepository.createQueryBuilder('response')
            .leftJoinAndSelect('response.unit', 'unit')
            .leftJoinAndSelect('unit.booklet', 'booklet')
            .leftJoinAndSelect('booklet.person', 'person')
            .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
            .where('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
            .andWhere('person.workspace_id = :workspace_id', { workspace_id })
            .andWhere('response.id > :lastId', { lastId })
            .orderBy('response.id', 'ASC')
            .take(batchSize)
            .getMany();

          if (!responses.length) break;

          for (const response of responses) {
            const unit = response.unit;
            const booklet = unit?.booklet;
            const person = booklet?.person;
            const bookletInfo = booklet?.bookletinfo;
            const loginName = person?.login || '';
            const loginCode = person?.code || '';
            const bookletId = bookletInfo?.name || '';
            const unitKey = unit?.name || '';
            const unitAlias = unit?.alias || '';
            const variableId = response.variableid || '';

            // skip derived/solver/no-base variables and variable IDs containing 'image' or 'text'
            if (excludedPairs.has(`${unitKey}||${variableId}`) || /image|text|audio|frame|video|_0/i.test(variableId)) {
              continue;
            }

            const unitVarPages = variablePageMap.get(unitKey);
            const variablePage = unitVarPages?.get(variableId) || '0';
            const variableAnchor = variableId;

            const url = `${serverUrl}/#/replay/${loginName}@${loginCode}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

            const ok = csvStream.write({
              unit_key: unitKey,
              unit_alias: unitAlias,
              login_name: loginName,
              login_code: loginCode,
              booklet_id: bookletId,
              variable_id: variableId,
              variable_page: variablePage,
              variable_anchor: variableAnchor,
              url: url
            });

            totalWritten += 1;
            if (!ok) {
              await new Promise(resolve => { csvStream.once('drain', resolve); });
            }
          }

          lastId = responses[responses.length - 1].id;
          await new Promise(resolve => { setImmediate(resolve); });
        }

        this.logger.log(`CSV stream finished. Rows written: ${totalWritten}`);
        (csvStream).end();
      } catch (error) {
        this.logger.error(`Error streaming CSV export: ${error.message}`);
        csvStream.emit('error', error);
      }
    })();

    return csvStream;
  }

  async getCodingListAsExcel(workspace_id: number): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Coding List');

    worksheet.columns = [
      { header: 'unit_key', key: 'unit_key', width: 30 },
      { header: 'unit_alias', key: 'unit_alias', width: 30 },
      { header: 'login_name', key: 'login_name', width: 25 },
      { header: 'login_code', key: 'login_code', width: 25 },
      { header: 'booklet_id', key: 'booklet_id', width: 30 },
      { header: 'variable_id', key: 'variable_id', width: 30 },
      { header: 'variable_page', key: 'variable_page', width: 15 },
      { header: 'variable_anchor', key: 'variable_anchor', width: 30 },
      { header: 'url', key: 'url', width: 60 }
    ];

    const { items } = await this.getCodingList(workspace_id, '', '');
    items.forEach(item => worksheet.addRow(item));

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
