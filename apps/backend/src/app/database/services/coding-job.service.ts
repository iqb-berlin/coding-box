import {
  Injectable, Logger, NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, In, Not, IsNull, Connection, EntityManager
} from 'typeorm';
import { statusStringToNumber } from '../utils/response-status-converter';
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
import { Setting } from '../entities/setting.entity';

function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

enum ResponseMatchingFlag {
  NO_AGGREGATION = 'NO_AGGREGATION',
  IGNORE_CASE = 'IGNORE_CASE',
  IGNORE_WHITESPACE = 'IGNORE_WHITESPACE'
}

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

interface JobCreationWarning {
  unitName: string;
  variableId: string;
  message: string;
  casesInJobs: number;
  availableCases: number;
}

type VariableReference = { unitName: string; variableId: string };
type BundleItem = { id: number; name: string; variables: VariableReference[] };
type DistributionItem = { type: 'bundle' | 'variable'; item: BundleItem | VariableReference };

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
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
    private connection: Connection
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
    const validPage = page > 0 ? page : 1;
    const shouldPaginate = limit !== undefined && limit > 0;
    const skip = shouldPaginate ? (validPage - 1) * limit : undefined;
    const take = shouldPaginate ? limit : undefined;

    const total = await this.codingJobRepository.count({
      where: { workspace_id: workspaceId }
    });

    const jobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      relations: ['training'],
      order: { created_at: 'DESC' },
      skip,
      take
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
      limit
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
    let variables = codingJobVariables.map(variable => ({
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

    // Include variables from bundles
    const bundleVariables = variableBundles.flatMap(bundle => bundle.variables || []);
    variables = [...variables, ...bundleVariables];

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
    return this.connection.transaction(async manager => {
      const codingJobRepo = manager.getRepository(CodingJob);
      const codingJob = codingJobRepo.create({
        workspace_id: workspaceId,
        name: createCodingJobDto.name,
        description: createCodingJobDto.description,
        status: createCodingJobDto.status || 'pending',
        missings_profile_id: createCodingJobDto.missings_profile_id,
        job_definition_id: createCodingJobDto.jobDefinitionId
      });

      const savedCodingJob = await codingJobRepo.save(codingJob);

      if (createCodingJobDto.assignedCoders && createCodingJobDto.assignedCoders.length > 0) {
        await this.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders, manager);
      }

      if (createCodingJobDto.variables && createCodingJobDto.variables.length > 0) {
        await this.assignVariables(savedCodingJob.id, createCodingJobDto.variables, manager);
      }

      if (createCodingJobDto.variableBundleIds && createCodingJobDto.variableBundleIds.length > 0) {
        await this.assignVariableBundles(savedCodingJob.id, createCodingJobDto.variableBundleIds, manager);
      } else if (createCodingJobDto.variableBundles && createCodingJobDto.variableBundles.length > 0) {
        if (createCodingJobDto.variableBundles[0].id) {
          const bundleIds = createCodingJobDto.variableBundles
            .filter(bundle => bundle.id)
            .map(bundle => bundle.id);

          if (bundleIds.length > 0) {
            await this.assignVariableBundles(savedCodingJob.id, bundleIds, manager);
          }
        } else {
          const variables = createCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
          if (variables.length > 0) {
            await this.assignVariables(savedCodingJob.id, variables, manager);
          }
        }
      }
      await this.saveCodingJobUnits(savedCodingJob.id, manager);

      return savedCodingJob;
    });
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
      if (codingJob.codingJob.status === 'results_applied') {
        throw new Error(`Cannot change status of coding job ${id} because it has already been applied to results (status: results_applied)`);
      }
      codingJob.codingJob.status = updateCodingJobDto.status;
    }
    if (updateCodingJobDto.comment !== undefined) {
      codingJob.codingJob.comment = updateCodingJobDto.comment;
    }
    if (updateCodingJobDto.missingsProfileId !== undefined) {
      codingJob.codingJob.missings_profile_id = updateCodingJobDto.missingsProfileId;
    }
    if (updateCodingJobDto.showScore !== undefined) {
      codingJob.codingJob.showScore = updateCodingJobDto.showScore;
    }
    if (updateCodingJobDto.allowComments !== undefined) {
      codingJob.codingJob.allowComments = updateCodingJobDto.allowComments;
    }
    if (updateCodingJobDto.suppressGeneralInstructions !== undefined) {
      codingJob.codingJob.suppressGeneralInstructions = updateCodingJobDto.suppressGeneralInstructions;
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

  async assignCoders(codingJobId: number, userIds: number[], manager?: EntityManager): Promise<CodingJobCoder[]> {
    const repo = manager ? manager.getRepository(CodingJobCoder) : this.codingJobCoderRepository;
    await repo.delete({ coding_job_id: codingJobId });
    const coders = userIds.map(userId => repo.create({
      coding_job_id: codingJobId,
      user_id: userId
    }));

    return repo.save(coders);
  }

  private async assignVariables(
    codingJobId: number,
    variables: { unitName: string; variableId: string }[],
    manager?: EntityManager
  ): Promise<CodingJobVariable[]> {
    const repo = manager ? manager.getRepository(CodingJobVariable) : this.codingJobVariableRepository;
    const codingJobVariables = variables.map(variable => repo.create({
      coding_job_id: codingJobId,
      unit_name: variable.unitName,
      variable_id: variable.variableId
    }));

    return repo.save(codingJobVariables);
  }

  private async assignVariableBundles(
    codingJobId: number,
    variableBundleIds: number[],
    manager?: EntityManager
  ): Promise<CodingJobVariableBundle[]> {
    const repo = manager ? manager.getRepository(CodingJobVariableBundle) : this.codingJobVariableBundleRepository;
    const variableBundles = variableBundleIds.map(variableBundleId => repo.create({
      coding_job_id: codingJobId,
      variable_bundle_id: variableBundleId
    }));

    return repo.save(variableBundles);
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

  async getResponsesForCodingJob(codingJobId: number, manager?: EntityManager): Promise<ResponseEntity[]> {
    const variableRepo = manager ? manager.getRepository(CodingJobVariable) : this.codingJobVariableRepository;
    const bundleRepo = manager ? manager.getRepository(CodingJobVariableBundle) : this.codingJobVariableBundleRepository;
    const responseRepo = manager ? manager.getRepository(ResponseEntity) : this.responseRepository;

    const codingJobVariables = await variableRepo.find({
      where: { coding_job_id: codingJobId }
    });

    const codingJobVariableBundles = await bundleRepo.find({
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

    const queryBuilder = responseRepo.createQueryBuilder('response')
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
    const bookletName = testPersonParts[testPersonParts.length - 1] || '';
    let personGroup: string | undefined;

    // Handle new 4-part URL format: login@code@group@booklet
    if (testPersonParts.length === 4) {
      personGroup = testPersonParts[2];
    }

    const whereCondition: Partial<CodingJobUnit> = {
      coding_job_id: codingJobId,
      unit_name: progress.unitId,
      variable_id: progress.variableId,
      person_login: personLogin,
      person_code: personCode,
      booklet_name: bookletName
    };

    if (personGroup !== undefined) {
      whereCondition.person_group = personGroup;
    }

    const codingJobUnit = await this.codingJobUnitRepository.findOne({
      where: whereCondition
    });

    if (!codingJobUnit) {
      throw new NotFoundException('Coding job unit not found for progress entry');
    }

    if (progress.isOpen !== undefined) {
      codingJobUnit.is_open = progress.isOpen;
      if (progress.isOpen) {
        codingJobUnit.code = null;
        codingJobUnit.score = null;
        codingJobUnit.coding_issue_option = null;
      }
    } else {
      codingJobUnit.code = progress.selectedCode.id;
      codingJobUnit.is_open = false;
      const score = progress.selectedCode.score;
      if (score !== undefined) {
        codingJobUnit.score = score;
      }
      codingJobUnit.coding_issue_option = (progress.selectedCode).codingIssueOption || null;
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

        if (unit.coding_issue_option !== null) {
          (progressMap[compositeKey]).codingIssueOption = unit.coding_issue_option;
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

  async getCodingJobUnits(codingJobId: number, onlyOpen: boolean = false): Promise<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string; notes: string | null }[]> {
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
        'person_group',
        'notes'
      ],
      order: {
        variable_id: 'ASC',
        unit_name: 'ASC',
        booklet_name: 'ASC',
        person_login: 'ASC',
        person_code: 'ASC'
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
      personGroup: unit.person_group,
      notes: unit.notes
    }));
  }

  private async saveCodingJobUnits(codingJobId: number, manager?: EntityManager): Promise<void> {
    const responses = await this.getResponsesForCodingJob(codingJobId, manager);

    if (responses.length === 0) {
      return;
    }

    const repo = manager ? manager.getRepository(CodingJobUnit) : this.codingJobUnitRepository;
    const codingJobUnits = responses.map(response => repo.create({
      coding_job_id: codingJobId,
      response_id: response.id,
      unit_name: response.unit?.name || '',
      unit_alias: response.unit?.alias || null,
      variable_id: response.variableid,
      variable_anchor: response.variableid,
      booklet_name: response.unit?.booklet?.bookletinfo?.name || '',
      person_login: response.unit?.booklet?.person?.login || '',
      person_code: response.unit?.booklet?.person?.code || '',
      person_group: response.unit?.booklet?.person?.group || ''
    }));

    await repo.save(codingJobUnits);
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
    codingJob.codingJob.status = 'open';
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
    return this.connection.transaction(async manager => {
      const codingJobRepo = manager.getRepository(CodingJob);
      const codingJob = codingJobRepo.create({
        workspace_id: workspaceId,
        name: createCodingJobDto.name,
        description: createCodingJobDto.description,
        status: createCodingJobDto.status || 'pending',
        missings_profile_id: createCodingJobDto.missings_profile_id,
        job_definition_id: createCodingJobDto.jobDefinitionId
      });

      const savedCodingJob = await codingJobRepo.save(codingJob);

      if (createCodingJobDto.assignedCoders && createCodingJobDto.assignedCoders.length > 0) {
        await this.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders, manager);
      }

      if (createCodingJobDto.variables && createCodingJobDto.variables.length > 0) {
        await this.assignVariables(savedCodingJob.id, createCodingJobDto.variables, manager);
      }

      if (createCodingJobDto.variableBundleIds && createCodingJobDto.variableBundleIds.length > 0) {
        await this.assignVariableBundles(savedCodingJob.id, createCodingJobDto.variableBundleIds, manager);
      } else if (createCodingJobDto.variableBundles && createCodingJobDto.variableBundles.length > 0) {
        if (createCodingJobDto.variableBundles[0].id) {
          const bundleIds = createCodingJobDto.variableBundles
            .filter(bundle => bundle.id)
            .map(bundle => bundle.id);

          if (bundleIds.length > 0) {
            await this.assignVariableBundles(savedCodingJob.id, bundleIds, manager);
          }
        } else {
          const variables = createCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
          if (variables.length > 0) {
            await this.assignVariables(savedCodingJob.id, variables, manager);
          }
        }
      }

      await this.saveCodingJobUnitsSubset(savedCodingJob.id, unitSubset, manager);

      return savedCodingJob;
    });
  }

  private async saveCodingJobUnitsSubset(codingJobId: number, responseIds: number[], manager?: EntityManager): Promise<void> {
    const responseRepo = manager ? manager.getRepository(ResponseEntity) : this.responseRepository;
    const responses = await responseRepo.find({
      where: { id: In(responseIds) },
      relations: ['unit', 'unit.booklet', 'unit.booklet.bookletinfo', 'unit.booklet.person']
    });

    if (responses.length === 0) {
      return;
    }

    const unitRepo = manager ? manager.getRepository(CodingJobUnit) : this.codingJobUnitRepository;
    const codingJobUnits = responses.map(response => unitRepo.create({
      coding_job_id: codingJobId,
      response_id: response.id,
      unit_name: response.unit?.name || '',
      unit_alias: response.unit?.alias || null,
      variable_id: response.variableid,
      variable_anchor: response.variableid,
      booklet_name: response.unit?.booklet?.bookletinfo?.name || '',
      person_login: response.unit?.booklet?.person?.login || '',
      person_code: response.unit?.booklet?.person?.code || '',
      person_group: response.unit?.booklet?.person?.group || ''
    }));

    await unitRepo.save(codingJobUnits);
  }

  private distributeDoubleCodingEvenly(
    doubleCodingResponses: ResponseEntity[],
    sortedCoders: { id: number; name: string; username: string }[]
  ): { response: ResponseEntity; coders: { id: number; name: string }[] }[] {
    const assignments: { response: ResponseEntity; coders: { id: number; name: string }[] }[] = [];
    const numCoders = sortedCoders.length;

    // Track how many double-coding assignments each coder has received
    const doubleCodingCounts = new Map(sortedCoders.map(c => [c.id, 0]));

    for (const response of doubleCodingResponses) {
      // Find the two coders with the least double-coding assignments
      const coderCounts = sortedCoders.map(coder => ({
        id: coder.id,
        name: coder.name,
        count: doubleCodingCounts.get(coder.id) || 0
      }));

      coderCounts.sort((a, b) => a.count - b.count);

      // Pick the two coders with lowest counts (break ties by name for consistency)
      const selectedCoders = coderCounts
        .slice(0, Math.min(2, numCoders))
        .sort((a, b) => a.name.localeCompare(b.name));

      assignments.push({
        response,
        coders: selectedCoders.map(c => ({ id: c.id, name: c.name }))
      });

      // Update counts
      selectedCoders.forEach(coder => {
        doubleCodingCounts.set(coder.id, (doubleCodingCounts.get(coder.id) || 0) + 1);
      });
    }

    return assignments;
  }

  private distributeCasesForVariable(
    responses: ResponseEntity[],
    doubleCodingResponses: ResponseEntity[],
    sortedCoders: { id: number; name: string; username: string }[]
  ): ResponseEntity[][] {
    const numCoders = sortedCoders.length;
    const coderCases: ResponseEntity[][] = sortedCoders.map(() => []);

    const singleCodingResponses = responses.filter(r => !doubleCodingResponses.some(dc => dc.id === r.id));

    // First, assign all double-coded cases to all coders (since double-coding means all coders get the same cases)
    sortedCoders.forEach((coder, coderIndex) => {
      doubleCodingResponses.forEach(doubleCodingResponse => {
        coderCases[coderIndex].push(doubleCodingResponse);
      });
    });

    const totalSingleCases = singleCodingResponses.length;
    const baseCasesPerCoder = Math.floor(totalSingleCases / numCoders);
    const remainder = totalSingleCases % numCoders;

    // Distribute single cases equally among coders
    sortedCoders.forEach((coder, index) => {
      let casesForCoder = baseCasesPerCoder;
      if (index < remainder) {
        casesForCoder += 1;
      }

      // Simple round-robin distribution
      const startIndex = index * baseCasesPerCoder + Math.min(index, remainder);
      const endIndex = startIndex + casesForCoder;
      const casesSlice = singleCodingResponses.slice(startIndex, endIndex);
      coderCases[index].push(...casesSlice);
    });

    return coderCases;
  }

  async getResponseMatchingMode(workspaceId: number): Promise<ResponseMatchingFlag[]> {
    const settingKey = `workspace-${workspaceId}-response-matching-mode`;
    const setting = await this.settingRepository.findOne({
      where: { key: settingKey }
    });

    if (!setting) {
      return []; // Default: exact match (no flags)
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

    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') });

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

    // Get response matching mode for this workspace
    const matchingFlags = await this.getResponseMatchingMode(workspaceId);

    // Initialize remaining cases for global cap
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

    // Generate warnings for variables that have reduced available cases
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

      const responses = allResponses.filter(response => itemVariables.some(v => v.unitName === response.unit?.name && v.variableId === response.variableid)
      );
      const totalResponses = responses.length;

      // Calculate aggregation info based on matching mode
      const aggregatedGroups = this.aggregateResponsesByValue(responses, matchingFlags);
      const uniqueCases = aggregatedGroups.length;

      aggregationInfo[itemKey] = {
        uniqueCases,
        totalResponses
      };

      // Use unique cases count for distribution when aggregating
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

      // Apply global cap to double coding count if defined
      if (remainingCases !== undefined) {
        doubleCodingCount = Math.min(doubleCodingCount, remainingCases);
      }

      const sortedResponses = [...responses].sort((a, b) => {
        if (caseOrderingMode === 'alternating') {
          // Alternating mode: sort by case (unit/booklet/person), then by variable
          // First by unit name
          const aUnitName = a.unit?.name || '';
          const bUnitName = b.unit?.name || '';
          if (aUnitName !== bUnitName) return aUnitName.localeCompare(bUnitName);

          // Then by testperson: login, code, group, booklet.name
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

          // Finally by variable
          if (a.variableid !== b.variableid) return a.variableid.localeCompare(b.variableid);

          return a.id - b.id;
        }
        // Continuous mode (default): sort by variable first, then by case
        if (a.variableid !== b.variableid) return a.variableid.localeCompare(b.variableid);

        // Then by unit name
        const aUnitName = a.unit?.name || '';
        const bUnitName = b.unit?.name || '';
        if (aUnitName !== bUnitName) return aUnitName.localeCompare(bUnitName);

        // Then by testperson: login, code, group, booklet.name
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
      const singleCodingResponses = sortedResponses.slice(doubleCodingCount);

      // Update remaining cases to account for double coding cases
      if (remainingCases !== undefined) {
        remainingCases -= doubleCodingCount;
      }

      doubleCodingInfo[itemKey].doubleCodedCases = doubleCodingCount;

      // Calculate actual single coding cases after global cap
      let actualSingleCodingCases = singleCodingResponses.length;
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

      // Calculate case counts for each coder
      for (let i = 0; i < sortedCoders.length; i++) {
        const coder = sortedCoders[i];
        const coderCases = caseDistribution[i];

        let caseCount = coderCases.length;

        // Apply global cap if defined
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

      // After applying the global cap, update totalCases in the doubleCodingInfo
      // so that the summary reflects the actually distributed (capped) cases
      const cappedTotalCasesForItem = Object.values(distribution[itemKey]).reduce((sum, value) => sum + value, 0);
      doubleCodingInfo[itemKey].totalCases = cappedTotalCasesForItem;
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
    }
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
      selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, maxCodingCases
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

    // Get response matching mode for this workspace
    const matchingFlags = await this.getResponseMatchingMode(workspaceId);

    try {
    // Determine items to process
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
      } const allResponses = await this.getResponsesForVariables(workspaceId, allVariables);

      // Generate warnings for variables that have reduced available cases
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

      // Sort coders alphabetically for deterministic distribution
      const sortedCoders = [...selectedCoders].sort((a, b) => a.name.localeCompare(b.name));

      // Create distribution matrix and jobs with double coding support
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

        const responses = allResponses.filter(response => itemVariables.some(v => v.unitName === response.unit?.name && v.variableId === response.variableid)
        );
        const totalResponses = responses.length;

        // Calculate aggregation info based on matching mode
        const aggregatedGroups = this.aggregateResponsesByValue(responses, matchingFlags);
        const uniqueCases = aggregatedGroups.length;

        aggregationInfo[itemKey] = {
          uniqueCases,
          totalResponses
        };

        // Use unique cases count for distribution when aggregating
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
          // First by variableid
          if (a.variableid !== b.variableid) return a.variableid.localeCompare(b.variableid);

          // Then by unit id (unit.name)
          const aUnitName = a.unit?.name || '';
          const bUnitName = b.unit?.name || '';
          if (aUnitName !== bUnitName) return aUnitName.localeCompare(bUnitName);

          // Then by testperson: login, code, group, booklet.name
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

          // Finally by id
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

          // Apply global maxCodingCases cap if configured
          if (remainingCases !== undefined) {
            if (remainingCases <= 0) {
              // Global cap reached: skip creating further jobs
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
            itemObj.type === 'bundle' ? itemKey : (itemObj.item as { unitName: string; variableId: string }).unitName,
            itemObj.type === 'bundle' ? '' : (itemObj.item as { unitName: string; variableId: string }).variableId,
            caseCountForCoder
          );

          const codingJob = await this.createCodingJobWithUnitSubset(
            workspaceId,
            {
              name: jobName,
              assignedCoders: [coder.id],
              ...(itemObj.type === 'bundle' ?
                { variableBundleIds: [(itemObj.item as { id: number; name: string; variables: { unitName: string; variableId: string }[] }).id] } :
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

  async hasCodingIssues(codingJobId: number): Promise<boolean> {
    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: { coding_job_id: codingJobId },
      select: ['code', 'coding_issue_option']
    });

    return codingJobUnits.some(unit => unit.coding_issue_option !== null ||
      (unit.code !== null && unit.code < 0)
    );
  }

  private async getVariableCasesInJobs(
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

  async getBulkCodingProgress(codingJobIds: number[], workspaceId: number): Promise<Record<number, Record<string, SaveCodingProgressDto['selectedCode']>>> {
    if (codingJobIds.length === 0) {
      return {};
    }

    const codingJobs = await this.codingJobRepository.find({
      where: { id: In(codingJobIds), workspace_id: workspaceId },
      select: ['id', 'workspace_id']
    });

    if (codingJobs.length !== codingJobIds.length) {
      throw new NotFoundException('One or more coding jobs not found in the workspace');
    }

    const progressMap: Record<number, Record<string, SaveCodingProgressDto['selectedCode']>> = {};

    await Promise.all(codingJobs.map(async job => {
      progressMap[job.id] = await this.getCodingProgress(job.id);
    }));

    return progressMap;
  }
}

function generateJobName(coderName: string, unitName: string, variableId: string, caseCount: number): string {
  const cleanCoderName = coderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const cleanUnitName = unitName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const cleanVariableId = variableId.replace(/[^a-zA-Z0-9-_]/g, '_');

  return `${cleanCoderName}_${cleanUnitName}_${cleanVariableId}_${caseCount}`;
}
