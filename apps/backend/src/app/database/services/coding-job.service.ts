import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../entities/coding-job-variable-bundle.entity';
import { CreateCodingJobDto } from '../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../admin/coding-job/dto/update-coding-job.dto';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { ResponseEntity } from '../entities/response.entity';

@Injectable()
export class CodingJobService {
  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobVariableBundle)
    private codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>
  ) {}

  async getCodingJobs(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: (CodingJob & {
      assignedCoders?: number[];
      assignedVariables?: { unitName: string; variableId: string }[];
      assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[]
    })[]; total: number; page: number; limit: number }> {
    const validPage = page > 0 ? page : 1;
    const validLimit = limit > 0 ? limit : 10;
    const skip = (validPage - 1) * validLimit;

    const total = await this.codingJobRepository.count({
      where: { workspace_id: workspaceId }
    });

    const jobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' },
      skip,
      take: validLimit
    });

    const jobIds = jobs.map(job => job.id);

    const [allCoders, allVariables, variableBundleEntities] = await Promise.all([
      this.codingJobCoderRepository.find({
        where: { coding_job_id: In(jobIds) }
      }),
      this.codingJobVariableRepository.find({
        where: { coding_job_id: In(jobIds) }
      }),
      this.codingJobVariableBundleRepository.find({
        where: { coding_job_id: In(jobIds) },
        relations: ['variable_bundle']
      })
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

    const data = jobs.map(job => ({
      ...job,
      assignedCoders: codersByJobId.get(job.id) || [],
      assignedVariables: variablesByJobId.get(job.id) || [],
      assignedVariableBundles: variableBundlesByJobId.get(job.id) || []
    }));
    return {
      data,
      total,
      page: validPage,
      limit: validLimit
    };
  }

  async getCodingJob(id: number, workspaceId?: number): Promise<{
    codingJob: CodingJob;
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
      status: createCodingJobDto.status || 'pending'
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
}
