import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, In, Not, IsNull
} from 'typeorm';
import { SaveCodingProgressDto } from '../../admin/coding-job/dto/save-coding-progress.dto';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { JobDefinition } from '../entities/job-definition.entity';
import { CreateCodingJobDto } from '../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../admin/coding-job/dto/update-coding-job.dto';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { ResponseEntity } from '../entities/response.entity';
import FileUpload from '../entities/file_upload.entity';

interface CodingSchemeCode {
  id: number | string;
  code?: string;
  label?: string;
  score?: number;
}

interface CodingSchemeVariableCoding {
  id: string;
  codes?: CodingSchemeCode[];
}

interface CodingScheme {
  variableCodings?: CodingSchemeVariableCoding[];
}

@Injectable()
export class CodingJobService {
  private readonly logger = new Logger(CodingJobService.name);

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobVariableBundle)
    private codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>
  ) {}

  async getCodingJobProgress(jobId: number): Promise<{ progress: number; coded: number; total: number; open: number }> {
    const totalUnits = await this.codingJobUnitRepository.count({
      where: { coding_job_id: jobId }
    });

    if (totalUnits === 0) {
      return {
        progress: 0, coded: 0, total: 0, open: 0
      };
    }

    const [codedUnits, openUnits] = await Promise.all([
      this.codingJobUnitRepository.count({
        where: {
          coding_job_id: jobId,
          code: Not(IsNull())
        }
      }),
      this.codingJobUnitRepository.count({
        where: {
          coding_job_id: jobId,
          is_open: true
        }
      })
    ]);

    const accessibleUnits = totalUnits;
    const progress = accessibleUnits > 0 ? Math.round((codedUnits / accessibleUnits) * 100) : 0;

    return {
      progress, coded: codedUnits, total: totalUnits, open: openUnits
    };
  }

  async getCodingJobs(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: (CodingJob & {
      assignedCoders?: number[];
      assignedVariables?: { unitName: string; variableId: string }[];
      assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
      progress?: number;
      codedUnits?: number;
      totalUnits?: number;
      openUnits?: number;
    })[]; total: number; totalOpenUnits?: number; page: number; limit: number }> {
    const validPage = page > 0 ? page : 1;
    const validLimit = limit > 0 ? limit : 10;
    const skip = (validPage - 1) * validLimit;

    const total = await this.codingJobRepository.count({
      where: { workspace_id: workspaceId }
    });

    const jobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      relations: ['training'],
      order: { created_at: 'DESC' },
      skip,
      take: validLimit
    });

    const jobIds = jobs.map(job => job.id);

    const [allCoders, allVariables, variableBundleEntities, progressData] = await Promise.all([
      this.codingJobCoderRepository.find({
        where: { coding_job_id: In(jobIds) }
      }),
      this.codingJobVariableRepository.find({
        where: { coding_job_id: In(jobIds) }
      }),
      this.codingJobVariableBundleRepository.find({
        where: { coding_job_id: In(jobIds) },
        relations: ['variable_bundle']
      }),
      Promise.all(jobIds.map(jobId => this.getCodingJobProgress(jobId)))
    ]);

    const codersByJobId = new Map<number, number[]>();
    allCoders.forEach(coder => {
      if (!codersByJobId.has(coder.coding_job_id)) {
        codersByJobId.set(coder.coding_job_id, []);
      }
      codersByJobId.get(coder.coding_job_id)!.push(coder.user_id);
    });

    const variablesByJobId = new Map<number, { unitName: string; variableId: string }[]>();
    allVariables.forEach(variable => {
      if (!variablesByJobId.has(variable.coding_job_id)) {
        variablesByJobId.set(variable.coding_job_id, []);
      }
      variablesByJobId.get(variable.coding_job_id)!.push({
        unitName: variable.unit_name,
        variableId: variable.variable_id
      });
    });

    const variableBundlesByJobId = new Map<number, { name: string; variables: { unitName: string; variableId: string }[] }[]>();
    variableBundleEntities.forEach(bundleAssignment => {
      if (!variableBundlesByJobId.has(bundleAssignment.coding_job_id)) {
        variableBundlesByJobId.set(bundleAssignment.coding_job_id, []);
      }
      if (bundleAssignment.variable_bundle?.name) {
        variableBundlesByJobId.get(bundleAssignment.coding_job_id)!.push({
          name: bundleAssignment.variable_bundle.name,
          variables: bundleAssignment.variable_bundle.variables || []
        });
      }
    });

    const data = jobs.map((job, index) => ({
      ...job,
      assignedCoders: codersByJobId.get(job.id) || [],
      assignedVariables: variablesByJobId.get(job.id) || [],
      assignedVariableBundles: variableBundlesByJobId.get(job.id) || [],
      progress: progressData[index]?.progress || 0,
      codedUnits: progressData[index]?.coded || 0,
      totalUnits: progressData[index]?.total || 0,
      openUnits: progressData[index]?.open || 0
    }));

    const totalOpenUnits = await this.codingJobUnitRepository.count({
      relations: ['coding_job'],
      where: {
        coding_job: { workspace_id: workspaceId },
        is_open: true
      }
    });

    return {
      data,
      total,
      totalOpenUnits,
      page: validPage,
      limit: validLimit
    };
  }

  async getCodingJob(id: number, workspaceId?: number): Promise<{
    codingJob: CodingJob & { durationSeconds?: number };
    assignedCoders: number[];
    variables: { unitName: string; variableId: string }[];
    variableBundles: VariableBundle[];
  }> {
    const whereClause: { id: number; workspace_id?: number } = { id };

    if (workspaceId !== undefined) {
      whereClause.workspace_id = workspaceId;
    }

    const codingJob = await this.codingJobRepository.findOne({ where: whereClause });
    if (!codingJob) {
      if (workspaceId !== undefined) {
        throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
      } else {
        throw new NotFoundException(`Coding job with ID ${id} not found`);
      }
    }

    const coders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: id }
    });
    const assignedCoders = coders.map(coder => coder.user_id);

    const codingJobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });
    const variables = codingJobVariables.map(variable => ({
      unitName: variable.unit_name,
      variableId: variable.variable_id
    }));

    const codingJobVariableBundles = await this.codingJobVariableBundleRepository.find({
      where: { coding_job_id: id }
    });
    const variableBundleIds = codingJobVariableBundles.map(bundle => bundle.variable_bundle_id);
    const variableBundles = await this.variableBundleRepository.find({
      where: { id: In(variableBundleIds) }
    });

    return {
      codingJob,
      assignedCoders,
      variables,
      variableBundles
    };
  }

  async createCodingJob(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto
  ): Promise<CodingJob> {
    const codingJob = this.codingJobRepository.create({
      workspace_id: workspaceId,
      name: createCodingJobDto.name,
      description: createCodingJobDto.description,
      status: createCodingJobDto.status || 'pending',
      missings_profile_id: createCodingJobDto.missings_profile_id,
      job_definition_id: createCodingJobDto.jobDefinitionId
    });

    const savedCodingJob = await this.codingJobRepository.save(codingJob);

    if (createCodingJobDto.assignedCoders && createCodingJobDto.assignedCoders.length > 0) {
      await this.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders);
    }

    if (createCodingJobDto.variables && createCodingJobDto.variables.length > 0) {
      await this.assignVariables(savedCodingJob.id, createCodingJobDto.variables);
    }

    if (createCodingJobDto.variableBundleIds && createCodingJobDto.variableBundleIds.length > 0) {
      await this.assignVariableBundles(savedCodingJob.id, createCodingJobDto.variableBundleIds);
    } else if (createCodingJobDto.variableBundles && createCodingJobDto.variableBundles.length > 0) {
      if (createCodingJobDto.variableBundles[0].id) {
        const bundleIds = createCodingJobDto.variableBundles
          .filter(bundle => bundle.id)
          .map(bundle => bundle.id);

        if (bundleIds.length > 0) {
          await this.assignVariableBundles(savedCodingJob.id, bundleIds);
        }
      } else {
        const variables = createCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
        if (variables.length > 0) {
          await this.assignVariables(savedCodingJob.id, variables);
        }
      }
    }
    await this.saveCodingJobUnits(savedCodingJob.id);

    return savedCodingJob;
  }

  async updateCodingJob(
    id: number,
    workspaceId: number,
    updateCodingJobDto: UpdateCodingJobDto
  ): Promise<CodingJob> {
    const codingJob = await this.getCodingJob(id, workspaceId);

    if (updateCodingJobDto.name !== undefined) {
      codingJob.codingJob.name = updateCodingJobDto.name;
    }
    if (updateCodingJobDto.description !== undefined) {
      codingJob.codingJob.description = updateCodingJobDto.description;
    }
    if (updateCodingJobDto.status !== undefined) {
      codingJob.codingJob.status = updateCodingJobDto.status;
    }
    if (updateCodingJobDto.comment !== undefined) {
      codingJob.codingJob.comment = updateCodingJobDto.comment;
    }
    if (updateCodingJobDto.missingsProfileId !== undefined) {
      codingJob.codingJob.missings_profile_id = updateCodingJobDto.missingsProfileId;
    }

    const savedCodingJob = await this.codingJobRepository.save(codingJob.codingJob);

    if (updateCodingJobDto.assignedCoders !== undefined) {
      await this.codingJobCoderRepository.delete({ coding_job_id: id });
      if (updateCodingJobDto.assignedCoders.length > 0) {
        await this.assignCoders(id, updateCodingJobDto.assignedCoders);
      }
    }

    if (updateCodingJobDto.variables !== undefined) {
      await this.codingJobVariableRepository.delete({ coding_job_id: id });
      if (updateCodingJobDto.variables.length > 0) {
        await this.assignVariables(id, updateCodingJobDto.variables);
      }
    }

    if (updateCodingJobDto.variableBundleIds !== undefined) {
      await this.codingJobVariableBundleRepository.delete({ coding_job_id: id });
      if (updateCodingJobDto.variableBundleIds.length > 0) {
        await this.assignVariableBundles(id, updateCodingJobDto.variableBundleIds);
      }
    } else if (updateCodingJobDto.variableBundles !== undefined) {
      await this.codingJobVariableBundleRepository.delete({ coding_job_id: id });

      if (updateCodingJobDto.variableBundles.length > 0) {
        if (updateCodingJobDto.variableBundles[0].id) {
          const bundleIds = updateCodingJobDto.variableBundles
            .filter(bundle => bundle.id)
            .map(bundle => bundle.id);

          if (bundleIds.length > 0) {
            await this.assignVariableBundles(id, bundleIds);
          }
        } else {
          const variables = updateCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
          if (variables.length > 0) {
            await this.assignVariables(id, variables);
          }
        }
      }
    }

    return savedCodingJob;
  }

  async deleteCodingJob(id: number, workspaceId: number): Promise<{ success: boolean }> {
    const codingJob = await this.getCodingJob(id, workspaceId);

    await this.codingJobRepository.remove(codingJob.codingJob);

    return { success: true };
  }

  async assignCoders(codingJobId: number, userIds: number[]): Promise<CodingJobCoder[]> {
    await this.codingJobCoderRepository.delete({ coding_job_id: codingJobId });
    const coders = userIds.map(userId => this.codingJobCoderRepository.create({
      coding_job_id: codingJobId,
      user_id: userId
    }));

    return this.codingJobCoderRepository.save(coders);
  }

  private async assignVariables(
    codingJobId: number,
    variables: { unitName: string; variableId: string }[]
  ): Promise<CodingJobVariable[]> {
    const codingJobVariables = variables.map(variable => this.codingJobVariableRepository.create({
      coding_job_id: codingJobId,
      unit_name: variable.unitName,
      variable_id: variable.variableId
    }));

    return this.codingJobVariableRepository.save(codingJobVariables);
  }

  private async assignVariableBundles(
    codingJobId: number,
    variableBundleIds: number[]
  ): Promise<CodingJobVariableBundle[]> {
    const variableBundles = variableBundleIds.map(variableBundleId => this.codingJobVariableBundleRepository.create({
      coding_job_id: codingJobId,
      variable_bundle_id: variableBundleId
    }));

    return this.codingJobVariableBundleRepository.save(variableBundles);
  }

  async getCodingJobsByCoder(coderId: number): Promise<CodingJob[]> {
    const codingJobCoders = await this.codingJobCoderRepository.find({
      where: { user_id: coderId },
      relations: ['coding_job']
    });

    return codingJobCoders.map(cjc => cjc.coding_job);
  }

  async getCodersByJobId(jobId: number): Promise<number[]> {
    const codingJobCoders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: jobId }
    });

    return codingJobCoders.map(cjc => cjc.user_id);
  }

  async getCodingJobById(id: number): Promise<CodingJob & {
    assignedCoders?: number[];
    assignedVariables?: { unitName: string; variableId: string }[];
    assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
    variables?: { unitName: string; variableId: string }[];
    variableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
  }> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found`);
    }

    const coders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: id }
    });
    const assignedCoders = coders.map(coder => coder.user_id);

    const codingJobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });
    const assignedVariables = codingJobVariables.map(variable => ({
      unitName: variable.unit_name,
      variableId: variable.variable_id
    }));

    const codingJobVariableBundles = await this.codingJobVariableBundleRepository.find({
      where: { coding_job_id: id },
      relations: ['variable_bundle']
    });

    const assignedVariableBundles = codingJobVariableBundles
      .filter(bundle => bundle.variable_bundle)
      .map(bundle => ({
        name: bundle.variable_bundle.name,
        variables: bundle.variable_bundle.variables || []
      }));

    return {
      ...codingJob,
      assignedCoders,
      assignedVariables,
      assignedVariableBundles
    };
  }

  async getResponsesForCodingJob(codingJobId: number): Promise<ResponseEntity[]> {
    const codingJobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: codingJobId }
    });

    const codingJobVariableBundles = await this.codingJobVariableBundleRepository.find({
      where: { coding_job_id: codingJobId },
      relations: ['variable_bundle']
    });

    const allVariables: { unit_name: string; variable_id: string }[] = codingJobVariables.map(v => ({
      unit_name: v.unit_name,
      variable_id: v.variable_id
    }));
    codingJobVariableBundles.forEach(bundle => {
      if (bundle.variable_bundle?.variables) {
        bundle.variable_bundle.variables.forEach(variable => {
          allVariables.push({
            unit_name: variable.unitName,
            variable_id: variable.variableId
          });
        });
      }
    });

    if (allVariables.length === 0) {
      return [];
    }

    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person');

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    allVariables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(`(unit.name = :${unitParam} AND response.variableid = :${variableParam})`);
      parameters[unitParam] = variable.unit_name;
      parameters[variableParam] = variable.variable_id;
    });

    if (conditions.length > 0) {
      queryBuilder.where(`(${conditions.join(' OR ')})`, parameters);
    }

    return queryBuilder
      .orderBy('response.id', 'ASC')
      .getMany();
  }

  async saveCodingProgress(
    codingJobId: number,
    progress: SaveCodingProgressDto
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    const testPersonParts = progress.testPerson.split('@');
    const personLogin = testPersonParts[0] || '';
    const personCode = testPersonParts[1] || '';
    const bookletName = testPersonParts[2] || '';

    const codingJobUnit = await this.codingJobUnitRepository.findOne({
      where: {
        coding_job_id: codingJobId,
        unit_name: progress.unitId,
        variable_id: progress.variableId,
        person_login: personLogin,
        person_code: personCode,
        booklet_name: bookletName
      }
    });

    if (!codingJobUnit) {
      throw new NotFoundException('Coding job unit not found for progress entry');
    }

    if (progress.isOpen !== undefined) {
      codingJobUnit.is_open = progress.isOpen;
      if (progress.isOpen) {
        codingJobUnit.code = null;
        codingJobUnit.score = null;
      }
    } else {
      codingJobUnit.code = progress.selectedCode.id;
      codingJobUnit.is_open = false;
      const score = progress.selectedCode.score;
      if (score !== undefined) {
        codingJobUnit.score = score;
      }
    }

    if (progress.notes !== undefined) {
      codingJobUnit.notes = progress.notes || null;
    }

    await this.codingJobUnitRepository.save(codingJobUnit);

    await this.checkAndUpdateCodingJobCompletion(codingJobId);

    return codingJob;
  }

  async getCodingProgress(codingJobId: number): Promise<Record<string, SaveCodingProgressDto['selectedCode']>> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: { coding_job_id: codingJobId }
    });

    if (codingJobUnits.length === 0) {
      return {};
    }

    const unitAliases = [...new Set(codingJobUnits.map(unit => unit.unit_alias).filter(alias => alias !== null))];
    const codingSchemes = await this.getCodingSchemes(unitAliases, codingJob.workspace_id);

    const progressMap: Record<string, SaveCodingProgressDto['selectedCode']> = {};

    codingJobUnits.forEach(unit => {
      const compositeKey = this.generateCodingProgressKey(
        `${unit.person_login}@${unit.person_code}@${unit.booklet_name}`,
        unit.unit_name,
        unit.variable_id
      );

      if (unit.is_open) {
        progressMap[`${compositeKey}:open`] = {
          id: -1,
          code: '',
          label: 'OPEN'
        };
      } else if (unit.code !== null) {
        const codingScheme = unit.unit_alias ? codingSchemes.get(unit.unit_alias) : undefined;
        let code: string | undefined;
        let label: string | undefined;

        if (codingScheme) {
          const variableCoding = codingScheme.variableCodings?.find(vc => vc.id === unit.variable_id);
          if (variableCoding?.codes) {
            const codeEntry = variableCoding.codes.find(c => c.id === unit.code);
            if (codeEntry) {
              code = codeEntry.code;
              label = codeEntry.label;
            }
          }
        }

        progressMap[compositeKey] = {
          id: unit.code,
          code,
          label
        };

        if (unit.score !== null) {
          progressMap[compositeKey].score = unit.score;
        }
      }
    });

    return progressMap;
  }

  async getCodingNotes(codingJobId: number): Promise<Record<string, string>> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: { coding_job_id: codingJobId },
      select: ['person_login', 'person_code', 'booklet_name', 'unit_name', 'variable_id', 'notes']
    });

    if (codingJobUnits.length === 0) {
      return {};
    }

    const notesMap: Record<string, string> = {};

    codingJobUnits.forEach(unit => {
      if (unit.notes) {
        const compositeKey = this.generateCodingProgressKey(
          `${unit.person_login}@${unit.person_code}@${unit.booklet_name}`,
          unit.unit_name,
          unit.variable_id
        );
        notesMap[compositeKey] = unit.notes;
      }
    });

    return notesMap;
  }

  /**
   * Generate composite key for coding progress using same logic as frontend
   */
  private generateCodingProgressKey(testPerson: string, unitId: string, variableId: string): string {
    let bookletId = 'default';
    if (testPerson) {
      const parts = testPerson.split('@');
      if (parts.length >= 3) {
        bookletId = parts[2];
      }
    }

    return `${testPerson}::${bookletId}::${unitId}::${variableId}`;
  }

  async getCodingJobUnits(codingJobId: number, onlyOpen: boolean = false): Promise<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; notes: string | null }[]> {
    const whereClause: { coding_job_id: number; is_open?: boolean } = { coding_job_id: codingJobId };

    if (onlyOpen) {
      whereClause.is_open = true;
    }

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: whereClause,
      select: [
        'response_id',
        'unit_name',
        'unit_alias',
        'variable_id',
        'variable_anchor',
        'booklet_name',
        'person_login',
        'person_code',
        'notes'
      ],
      order: {
        unit_name: 'ASC',
        booklet_name: 'ASC',
        person_login: 'ASC',
        person_code: 'ASC',
        variable_id: 'ASC'
      }
    });

    return codingJobUnits.map(unit => ({
      responseId: unit.response_id,
      unitName: unit.unit_name,
      unitAlias: unit.unit_alias,
      variableId: unit.variable_id,
      variableAnchor: unit.variable_anchor,
      bookletName: unit.booklet_name,
      personLogin: unit.person_login,
      personCode: unit.person_code,
      notes: unit.notes
    }));
  }

  private async saveCodingJobUnits(codingJobId: number): Promise<void> {
    const responses = await this.getResponsesForCodingJob(codingJobId);

    if (responses.length === 0) {
      return;
    }

    const codingJobUnits = responses.map(response => this.codingJobUnitRepository.create({
      coding_job_id: codingJobId,
      response_id: response.id,
      unit_name: response.unit?.name || '',
      unit_alias: response.unit?.alias || null,
      variable_id: response.variableid,
      variable_anchor: response.variableid,
      booklet_name: response.unit?.booklet?.bookletinfo?.name || '',
      person_login: response.unit?.booklet?.person?.login || '',
      person_code: response.unit?.booklet?.person?.code || ''
    }));

    await this.codingJobUnitRepository.save(codingJobUnits);
  }

  private async getCodingSchemes(unitAliases: string[], workspaceId: number): Promise<Map<string, CodingScheme>> {
    const codingSchemeRefs = unitAliases.filter(alias => alias !== null);
    const codingSchemes = new Map<string, CodingScheme>();

    if (codingSchemeRefs.length === 0) {
      return codingSchemes;
    }

    const codingSchemeFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_id: In(codingSchemeRefs)
      },
      select: ['file_id', 'data']
    });

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

  async restartCodingJobWithOpenUnits(codingJobId: number, workspaceId: number): Promise<CodingJob> {
    const codingJob = await this.getCodingJob(codingJobId, workspaceId);
    codingJob.codingJob.status = 'pending';
    await this.codingJobRepository.save(codingJob.codingJob);

    return codingJob.codingJob;
  }

  private async checkAndUpdateCodingJobCompletion(codingJobId: number): Promise<void> {
    const progress = await this.getCodingJobProgress(codingJobId);

    if (progress.total > 0 && progress.progress === 100) {
      const newStatus = progress.open > 0 ? 'open' : 'completed';
      await this.codingJobRepository.update(codingJobId, { status: newStatus });
    }
  }

  async createCodingJobWithUnitSubset(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto,
    unitSubset: number[]
  ): Promise<CodingJob> {
    const codingJob = this.codingJobRepository.create({
      workspace_id: workspaceId,
      name: createCodingJobDto.name,
      description: createCodingJobDto.description,
      status: createCodingJobDto.status || 'pending',
      missings_profile_id: createCodingJobDto.missings_profile_id,
      job_definition_id: createCodingJobDto.jobDefinitionId
    });

    const savedCodingJob = await this.codingJobRepository.save(codingJob);

    if (createCodingJobDto.assignedCoders && createCodingJobDto.assignedCoders.length > 0) {
      await this.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders);
    }

    if (createCodingJobDto.variables && createCodingJobDto.variables.length > 0) {
      await this.assignVariables(savedCodingJob.id, createCodingJobDto.variables);
    }

    if (createCodingJobDto.variableBundleIds && createCodingJobDto.variableBundleIds.length > 0) {
      await this.assignVariableBundles(savedCodingJob.id, createCodingJobDto.variableBundleIds);
    } else if (createCodingJobDto.variableBundles && createCodingJobDto.variableBundles.length > 0) {
      if (createCodingJobDto.variableBundles[0].id) {
        const bundleIds = createCodingJobDto.variableBundles
          .filter(bundle => bundle.id)
          .map(bundle => bundle.id);

        if (bundleIds.length > 0) {
          await this.assignVariableBundles(savedCodingJob.id, bundleIds);
        }
      } else {
        const variables = createCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
        if (variables.length > 0) {
          await this.assignVariables(savedCodingJob.id, variables);
        }
      }
    }

    await this.saveCodingJobUnitsSubset(savedCodingJob.id, unitSubset);

    return savedCodingJob;
  }

  private async saveCodingJobUnitsSubset(codingJobId: number, responseIds: number[]): Promise<void> {
    const responses = await this.responseRepository.find({
      where: { id: In(responseIds) },
      relations: ['unit', 'unit.booklet', 'unit.booklet.bookletinfo', 'unit.booklet.person']
    });

    if (responses.length === 0) {
      return;
    }

    const codingJobUnits = responses.map(response => this.codingJobUnitRepository.create({
      coding_job_id: codingJobId,
      response_id: response.id,
      unit_name: response.unit?.name || '',
      unit_alias: response.unit?.alias || null,
      variable_id: response.variableid,
      variable_anchor: response.variableid,
      booklet_name: response.unit?.booklet?.bookletinfo?.name || '',
      person_login: response.unit?.booklet?.person?.login || '',
      person_code: response.unit?.booklet?.person?.code || ''
    }));

    await this.codingJobUnitRepository.save(codingJobUnits);
  }

  async getResponsesForVariables(workspaceId: number, variables: { unitName: string; variableId: string }[]): Promise<ResponseEntity[]> {
    if (variables.length === 0) {
      return [];
    }

    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoin('unit.booklet', 'unit_booklet_filter')
      .leftJoin('unit_booklet_filter.workspace_user', 'workspace_user')
      .where('workspace_user.workspace_id = :workspaceId', { workspaceId });

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(`(unit.name = :${unitParam} AND response.variableid = :${variableParam})`);
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    return queryBuilder
      .orderBy('response.id', 'ASC')
      .getMany();
  }

  async createDistributedCodingJobs(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
      selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[];
      selectedCoders: { id: number; name: string; username: string }[];
    }
  ): Promise<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
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

    const { selectedVariables, selectedCoders } = request;
    const distribution: Record<string, Record<string, number>> = {};
    const createdJobs: {
      coderId: number;
      coderName: string;
      variable: { unitName: string; variableId: string };
      jobId: number;
      jobName: string;
      caseCount: number;
    }[] = [];

    try {
      // Get all response units for the selected variables
      const allResponses = await this.getResponsesForVariables(workspaceId, selectedVariables);

      // Group responses by variable
      const variableResponseMap = new Map<string, ResponseEntity[]>();
      const variableKeyFunc = (unitName: string, variableId: string) => `${unitName}::${variableId}`;

      allResponses.forEach(response => {
        if (response.unit?.name && response.variableid) {
          const key = variableKeyFunc(response.unit.name, response.variableid);
          if (!variableResponseMap.has(key)) {
            variableResponseMap.set(key, []);
          }
          variableResponseMap.get(key)!.push(response);
        }
      });

      // Sort coders alphabetically for deterministic distribution
      const sortedCoders = [...selectedCoders].sort((a, b) => a.name.localeCompare(b.name));

      // Create distribution matrix and jobs
      for (const variable of selectedVariables) {
        const variableKey = variableKeyFunc(variable.unitName, variable.variableId);
        const responses = variableResponseMap.get(variableKey) || [];
        const totalCases = responses.length;

        distribution[variableKey] = {};

        if (totalCases === 0) {
        // No cases for this variable, create empty jobs
          for (const coder of sortedCoders) {
            distribution[variableKey][coder.name] = 0;
            const jobName = generateJobName(coder.name, variable.unitName, variable.variableId, 0);

            const codingJob = await this.createCodingJob(workspaceId, {
              name: jobName,
              assignedCoders: [coder.id],
              variables: [variable]
            });

            createdJobs.push({
              coderId: coder.id,
              coderName: coder.name,
              variable: { unitName: variable.unitName, variableId: variable.variableId },
              jobId: codingJob.id,
              jobName: jobName,
              caseCount: 0
            });
          }
          continue;
        }

        // Distribute cases equally among coders
        const baseCasesPerCoder = Math.floor(totalCases / sortedCoders.length);
        const remainder = totalCases % sortedCoders.length;

        // Assign base cases plus remainder (first coders get extra case)
        let responseIndex = 0;
        for (let i = 0; i < sortedCoders.length; i++) {
          const coder = sortedCoders[i];
          const casesForCoder = baseCasesPerCoder + (i < remainder ? 1 : 0);
          const endIndex = responseIndex + casesForCoder;
          const coderResponses = responses.slice(responseIndex, endIndex);

          distribution[variableKey][coder.name] = casesForCoder;

          if (casesForCoder > 0) {
            const jobName = generateJobName(coder.name, variable.unitName, variable.variableId, casesForCoder);

            const codingJob = await this.createCodingJobWithUnitSubset(
              workspaceId,
              {
                name: jobName,
                assignedCoders: [coder.id],
                variables: [variable]
              },
              coderResponses.map(r => r.id)
            );

            createdJobs.push({
              coderId: coder.id,
              coderName: coder.name,
              variable: { unitName: variable.unitName, variableId: variable.variableId },
              jobId: codingJob.id,
              jobName: jobName,
              caseCount: casesForCoder
            });
          } else {
            const jobName = generateJobName(coder.name, variable.unitName, variable.variableId, 0);

            const codingJob = await this.createCodingJob(workspaceId, {
              name: jobName,
              assignedCoders: [coder.id],
              variables: [variable]
            });

            createdJobs.push({
              coderId: coder.id,
              coderName: coder.name,
              variable: { unitName: variable.unitName, variableId: variable.variableId },
              jobId: codingJob.id,
              jobName: jobName,
              caseCount: 0
            });
          }

          responseIndex = endIndex;
        }
      }

      this.logger.log(`Successfully created ${createdJobs.length} distributed coding jobs`);

      return {
        success: true,
        jobsCreated: createdJobs.length,
        message: `Created ${createdJobs.length} distributed coding jobs`,
        distribution,
        jobs: createdJobs
      };
    } catch (error) {
      this.logger.error(`Error creating distributed coding jobs: ${error.message}`, error.stack);
      return {
        success: false,
        jobsCreated: 0,
        message: `Failed to create distributed jobs: ${error.message}`,
        distribution: {},
        jobs: []
      };
    }
  }
}

function generateJobName(coderName: string, unitName: string, variableId: string, caseCount: number): string {
  // Clean names to avoid issues with special characters
  const cleanCoderName = coderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const cleanUnitName = unitName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const cleanVariableId = variableId.replace(/[^a-zA-Z0-9-_]/g, '_');

  return `${cleanCoderName}_${cleanUnitName}_${cleanVariableId}_${caseCount}`;
}
