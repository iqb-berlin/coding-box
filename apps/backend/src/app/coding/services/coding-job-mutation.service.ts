import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { CreateCodingJobDto } from '../dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../dto/update-coding-job.dto';
import { SaveCodingProgressDto } from '../dto/save-coding-progress.dto';
import { CacheService } from '../../cache/cache.service';
import { CodingJobAssignmentService } from './coding-job-assignment.service';
import { CodingJobQueryService } from './coding-job-query.service';
import { ResponseEntity } from '../../common';

@Injectable()
export class CodingJobMutationService {
  private readonly logger = new Logger(CodingJobMutationService.name);

  constructor(
    @InjectRepository(CodingJob)
    public readonly codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private readonly codingJobUnitRepository: Repository<CodingJobUnit>,
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly codingJobAssignmentService: CodingJobAssignmentService,
    private readonly codingJobQueryService: CodingJobQueryService
  ) {}

  async createCodingJob(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto
  ): Promise<CodingJob> {
    return this.dataSource.transaction(async manager => {
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
        await this.codingJobAssignmentService.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders, manager);
      }

      if (createCodingJobDto.variables && createCodingJobDto.variables.length > 0) {
        await this.codingJobAssignmentService.assignVariables(savedCodingJob.id, createCodingJobDto.variables, manager);
      }

      if (createCodingJobDto.variableBundleIds && createCodingJobDto.variableBundleIds.length > 0) {
        await this.codingJobAssignmentService.assignVariableBundles(savedCodingJob.id, createCodingJobDto.variableBundleIds, manager);
      }

      await this.saveCodingJobUnits(savedCodingJob.id, manager);
      await this.invalidateIncompleteVariablesCache(workspaceId);

      return savedCodingJob;
    });
  }

  async updateCodingJob(
    id: number,
    workspaceId: number,
    updateCodingJobDto: UpdateCodingJobDto
  ): Promise<CodingJob> {
    const job = await this.codingJobRepository.findOneBy({ id, workspace_id: workspaceId });
    if (!job) {
      throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
    }

    const { assignedCoders, variables, variableBundleIds, ...jobUpdates } = updateCodingJobDto as any;

    Object.assign(job, jobUpdates);
    const updatedJob = await this.codingJobRepository.save(job);

    if (assignedCoders !== undefined) {
      await this.codingJobAssignmentService.assignCoders(id, assignedCoders);
    }

    if (variables !== undefined) {
      await this.codingJobAssignmentService.assignVariables(id, variables);
    }

    if (variableBundleIds !== undefined) {
      await this.codingJobAssignmentService.assignVariableBundles(id, variableBundleIds);
    }

    await this.invalidateIncompleteVariablesCache(workspaceId);

    return updatedJob;
  }

  async deleteCodingJob(id: number, workspaceId: number): Promise<{ success: boolean }> {
    const result = await this.codingJobRepository.delete({ id, workspace_id: workspaceId });
    if (result.affected === 0) {
      throw new NotFoundException(`Coding job with ID ${id} not found`);
    }
    await this.invalidateIncompleteVariablesCache(workspaceId);
    return { success: true };
  }

  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = `incomplete-variables:${workspaceId}`;
    await this.cacheService.delete(cacheKey);
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

    if (testPersonParts.length === 4) {
      personGroup = testPersonParts[2];
    }

    const whereCondition: any = {
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
      codingJobUnit.coding_issue_option = (progress.selectedCode as any).codingIssueOption || null;
    }

    if (progress.notes !== undefined) {
      codingJobUnit.notes = progress.notes || null;
    }

    await this.codingJobUnitRepository.save(codingJobUnit);

    return codingJob;
  }

  async checkAndUpdateCodingJobCompletion(codingJobId: number): Promise<void> {
    const progress = await this.codingJobQueryService.getCodingJobProgress(codingJobId);

    if (progress.total > 0 && progress.progress === 100) {
      const newStatus = progress.open > 0 ? 'open' : 'completed';
      await this.codingJobRepository.update(codingJobId, { status: newStatus });
    }
  }

  async restartCodingJobWithOpenUnits(codingJobId: number, workspaceId: number): Promise<CodingJob> {
    const job = await this.codingJobRepository.findOneBy({ id: codingJobId, workspace_id: workspaceId });
    if (!job) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    await this.codingJobUnitRepository.update(
      { coding_job_id: codingJobId },
      {
        is_open: true,
        code: null,
        score: null,
        coding_issue_option: null
      }
    );

    job.status = 'open';
    return this.codingJobRepository.save(job);
  }

  async saveCodingJobUnits(codingJobId: number, manager?: EntityManager): Promise<void> {
    const responses = await this.codingJobQueryService.getResponsesForCodingJob(codingJobId);

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

  async createCodingJobWithUnitSubset(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto,
    unitSubset: number[]
  ): Promise<CodingJob> {
    return this.dataSource.transaction(async manager => {
      const codingJobRepo = manager.getRepository(CodingJob);
      const codingJob = codingJobRepo.create({
        workspace_id: workspaceId,
        name: createCodingJobDto.name,
        description: createCodingJobDto.description,
        status: createCodingJobDto.status || 'pending',
        missings_profile_id: createCodingJobDto.missings_profile_id,
        job_definition_id: createCodingJobDto.jobDefinitionId,
        case_ordering_mode: createCodingJobDto.caseOrderingMode || 'continuous'
      });

      const savedCodingJob = await codingJobRepo.save(codingJob);

      if (createCodingJobDto.assignedCoders && createCodingJobDto.assignedCoders.length > 0) {
        await this.codingJobAssignmentService.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders, manager);
      }

      const { variables, variableBundleIds } = createCodingJobDto;
      if (variables && variables.length > 0) {
        await this.codingJobAssignmentService.assignVariables(savedCodingJob.id, variables, manager);
      }
      if (variableBundleIds && variableBundleIds.length > 0) {
        await this.codingJobAssignmentService.assignVariableBundles(savedCodingJob.id, variableBundleIds, manager);
      }

      await this.saveCodingJobUnitsSubset(savedCodingJob.id, unitSubset, manager);
      await this.invalidateIncompleteVariablesCache(workspaceId);

      return savedCodingJob;
    });
  }

  async saveCodingJobUnitsSubset(codingJobId: number, responseIds: number[], manager?: EntityManager): Promise<void> {
    const entityManager = manager || this.dataSource.manager;
    const responseRepo = entityManager.getRepository(ResponseEntity);
    const coderJobUnitRepo = entityManager.getRepository(CodingJobUnit);

    const responses = await responseRepo.find({
      where: { id: In(responseIds) },
      relations: ['unit', 'unit.booklet', 'unit.booklet.person', 'unit.booklet.bookletinfo']
    });

    const codingJobUnits = responses.map(response => coderJobUnitRepo.create({
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

    await coderJobUnitRepo.save(codingJobUnits);
  }
}
