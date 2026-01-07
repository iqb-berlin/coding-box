import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, IsNull, Not, Repository
} from 'typeorm';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { ResponseEntity } from '../../common';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { SaveCodingProgressDto } from '../dto/save-coding-progress.dto';

@Injectable()
export class CodingJobQueryService {
  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    private workspacesFacadeService: WorkspacesFacadeService
  ) {}

  async getCodingJobProgress(jobId: number): Promise<{ progress: number; coded: number; total: number; open: number }> {
    const units = await this.codingJobUnitRepository.find({
      where: { coding_job_id: jobId }
    });

    if (units.length === 0) {
      return {
        progress: 0, coded: 0, total: 0, open: 0
      };
    }

    const total = units.length;
    const coded = units.filter(u => u.code !== null && u.code !== undefined && u.code >= 0).length;
    const open = total - coded;
    const progress = Math.round((coded / total) * 100);

    return {
      progress, coded, total, open
    };
  }

  async getCodingJobs(
    workspaceId: number,
    page: number = 1,
    limit?: number
  ): Promise<{ data: (CodingJob & {
      assignedCoders?: number[];
      assignedVariables?: { unitName: string; variableId: string }[];
      assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
      progress?: number;
      codedUnits?: number;
      totalUnits?: number;
      openUnits?: number;
    })[]; total: number; totalOpenUnits?: number; page: number; limit?: number }> {
    const query = this.codingJobRepository.createQueryBuilder('job')
      .where('job.workspace_id = :workspaceId', { workspaceId })
      .leftJoinAndSelect('job.codingJobCoders', 'coder')
      .leftJoinAndSelect('coder.user', 'user')
      .orderBy('job.created_at', 'DESC');

    if (limit) {
      query.skip((page - 1) * limit).take(limit);
    }

    const [jobs, total] = await query.getManyAndCount();

    const jobIds = jobs.map(j => j.id);
    const variables = jobIds.length > 0 ? await this.codingJobVariableRepository.find({
      where: { coding_job_id: In(jobIds) }
    }) : [];
    const bundles = jobIds.length > 0 ? await this.variableBundleRepository.find({
      where: { codingJobVariableBundles: { coding_job_id: In(jobIds) } },
      relations: ['codingJobVariableBundles']
    }) : [];

    const jobsWithDetails = await Promise.all(jobs.map(async job => {
      const jobVariables = variables.filter(v => v.coding_job_id === job.id);
      const jobBundles = bundles.filter(b => b.codingJobVariableBundles.some(cjb => cjb.coding_job_id === job.id));
      const progress = await this.getCodingJobProgress(job.id);

      return {
        ...job,
        assignedCoders: job.codingJobCoders.map(c => c.user_id),
        assignedVariables: jobVariables.map(v => ({ unitName: v.unit_name, variableId: v.variable_id })),
        assignedVariableBundles: jobBundles.map(b => ({ name: b.name, variables: b.variables })),
        progress: progress.progress,
        codedUnits: progress.coded,
        totalUnits: progress.total,
        openUnits: progress.open
      };
    }));

    // Calculate total open units for the workspace across all jobs
    let totalOpenUnits = 0;
    if (jobIds.length > 0) {
      totalOpenUnits = await this.codingJobUnitRepository.count({
        where: {
          coding_job_id: In(jobIds),
          code: IsNull()
        }
      });
    }

    return {
      data: jobsWithDetails,
      total,
      totalOpenUnits,
      page,
      limit
    };
  }

  async getCodingJob(id: number, workspaceId?: number): Promise<{
    codingJob: CodingJob;
    assignedCoders: number[];
    variables: { unitName: string; variableId: string }[];
    variableBundles: VariableBundle[];
  }> {
    const where: Record<string, unknown> = { id };
    if (workspaceId) {
      where.workspace_id = workspaceId;
    }

    const codingJob = await this.codingJobRepository.findOne({
      where,
      relations: ['codingJobCoders', 'codingJobCoders.user']
    });

    if (!codingJob) {
      throw new Error(`Coding job with ID ${id} not found`);
    }

    const variables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });

    const variableBundles = await this.variableBundleRepository.find({
      where: { codingJobVariableBundles: { coding_job_id: id } }
    });

    return {
      codingJob,
      assignedCoders: codingJob.codingJobCoders.map(c => c.user_id),
      variables: variables.map(v => ({ unitName: v.unit_name, variableId: v.variable_id })),
      variableBundles
    };
  }

  async getCodingJobsByCoder(coderId: number): Promise<CodingJob[]> {
    const jobCoders = await this.codingJobCoderRepository.find({
      where: { user_id: coderId },
      relations: ['coding_job']
    });
    return jobCoders.map(jc => jc.coding_job);
  }

  async getCodersByJobId(jobId: number): Promise<number[]> {
    const jobCoders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: jobId }
    });
    return jobCoders.map(jc => jc.user_id);
  }

  async getCodingJobById(id: number): Promise<CodingJob & {
    assignedCoders?: number[];
    assignedVariables?: { unitName: string; variableId: string }[];
    assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
    variables?: { unitName: string; variableId: string }[];
    variableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
  }> {
    const job = await this.codingJobRepository.findOne({
      where: { id },
      relations: ['codingJobCoders', 'codingJobCoders.user']
    });

    if (!job) {
      throw new Error(`Coding job with id ${id} not found`);
    }

    const assignedVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });

    const variableBundles = await this.variableBundleRepository.find({
      where: { codingJobVariableBundles: { coding_job_id: id } }
    });

    return {
      ...job,
      assignedCoders: job.codingJobCoders.map(c => c.user_id),
      assignedVariables: assignedVariables.map(v => ({ unitName: v.unit_name, variableId: v.variable_id })),
      assignedVariableBundles: variableBundles.map(b => ({ name: b.name, variables: b.variables })),
      variables: assignedVariables.map(v => ({ unitName: v.unit_name, variableId: v.variable_id })),
      variableBundles: variableBundles.map(b => ({ name: b.name, variables: b.variables }))
    };
  }

  async getResponsesForCodingJob(codingJobId: number): Promise<ResponseEntity[]> {
    const jobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: codingJobId }
    });

    if (jobVariables.length === 0) {
      return [];
    }

    const job = await this.codingJobRepository.findOneBy({ id: codingJobId });
    if (!job) return [];

    return this.workspacesFacadeService.findCodingIncompleteResponsesForVariables(
      job.workspace_id,
      jobVariables.map(v => ({ unitName: v.unit_name, variableId: v.variable_id }))
    );
  }

  async getCodingProgress(codingJobId: number): Promise<Record<string, SaveCodingProgressDto['selectedCode']>> {
    const units = await this.codingJobUnitRepository.find({
      where: { coding_job_id: codingJobId }
    });

    const progress: Record<string, SaveCodingProgressDto['selectedCode']> = {};
    units.forEach(unit => {
      const key = `${unit.person_login}_${unit.person_code}_${unit.response_id}_${unit.variable_id}`;
      progress[key] = {
        id: unit.code || 0,
        score: unit.score ?? undefined
      } as SaveCodingProgressDto['selectedCode'];
    });

    return progress;
  }

  async getCodingNotes(codingJobId: number): Promise<Record<string, string>> {
    const units = await this.codingJobUnitRepository.find({
      where: { coding_job_id: codingJobId }
    });

    const notes: Record<string, string> = {};
    units.forEach(unit => {
      const key = `${unit.person_login}_${unit.person_code}_${unit.response_id}_${unit.variable_id}`;
      if (unit.notes) {
        notes[key] = unit.notes;
      }
    });

    return notes;
  }

  async getCodingJobUnits(codingJobId: number, onlyOpen: boolean = false): Promise<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string; notes: string | null }[]> {
    const where: Record<string, unknown> = { coding_job_id: codingJobId };
    if (onlyOpen) {
      where.code = IsNull();
    }

    const units = await this.codingJobUnitRepository.find({
      where,
      relations: ['response', 'response.unit', 'response.unit.booklet', 'response.unit.booklet.bookletinfo', 'response.unit.booklet.person']
    });

    return units.map(u => ({
      responseId: u.response_id,
      unitName: u.unit_name,
      unitAlias: u.response?.unit?.name || null,
      variableId: u.variable_id,
      variableAnchor: u.variable_id,
      bookletName: u.response?.unit?.booklet?.bookletinfo?.name || '',
      personLogin: u.person_login,
      personCode: u.person_code,
      personGroup: u.person_group,
      notes: u.notes
    }));
  }

  async getCodingSchemes(unitAliases: string[], workspaceId: number): Promise<Map<string, Record<string, unknown>>> {
    const codingSchemeRefs = unitAliases.filter(alias => alias !== null);
    const codingSchemes = new Map<string, Record<string, unknown>>();

    if (codingSchemeRefs.length === 0) {
      return codingSchemes;
    }

    const codingSchemeFiles = await this.workspacesFacadeService.findFilesByFileIds(workspaceId, codingSchemeRefs);

    for (const file of codingSchemeFiles) {
      try {
        const data = typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        codingSchemes.set(file.file_id, data);
      } catch (error) {
        codingSchemes.set(file.file_id, {});
      }
    }

    return codingSchemes;
  }

  async hasCodingIssues(codingJobId: number): Promise<boolean> {
    const count = await this.codingJobUnitRepository.count({
      where: {
        coding_job_id: codingJobId,
        coding_issue_option: Not(IsNull())
      }
    });
    return count > 0;
  }

  async getVariableCasesInJobs(workspaceId: number): Promise<Map<string, number>> {
    const results = await this.codingJobUnitRepository.createQueryBuilder('unit')
      .select('unit.unit_name', 'unitName')
      .addSelect('unit.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT unit.response_id)', 'count')
      .innerJoin('unit.coding_job', 'job')
      .where('job.workspace_id = :workspaceId', { workspaceId })
      .groupBy('unit.unit_name')
      .addGroupBy('unit.variable_id')
      .getRawMany();

    const casesMap = new Map<string, number>();
    results.forEach(res => {
      casesMap.set(`${res.unitName}|${res.variableId}`, parseInt(res.count, 10));
    });

    return casesMap;
  }

  async getBulkCodingProgress(codingJobIds: number[], workspaceId: number): Promise<Record<number, Record<string, SaveCodingProgressDto['selectedCode']>>> {
    const units = await this.codingJobUnitRepository.find({
      where: {
        coding_job_id: In(codingJobIds),
        coding_job: { workspace_id: workspaceId }
      }
    });

    const progress: Record<number, Record<string, SaveCodingProgressDto['selectedCode']>> = {};
    units.forEach(unit => {
      if (!progress[unit.coding_job_id]) {
        progress[unit.coding_job_id] = {};
      }
      const key = `${unit.person_login}_${unit.person_code}_${unit.response_id}_${unit.variable_id}`;
      progress[unit.coding_job_id][key] = {
        id: unit.code || 0,
        score: unit.score ?? undefined
      } as SaveCodingProgressDto['selectedCode'];
    });

    return progress;
  }
}
