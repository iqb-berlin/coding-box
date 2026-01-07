import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { ResponseEntity } from '../../common';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';

export enum ResponseMatchingFlag {
  NO_AGGREGATION = 'NO_AGGREGATION',
  IGNORE_CASE = 'IGNORE_CASE',
  IGNORE_WHITESPACE = 'IGNORE_WHITESPACE'
}

export interface JobCreationWarning {
  unitName: string;
  variableId: string;
  message: string;
  casesInJobs: number;
  availableCases: number;
}

export interface VariableReference {
  unitName: string;
  variableId: string;
}

export interface BundleItem {
  id: number;
  name: string;
  variables: VariableReference[];
}

export interface DistributionItem {
  type: 'bundle' | 'variable';
  item: BundleItem | VariableReference;
}

@Injectable()
export class ResponseDistributionService {
  private readonly logger = new Logger(ResponseDistributionService.name);

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private workspacesFacadeService: WorkspacesFacadeService
  ) {}

  distributeDoubleCodingEvenly(
    doubleCodingResponses: ResponseEntity[],
    sortedCoders: { id: number; name: string; username: string }[]
  ): { response: ResponseEntity; coders: { id: number; name: string }[] }[] {
    const assignments: { response: ResponseEntity; coders: { id: number; name: string }[] }[] = [];
    const numCoders = sortedCoders.length;

    const doubleCodingCounts = new Map(sortedCoders.map(c => [c.id, 0]));

    for (const response of doubleCodingResponses) {
      const coderCounts = sortedCoders.map(coder => ({
        id: coder.id,
        name: coder.name,
        count: doubleCodingCounts.get(coder.id) || 0
      }));

      coderCounts.sort((a, b) => a.count - b.count);

      const selectedCoders = coderCounts
        .slice(0, Math.min(2, numCoders))
        .sort((a, b) => a.name.localeCompare(b.name));

      assignments.push({
        response,
        coders: selectedCoders.map(c => ({ id: c.id, name: c.name }))
      });

      selectedCoders.forEach(coder => {
        doubleCodingCounts.set(coder.id, (doubleCodingCounts.get(coder.id) || 0) + 1);
      });
    }

    return assignments;
  }

  distributeCasesForVariable(
    responses: ResponseEntity[],
    doubleCodingResponses: ResponseEntity[],
    sortedCoders: { id: number; name: string; username: string }[]
  ): ResponseEntity[][] {
    const numCoders = sortedCoders.length;
    const coderCases: ResponseEntity[][] = sortedCoders.map(() => []);

    const singleCodingResponses = responses.filter(r => !doubleCodingResponses.some(dc => dc.id === r.id));

    sortedCoders.forEach((coder, coderIndex) => {
      doubleCodingResponses.forEach(doubleCodingResponse => {
        coderCases[coderIndex].push(doubleCodingResponse);
      });
    });

    const totalSingleCases = singleCodingResponses.length;
    if (totalSingleCases === 0) return coderCases;

    const baseCasesPerCoder = Math.floor(totalSingleCases / numCoders);
    const remainder = totalSingleCases % numCoders;

    sortedCoders.forEach((coder, index) => {
      let casesForCoder = baseCasesPerCoder;
      if (index < remainder) {
        casesForCoder += 1;
      }

      const startIndex = index * baseCasesPerCoder + Math.min(index, remainder);
      const endIndex = startIndex + casesForCoder;
      const casesSlice = singleCodingResponses.slice(startIndex, endIndex);
      coderCases[index].push(...casesSlice);
    });

    return coderCases;
  }

  async getResponseMatchingMode(workspaceId: number): Promise<ResponseMatchingFlag[]> {
    const settingKey = `workspace-${workspaceId}-response-matching-mode`;
    const setting = await this.workspacesFacadeService.findSettingByKey(settingKey);

    if (!setting) {
      return [];
    }

    try {
      const parsed = JSON.parse(setting.content);
      return parsed.flags || [];
    } catch {
      return [];
    }
  }

  normalizeValue(value: string | null, flags: ResponseMatchingFlag[]): string {
    if (value === null || value === undefined) {
      return '';
    }

    let normalized = value;

    if (flags.includes(ResponseMatchingFlag.IGNORE_CASE)) {
      normalized = normalized.toLowerCase();
    }

    if (flags.includes(ResponseMatchingFlag.IGNORE_WHITESPACE)) {
      normalized = normalized.replace(/\s+/g, '');
    }

    return normalized;
  }

  aggregateResponsesByValue(
    responses: ResponseEntity[],
    flags: ResponseMatchingFlag[]
  ): { normalizedValue: string; responses: ResponseEntity[]; totalResponses: number }[] {
    if (flags.includes(ResponseMatchingFlag.NO_AGGREGATION)) {
      return responses.map(r => ({
        normalizedValue: r.value || '',
        responses: [r],
        totalResponses: 1
      }));
    }

    const groups = new Map<string, ResponseEntity[]>();

    for (const response of responses) {
      const normalizedValue = this.normalizeValue(response.value, flags);
      const existing = groups.get(normalizedValue) || [];
      existing.push(response);
      groups.set(normalizedValue, existing);
    }

    return Array.from(groups.entries()).map(([normalizedValue, groupResponses]) => ({
      normalizedValue,
      responses: groupResponses,
      totalResponses: groupResponses.length
    }));
  }

  async getResponsesForVariables(workspaceId: number, variables: { unitName: string; variableId: string }[]): Promise<ResponseEntity[]> {
    if (variables.length === 0) {
      return [];
    }
    return this.workspacesFacadeService.findCodingIncompleteResponsesForVariables(workspaceId, variables);
  }

  async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    const rawResults = await this.codingJobUnitRepository.createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT cju.response_id)', 'casesInJobs')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .getRawMany();

    const casesInJobsMap = new Map<string, number>();

    rawResults.forEach(row => {
      const key = `${row.unitName}::${row.variableId}`;
      casesInJobsMap.set(key, parseInt(row.casesInJobs, 10));
    });

    return casesInJobsMap;
  }

  async calculateDistribution(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[];
      selectedCoders: { id: number; name: string; username: string }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number;
    }
  ): Promise<{
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: ResponseMatchingFlag[];
      warnings: JobCreationWarning[];
    }> {
    const {
      selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, caseOrderingMode = 'continuous', maxCodingCases
    } = request;
    const distribution: Record<string, Record<string, number>> = {};
    const doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }> = {};
    const aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }> = {};
    const warnings: JobCreationWarning[] = [];

    const matchingFlags = await this.getResponseMatchingMode(workspaceId);

    let remainingCases = typeof maxCodingCases === 'number' && maxCodingCases > 0 ? maxCodingCases : undefined;

    const items: DistributionItem[] = [];
    const allVariables: VariableReference[] = [];

    if (request.selectedVariableBundles) {
      for (const bundle of request.selectedVariableBundles) {
        items.push({ type: 'bundle', item: bundle });
        allVariables.push(...bundle.variables);
      }
    }

    for (const variable of selectedVariables) {
      items.push({ type: 'variable', item: variable });
      allVariables.push(variable);
    }

    const allResponses = await this.getResponsesForVariables(workspaceId, allVariables);

    const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);
    for (const variable of allVariables) {
      const key = `${variable.unitName}::${variable.variableId}`;
      const casesInJobs = casesInJobsMap.get(key) || 0;
      const totalAvailable = allResponses.filter(r => r.unit?.name === variable.unitName && r.variableid === variable.variableId).length;
      const availableCases = totalAvailable - casesInJobs;

      if (casesInJobs > 0 && availableCases > 0 && availableCases < totalAvailable) {
        warnings.push({
          unitName: variable.unitName,
          variableId: variable.variableId,
          message: `Variable: nur noch ${availableCases} von ${totalAvailable} Fällen verfügbar`,
          casesInJobs,
          availableCases
        });
      }
    }

    const sortedCoders = [...selectedCoders].sort((a, b) => a.name.localeCompare(b.name));

    for (const itemObj of items) {
      let itemVariables: { unitName: string; variableId: string }[];
      let itemKey = '';

      if (itemObj.type === 'bundle') {
        const bundleItem = itemObj.item as BundleItem;
        itemVariables = bundleItem.variables;
        itemKey = bundleItem.name;
      } else {
        const variableItem = itemObj.item as VariableReference;
        itemVariables = [variableItem];
        itemKey = `${variableItem.unitName}::${variableItem.variableId}`;
      }

      const responses = allResponses.filter(response =>
        itemVariables.some(v => v.unitName === response.unit?.name && v.variableId === response.variableid)
      );
      const totalResponses = responses.length;

      const aggregatedGroups = this.aggregateResponsesByValue(responses, matchingFlags);
      const uniqueCases = aggregatedGroups.length;

      aggregationInfo[itemKey] = {
        uniqueCases,
        totalResponses
      };

      const totalCases = uniqueCases;

      if (!isSafeKey(itemKey)) continue;
      distribution[itemKey] = {};
      doubleCodingInfo[itemKey] = {
        totalCases: totalCases,
        doubleCodedCases: 0,
        singleCodedCasesAssigned: 0,
        doubleCodedCasesPerCoder: {}
      };

      if (totalCases === 0) {
        sortedCoders.forEach(coder => {
          if (isSafeKey(coder.name)) {
            distribution[itemKey][coder.name] = 0;
          }
        });
        continue;
      }

      let doubleCodingCount = 0;
      if (doubleCodingAbsolute && doubleCodingAbsolute > 0) {
        doubleCodingCount = Math.min(doubleCodingAbsolute, totalCases);
      } else if (doubleCodingPercentage && doubleCodingPercentage > 0) {
        doubleCodingCount = Math.floor((doubleCodingPercentage / 100) * totalCases);
      }

      if (remainingCases !== undefined) {
        doubleCodingCount = Math.min(doubleCodingCount, remainingCases);
      }

      const sortedResponses = [...responses].sort((a, b) => {
        if (caseOrderingMode === 'alternating') {
          const aUnitName = a.unit?.name || '';
          const bUnitName = b.unit?.name || '';
          if (aUnitName !== bUnitName) return aUnitName.localeCompare(bUnitName);

          const aLogin = a.unit?.booklet?.person?.login || '';
          const bLogin = b.unit?.booklet?.person?.login || '';
          if (aLogin !== bLogin) return aLogin.localeCompare(bLogin);

          const aCode = a.unit?.booklet?.person?.code || '';
          const bCode = b.unit?.booklet?.person?.code || '';
          if (aCode !== bCode) return aCode.localeCompare(bCode);

          const aGroup = a.unit?.booklet?.person?.group || '';
          const bGroup = b.unit?.booklet?.person?.group || '';
          if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);

          const aBooklet = a.unit?.booklet?.bookletinfo?.name || '';
          const bBooklet = b.unit?.booklet?.bookletinfo?.name || '';
          if (aBooklet !== bBooklet) return aBooklet.localeCompare(bBooklet);

          if (a.variableid !== b.variableid) return a.variableid.localeCompare(b.variableid);

          return a.id - b.id;
        }
        if (a.variableid !== b.variableid) return a.variableid.localeCompare(b.variableid);

        const aUnitName = a.unit?.name || '';
        const bUnitName = b.unit?.name || '';
        if (aUnitName !== bUnitName) return aUnitName.localeCompare(bUnitName);

        const aLogin = a.unit?.booklet?.person?.login || '';
        const bLogin = b.unit?.booklet?.person?.login || '';
        if (aLogin !== bLogin) return aLogin.localeCompare(bLogin);

        const aCode = a.unit?.booklet?.person?.code || '';
        const bCode = b.unit?.booklet?.person?.code || '';
        if (aCode !== bCode) return aCode.localeCompare(bCode);

        const aGroup = a.unit?.booklet?.person?.group || '';
        const bGroup = b.unit?.booklet?.person?.group || '';
        if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);

        const aBooklet = a.unit?.booklet?.bookletinfo?.name || '';
        const bBooklet = b.unit?.booklet?.bookletinfo?.name || '';
        if (aBooklet !== bBooklet) return aBooklet.localeCompare(bBooklet);

        return a.id - b.id;
      });
      const doubleCodingResponses = sortedResponses.slice(0, doubleCodingCount);

      if (remainingCases !== undefined) {
        remainingCases -= doubleCodingCount;
      }

      doubleCodingInfo[itemKey].doubleCodedCases = doubleCodingCount;

      let actualSingleCodingCases = totalCases - doubleCodingCount;
      if (remainingCases !== undefined && remainingCases < actualSingleCodingCases) {
        actualSingleCodingCases = remainingCases;
      }
      doubleCodingInfo[itemKey].singleCodedCasesAssigned = actualSingleCodingCases;

      sortedCoders.forEach(coder => {
        if (isSafeKey(coder.name)) {
          doubleCodingInfo[itemKey].doubleCodedCasesPerCoder[coder.name] = 0;
        }
      });

      const caseDistribution = this.distributeCasesForVariable(
        responses,
        doubleCodingResponses,
        sortedCoders
      );

      const doubleCodingAssignments = this.distributeDoubleCodingEvenly(
        doubleCodingResponses,
        sortedCoders
      );
      for (const { coders: assignedCoders } of doubleCodingAssignments) {
        for (const coder of assignedCoders) {
          doubleCodingInfo[itemKey].doubleCodedCasesPerCoder[coder.name] += 1;
        }
      }

      for (let i = 0; i < sortedCoders.length; i++) {
        const coder = sortedCoders[i];
        const coderCases = caseDistribution[i];

        let caseCount = coderCases.length;

        if (remainingCases !== undefined) {
          if (remainingCases <= 0) {
            caseCount = 0;
          } else {
            caseCount = Math.min(caseCount, remainingCases);
            remainingCases -= caseCount;
          }
        }

        if (isSafeKey(coder.name)) {
          distribution[itemKey][coder.name] = caseCount;
        }
      }

      doubleCodingInfo[itemKey].totalCases = Object.values(distribution[itemKey]).reduce((sum, value) => sum + value, 0);
    }

    return {
      distribution, doubleCodingInfo, aggregationInfo, matchingFlags, warnings
    };
  }

  async createDistributedCodingJobs(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[];
      selectedCoders: { id: number; name: string; username: string }[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number;
    },
    mutationService: any
  ): Promise<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: ResponseMatchingFlag[];
      warnings: JobCreationWarning[];
      jobs: {
        coderId: number;
        coderName: string;
        variable: { unitName: string; variableId: string };
        jobId: number;
        jobName: string;
        caseCount: number;
      }[];
    }> {
    this.logger.log(`Creating distributed coding jobs for workspace ${workspaceId}`);

    const {
      selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, maxCodingCases, caseOrderingMode
    } = request;

    let remainingCases = typeof maxCodingCases === 'number' && maxCodingCases > 0 ? maxCodingCases : undefined;
    const distribution: Record<string, Record<string, number>> = {};
    const doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }> = {};
    const aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }> = {};
    const createdJobs: {
      coderId: number;
      coderName: string;
      variable: { unitName: string; variableId: string };
      jobId: number;
      jobName: string;
      caseCount: number;
    }[] = [];
    const warnings: JobCreationWarning[] = [];

    const matchingFlags = await this.getResponseMatchingMode(workspaceId);

    try {
      const items: DistributionItem[] = [];
      const allVariables: VariableReference[] = [];

      if (request.selectedVariableBundles) {
        for (const bundle of request.selectedVariableBundles) {
          items.push({ type: 'bundle', item: bundle });
          allVariables.push(...bundle.variables);
        }
      }

      for (const variable of selectedVariables) {
        items.push({ type: 'variable', item: variable });
        allVariables.push(variable);
      }

      const allResponses = await this.getResponsesForVariables(workspaceId, allVariables);

      const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);
      for (const variable of allVariables) {
        const key = `${variable.unitName}::${variable.variableId}`;
        const casesInJobs = casesInJobsMap.get(key) || 0;
        const totalAvailable = allResponses.filter(r => r.unit?.name === variable.unitName && r.variableid === variable.variableId).length;
        const availableCases = totalAvailable - casesInJobs;

        if (casesInJobs > 0 && availableCases > 0 && availableCases < totalAvailable) {
          warnings.push({
            unitName: variable.unitName,
            variableId: variable.variableId,
            message: `Variable: nur noch ${availableCases} von ${totalAvailable} Fällen verfügbar`,
            casesInJobs,
            availableCases
          });
        }
      }

      const sortedCoders = [...selectedCoders].sort((a, b) => a.name.localeCompare(b.name));

      for (const itemObj of items) {
        let itemVariables: { unitName: string; variableId: string }[];
        let itemKey = '';

        if (itemObj.type === 'bundle') {
          const bundleItem = itemObj.item as BundleItem;
          itemVariables = bundleItem.variables;
          itemKey = bundleItem.name;
        } else {
          const variableItem = itemObj.item as VariableReference;
          itemVariables = [variableItem];
          itemKey = `${variableItem.unitName}::${variableItem.variableId}`;
        }

        const responses = allResponses.filter(response =>
          itemVariables.some(v => v.unitName === response.unit?.name && v.variableId === response.variableid)
        );
        const totalResponses = responses.length;

        const aggregatedGroups = this.aggregateResponsesByValue(responses, matchingFlags);
        const uniqueCases = aggregatedGroups.length;

        if (!aggregationInfo) {
          (aggregationInfo as any) = {};
        }
        aggregationInfo[itemKey] = {
          uniqueCases,
          totalResponses
        };

        const totalCases = uniqueCases;

        if (!isSafeKey(itemKey)) continue;
        distribution[itemKey] = {};
        doubleCodingInfo[itemKey] = {
          totalCases: totalCases,
          doubleCodedCases: 0,
          singleCodedCasesAssigned: 0,
          doubleCodedCasesPerCoder: {}
        };

        if (totalCases === 0) {
          for (const coder of sortedCoders) {
            if (isSafeKey(coder.name)) {
              distribution[itemKey][coder.name] = 0;
              doubleCodingInfo[itemKey].doubleCodedCasesPerCoder[coder.name] = 0;
            }
          }
          continue;
        }

        let doubleCodingCount = 0;
        if (doubleCodingAbsolute && doubleCodingAbsolute > 0) {
          doubleCodingCount = Math.min(doubleCodingAbsolute, totalCases);
        } else if (doubleCodingPercentage && doubleCodingPercentage > 0) {
          doubleCodingCount = Math.floor((doubleCodingPercentage / 100) * totalCases);
        }

        const sortedResponses = [...responses].sort((a, b) => {
          const aVariableId = a.variableid || '';
          const bVariableId = b.variableid || '';
          const aUnitName = a.unit?.name || '';
          const bUnitName = b.unit?.name || '';
          const aLogin = a.unit?.booklet?.person?.login || '';
          const bLogin = b.unit?.booklet?.person?.login || '';
          const aCode = a.unit?.booklet?.person?.code || '';
          const bCode = b.unit?.booklet?.person?.code || '';
          const aGroup = a.unit?.booklet?.person?.group || '';
          const bGroup = b.unit?.booklet?.person?.group || '';
          const aBooklet = a.unit?.booklet?.bookletinfo?.name || '';
          const bBooklet = b.unit?.booklet?.bookletinfo?.name || '';
          if (caseOrderingMode === 'alternating') {
            if (aLogin !== bLogin) return aLogin.localeCompare(bLogin);
            if (aCode !== bCode) return aCode.localeCompare(bCode);
            if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
            if (aBooklet !== bBooklet) return aBooklet.localeCompare(bBooklet);
            if (aUnitName !== bUnitName) return aUnitName.localeCompare(bUnitName);
            if (aVariableId !== bVariableId) return aVariableId.localeCompare(bVariableId);
          } else {
            if (aVariableId !== bVariableId) return aVariableId.localeCompare(bVariableId);
            if (aUnitName !== bUnitName) return aUnitName.localeCompare(bUnitName);
            if (aLogin !== bLogin) return aLogin.localeCompare(bLogin);
            if (aCode !== bCode) return aCode.localeCompare(bCode);
            if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
            if (aBooklet !== bBooklet) return aBooklet.localeCompare(bBooklet);
          }
          return a.id - b.id;
        });

        const doubleCodingResponses = sortedResponses.slice(0, doubleCodingCount);
        const singleCodingResponses = sortedResponses.slice(doubleCodingCount);

        doubleCodingInfo[itemKey].doubleCodedCases = doubleCodingCount;
        doubleCodingInfo[itemKey].singleCodedCasesAssigned = singleCodingResponses.length;

        sortedCoders.forEach(coder => {
          if (isSafeKey(coder.name)) {
            doubleCodingInfo[itemKey].doubleCodedCasesPerCoder[coder.name] = 0;
          }
        });

        const caseDistribution = this.distributeCasesForVariable(
          responses,
          doubleCodingResponses,
          sortedCoders
        );

        const doubleCodingAssignments = this.distributeDoubleCodingEvenly(
          doubleCodingResponses,
          sortedCoders
        );
        for (const { coders: assignedCoders } of doubleCodingAssignments) {
          for (const coder of assignedCoders) {
            if (isSafeKey(coder.name)) {
              doubleCodingInfo[itemKey].doubleCodedCasesPerCoder[coder.name] += 1;
            }
          }
        }

        for (let i = 0; i < sortedCoders.length; i++) {
          const coder = sortedCoders[i];
          const coderCases = caseDistribution[i];

          const singleCases = coderCases.filter(c => !doubleCodingResponses.some(dc => dc.id === c.id));
          const doubleCases = coderCases.filter(c => doubleCodingResponses.some(dc => dc.id === c.id));

          let caseCountForCoder = singleCases.length + doubleCases.length;

          if (remainingCases !== undefined) {
            if (remainingCases <= 0) {
              continue;
            }

            if (caseCountForCoder > remainingCases) {
              caseCountForCoder = remainingCases;

              const limitedCases = [...doubleCases, ...singleCases].slice(0, caseCountForCoder);
              coderCases.length = 0;
              coderCases.push(...limitedCases);
            }

            remainingCases -= caseCountForCoder;
          }

          if (caseCountForCoder <= 0) {
            continue;
          }

          if (isSafeKey(coder.name)) {
            distribution[itemKey][coder.name] = caseCountForCoder;
          }

          const jobName = generateJobName(
            coder.name,
            itemObj.type === 'bundle' ? itemKey : (itemObj.item as any).unitName,
            itemObj.type === 'bundle' ? '' : (itemObj.item as any).variableId,
            caseCountForCoder
          );

          const codingJob = await mutationService.createCodingJobWithUnitSubset(
            workspaceId,
            {
              name: jobName,
              assignedCoders: [coder.id],
              caseOrderingMode,
              ...(itemObj.type === 'bundle' ?
                { variableBundleIds: [(itemObj.item as any).id] } :
                { variables: itemVariables }
              )
            },
            coderCases.map(r => r.id)
          );

          createdJobs.push({
            coderId: coder.id,
            coderName: coder.name,
            variable: { unitName: itemKey, variableId: '' },
            jobId: codingJob.id,
            jobName: jobName,
            caseCount: caseCountForCoder
          });
        }
      }

      this.logger.log(`Successfully created ${createdJobs.length} distributed coding jobs`);

      return {
        success: true,
        jobsCreated: createdJobs.length,
        message: `Created ${createdJobs.length} distributed coding jobs`,
        distribution,
        doubleCodingInfo,
        aggregationInfo,
        matchingFlags,
        warnings,
        jobs: createdJobs
      };
    } catch (error) {
      this.logger.error(`Error creating distributed coding jobs: ${error.message}`, error.stack);
      return {
        success: false,
        jobsCreated: 0,
        message: `Failed to create distributed jobs: ${error.message}`,
        distribution: {},
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        warnings: [],
        jobs: []
      };
    }
  }
}

function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function generateJobName(coderName: string, unitName: string, variableId: string, caseCount: number): string {
  const cleanCoderName = coderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const cleanUnitName = unitName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const cleanVariableId = variableId.replace(/[^a-zA-Z0-9-_]/g, '_');

  return `${cleanCoderName}_${cleanUnitName}_${cleanVariableId}_${caseCount}`;
}
