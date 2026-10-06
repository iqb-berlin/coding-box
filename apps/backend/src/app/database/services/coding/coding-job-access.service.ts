import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { Setting } from '../../entities/setting.entity';
import { UsersService } from '../users';
import { isDeriveErrorInManualCodingEnabled } from '../../utils/manual-coding-setting.util';
import { DeriveErrorManualCodingRequest } from './coding-job.types';

@Injectable()
export class CodingJobAccessService {
  constructor(
    @InjectRepository(CodingJob)
    private readonly codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private readonly codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
    private readonly usersService: UsersService
  ) {}

  requestIncludesDeriveErrorManualCoding(
    request: DeriveErrorManualCodingRequest
  ): boolean {
    return (
      (request.selectedVariables || []).some(
        variable => variable.includeDeriveError === true
      ) ||
      (request.selectedVariableBundles || []).some(bundle => (bundle.variables || []).some(
        variable => variable.includeDeriveError === true
      )
      )
    );
  }

  async getIncludeDeriveErrorInManualCoding(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<boolean> {
    const repository = manager ?
      manager.getRepository(Setting) :
      this.settingRepository;
    return isDeriveErrorInManualCodingEnabled(repository, workspaceId);
  }

  async assertDeriveErrorManualCodingEnabled(
    workspaceId: number,
    request: DeriveErrorManualCodingRequest,
    manager?: EntityManager
  ): Promise<void> {
    if (!this.requestIncludesDeriveErrorManualCoding(request)) {
      return;
    }

    if (await this.getIncludeDeriveErrorInManualCoding(workspaceId, manager)) {
      return;
    }

    throw new BadRequestException(
      'DERIVE_ERROR manual coding is disabled for this workspace.'
    );
  }

  async assertUserCanAccessCodingJob(
    codingJobId: number,
    workspaceId: number,
    userId: number,
    managerAccessLevel = 2
  ): Promise<void> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId, workspace_id: workspaceId },
      select: ['id']
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const isAdmin = await this.usersService.getUserIsAdmin(userId);
    if (isAdmin) {
      return;
    }

    const accessLevel = await this.usersService.getUserAccessLevel(
      userId,
      workspaceId
    );
    if ((accessLevel ?? 0) >= managerAccessLevel) {
      return;
    }

    const canCode = await this.usersService.canUserCodeInWorkspace(
      userId,
      workspaceId
    );
    if (!canCode) {
      throw new ForbiddenException(
        'User is not enabled as coder in this workspace'
      );
    }

    const assignedCount = await this.codingJobCoderRepository.count({
      where: {
        coding_job_id: codingJobId,
        user_id: userId
      }
    });

    if (assignedCount > 0) {
      return;
    }

    throw new ForbiddenException('User is not assigned to this coding job');
  }

  async assertUserCanCodeCodingJob(
    codingJobId: number,
    workspaceId: number,
    userId: number
  ): Promise<void> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId, workspace_id: workspaceId },
      select: ['id']
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const canCode = await this.usersService.canUserCodeInWorkspace(
      userId,
      workspaceId
    );
    if (!canCode) {
      throw new ForbiddenException(
        'User is not enabled as coder in this workspace'
      );
    }

    const assignedCount = await this.codingJobCoderRepository.count({
      where: {
        coding_job_id: codingJobId,
        user_id: userId
      }
    });

    if (assignedCount > 0) {
      return;
    }

    throw new ForbiddenException('User is not assigned to this coding job');
  }

  async assertCodersCanCodeInWorkspace(
    userIds: number[],
    workspaceId: number
  ): Promise<void> {
    await this.usersService.assertUsersCanCodeInWorkspace(userIds, workspaceId);
  }

  async assertCodingJobCodersCanCode(
    codingJobId: number,
    userIds: number[],
    manager?: EntityManager,
    workspaceId?: number
  ): Promise<void> {
    if (workspaceId !== undefined) {
      await this.assertCodersCanCodeInWorkspace(userIds, workspaceId);
      return;
    }

    const codingJobRepository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const codingJob = await codingJobRepository.findOne({
      where: { id: codingJobId },
      select: ['id', 'workspace_id']
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    await this.assertCodersCanCodeInWorkspace(userIds, codingJob.workspace_id);
  }
}
