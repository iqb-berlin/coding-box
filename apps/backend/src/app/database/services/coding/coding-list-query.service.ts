import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { extractVariableLocation } from '../../../utils/voud/extractVariableLocation';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { CodingItem } from './coding-item-builder.service';

/**
 * Service responsible for querying coding lists and variables.
 *
 * Handles:
 * - Getting complete coding lists with filtering
 * - Getting coding list variables
 * - Sorting and organizing results
 */
@Injectable()
export class CodingListQueryService {
  private readonly logger = new Logger(CodingListQueryService.name);

  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly workspaceFilesService: WorkspaceFilesService
  ) {}

  /**
   * Get the complete coding list for a workspace.
   * Returns all CODING_INCOMPLETE responses that should be coded.
   */
  async getCodingList(
    workspace_id: number,
    authToken: string,
    serverUrl?: string
  ): Promise<{
      items: CodingItem[];
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

      this.logger.log(
        `Found ${voudFiles.length} VOUD files for workspace ${workspace_id}`
      );

      const variablePageMap = new Map<string, Map<string, string>>();
      for (const voudFile of voudFiles) {
        try {
          const respDefinition = { definition: voudFile.data };
          const variableLocation = extractVariableLocation([respDefinition]);
          const unitVarPages = new Map<string, string>();
          for (const pageInfo of variableLocation[0].variable_pages) {
            unitVarPages.set(
              pageInfo.variable_ref,
              pageInfo.variable_path?.pages?.toString() || '0'
            );
          }
          variablePageMap.set(
            voudFile.file_id.replace('.VOUD', ''),
            unitVarPages
          );
        } catch (error) {
          this.logger.error(
            `Error parsing VOUD file ${voudFile.filename}: ${error.message}`
          );
        }
      }

      // 2) Query all coding incomplete responses
      const queryBuilder = this.responseRepository
        .createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status_v1 = :status', {
          status: statusStringToNumber('CODING_INCOMPLETE')
        })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id })
        .andWhere('person.consider = :consider', { consider: true })
        .orderBy('response.id', 'ASC');

      const [responses, total] = await queryBuilder.getManyAndCount();

      // 3) Build exclusion Set from VOCS files where sourceType == BASE_NO_VALUE
      interface VocsScheme {
        variableCodings?: { id: string; sourceType?: string }[];
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
          const data =
            typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
          const scheme = data as VocsScheme;
          const vars = scheme?.variableCodings || [];
          for (const vc of vars) {
            if (
              vc &&
              vc.id &&
              vc.sourceType &&
              vc.sourceType === 'BASE_NO_VALUE'
            ) {
              excludedPairs.add(`${unitKey}||${vc.id}`);
            }
          }
        } catch (e) {
          this.logger.error(
            `Error parsing VOCS file ${file.file_id}: ${e.message}`
          );
        }
      }

      // 4) Map responses to output and filter by excludedPairs, variable id substrings, and empty values
      const filtered = responses.filter(r => {
        const unitKey = r.unit?.name || '';
        const variableId = r.variableid || '';
        const hasExcludedPair = excludedPairs.has(`${unitKey}||${variableId}`);
        const hasExcludedSubstring = /image|text|audio|frame|video|_0/i.test(
          variableId
        );
        const hasValue = r.value != null && r.value.trim() !== '';
        return !hasExcludedPair && !hasExcludedSubstring && hasValue;
      });

      const result = filtered.map(response => {
        const unit = response.unit;
        const booklet = unit?.booklet;
        const person = booklet?.person;
        const bookletInfo = booklet?.bookletinfo;
        const loginName = person?.login || '';
        const loginCode = person?.code || '';
        const loginGroup = person?.group || '';
        const bookletId = bookletInfo?.name || '';
        const unitKey = unit?.name || '';
        const unitAlias = unit?.alias || '';
        const variableId = response.variableid || '';
        const unitVarPages = variablePageMap.get(unitKey);
        const variablePage = unitVarPages?.get(variableId) || '0';
        const variableAnchor = variableId;

        const url = `${server}/#/replay/${loginName}@${loginCode}@${loginGroup}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

        return {
          unit_key: unitKey,
          unit_alias: unitAlias,
          person_login: loginName,
          person_code: loginCode,
          person_group: loginGroup,
          booklet_name: bookletId,
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

      this.logger.log(
        `Found ${sortedResult.length} coding items after filtering derived variables, total raw ${total}`
      );
      return { items: sortedResult, total };
    } catch (error) {
      this.logger.error(`Error fetching coding list: ${error.message}`);
      return { items: [], total: 0 };
    }
  }

  /**
   * Get all variables that need coding for a workspace.
   * Returns distinct unit/variable pairs.
   */
  async getCodingListVariables(
    workspaceId: number
  ): Promise<Array<{ unitName: string; variableId: string }>> {
    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .distinct(true)
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      });

    interface VocsScheme {
      variableCodings?: { id: string; sourceType?: string }[];
    }

    const vocsFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: Like('%.VOCS')
      },
      select: ['file_id', 'data']
    });

    const excludedPairs = new Set<string>(); // key: `${unitKey}||${variableId}`
    for (const file of vocsFiles) {
      try {
        const unitKey = file.file_id.replace('.VOCS', '');
        const data =
          typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        const scheme = data as VocsScheme;
        const vars = scheme?.variableCodings || [];
        for (const vc of vars) {
          if (
            vc &&
            vc.id &&
            vc.sourceType &&
            vc.sourceType === 'BASE_NO_VALUE'
          ) {
            excludedPairs.add(`${unitKey}||${vc.id}`);
          }
        }
      } catch (e) {
        this.logger.error(
          `Error parsing VOCS file ${file.file_id}: ${e.message}`
        );
      }
    }

    if (excludedPairs.size > 0) {
      const exclusionConditions: string[] = [];
      const exclusionParams: Record<string, string> = {};

      Array.from(excludedPairs).forEach((pair, index) => {
        const [unitKey, varId] = pair.split('||');
        const unitParam = `unit${index}`;
        const varParam = `var${index}`;
        exclusionConditions.push(
          `NOT (unit.name = :${unitParam} AND response.variableid = :${varParam})`
        );
        exclusionParams[unitParam] = unitKey;
        exclusionParams[varParam] = varId;
      });

      queryBuilder.andWhere(
        `(${exclusionConditions.join(' AND ')})`,
        exclusionParams
      );
    }

    // Exclude media variables and derived variables
    queryBuilder.andWhere(
      `response.variableid NOT LIKE 'image%'
       AND response.variableid NOT LIKE 'text%'
       AND response.variableid NOT LIKE 'audio%'
       AND response.variableid NOT LIKE 'frame%'
       AND response.variableid NOT LIKE 'video%'
       AND response.variableid NOT LIKE '%_0' ESCAPE '\\'`
    );

    queryBuilder.andWhere(
      "(response.value IS NOT NULL AND response.value != '')"
    );

    const rawResults = await queryBuilder.getRawMany();

    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(
      workspaceId
    );

    const validVariableSets = new Map<string, Set<string>>();
    unitVariableMap.forEach((variables: Set<string>, unitName: string) => {
      validVariableSets.set(unitName.toUpperCase(), variables);
    });

    const filteredResults = rawResults.filter(row => {
      const unitNamesValidVars = validVariableSets.get(
        row.unitName?.toUpperCase()
      );
      return unitNamesValidVars?.has(row.variableId);
    });

    this.logger.log(
      `Found ${rawResults.length} CODING_INCOMPLETE variable groups, filtered to ${filteredResults.length} valid variables`
    );

    return filteredResults;
  }
}
