import { ForbiddenException, NotFoundException } from '@nestjs/common';
import User from '../../entities/user.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobService } from './coding-job.service';
import { VariableBundleService } from './variable-bundle.service';
import { CoderTrainingService } from './coder-training.service';

jest.mock('../workspace/workspace-files.service', () => ({ WorkspaceFilesService: class {} }));

describe('Ownership at mutation boundaries', () => {
  function context(level = 2, owner: number | null = 7) {
    const jobs = new Map([
      [1, { id: 1, workspace_id: 5, creatorUserId: 7 }],
      [2, { id: 2, workspace_id: 5, creatorUserId: owner }]
    ]);
    const bundle = {
      id: 9, workspace_id: 5, creatorUserId: owner, name: 'Bundle', variables: []
    };
    const training = {
      id: 10, workspace_id: 5, creatorUserId: 7, codingJobs: [...jobs.values()]
    };
    const repository = {
      create: jest.fn(value => value),
      save: jest.fn(async value => value),
      delete: jest.fn(),
      remove: jest.fn(),
      findOneOrFail: jest.fn(async () => bundle),
      findOne: jest.fn(async () => training)
    };
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(async (entity, options) => {
        if (entity === User) return { id: 7, isAdmin: false };
        if (entity === WorkspaceUser) return { accessLevel: level };
        if (options.where.workspace_id !== undefined && options.where.workspace_id !== 5) return null;
        if (entity === CodingJob) return jobs.get(options.where.id) ?? null;
        if (entity === VariableBundle) return bundle;
        if (entity === CoderTraining) return training;
        return null;
      }),
      find: jest.fn(async () => [...jobs.values()]),
      remove: jest.fn(),
      getRepository: jest.fn(() => repository),
      transaction: jest.fn()
    };
    manager.transaction.mockImplementation(async callback => callback(manager));
    const repo = { ...repository, manager };
    manager.getRepository.mockReturnValue(repo);
    const service = Object.assign(Object.create(CodingJobService.prototype), {
      connection: manager,
      codingJobRepository: repo,
      logger: { log: jest.fn(), error: jest.fn() },
      cacheService: { incr: jest.fn(), delete: jest.fn() }
    }) as CodingJobService;
    return {
      manager, repo, jobs, bundle, service, training
    };
  }

  it.each([8, null])('rejects mixed bulk deletion with owner %s before any deletion', async owner => {
    const { service, manager, repo } = context(2, owner);
    await expect(service.deleteCodingJobs(5, [1, 2], 7)).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.remove).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('deletes an entirely owned selection in a single transaction', async () => {
    const { service, manager } = context();
    await expect(service.deleteCodingJobs(5, [1, 2, 1], 7)).resolves.toEqual({ success: true });
    expect(manager.transaction).toHaveBeenCalledTimes(1);
    expect(manager.remove).toHaveBeenCalledWith(CodingJob, expect.any(Array));
  });

  it('retains level 3 legacy deletion and rejects a wrong workspace', async () => {
    const { service, repo } = context(3, null);
    await expect(service.deleteCodingJob(2, 5, 7)).resolves.toEqual({ success: true });
    expect(repo.delete).toHaveBeenCalledWith({ id: 2, workspace_id: 5 });
    await expect(service.deleteCodingJob(1, 6, 7)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sets bundle creators from the actor and ignores forged ownership fields', async () => {
    const { repo } = context();
    const service = new VariableBundleService(repo as never);
    await expect(service.createVariableBundle(5, {
      name: 'New', variables: [], creatorUserId: 99
    } as never, 7)).resolves.toMatchObject({ creatorUserId: 7 });
    await expect(service.updateVariableBundle(9, 5, {
      name: 'Renamed', creatorUserId: 99, workspace_id: 6
    } as never, 7)).resolves.toMatchObject({ creatorUserId: 7, workspace_id: 5, name: 'Renamed' });
  });

  it.each([8, null])('protects bundle mutation and removal for owner %s', async owner => {
    const { repo } = context(2, owner);
    const service = new VariableBundleService(repo as never);
    await expect(service.updateVariableBundle(9, 5, { name: 'Changed' }, 7)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteVariableBundle(9, 5, 7)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.addVariableToBundle(9, 5, { unitName: 'U', variableId: 'V' }, 7)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removeVariableFromBundle(9, 5, 'U', 'V', 7)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('does not partially delete an owned training with a foreign child job', async () => {
    const { repo } = context(2, 8);
    const service = Object.assign(Object.create(CoderTrainingService.prototype), {
      coderTrainingRepository: repo,
      logger: { log: jest.fn(), error: jest.fn() }
    }) as CoderTrainingService;
    await expect(service.deleteCoderTraining(5, 10, 7)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('fails closed when direct service callers omit the actor', async () => {
    const { service, manager } = context(3);
    await expect(service.deleteCodingJobs(5, [1])).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.remove).not.toHaveBeenCalled();
  });

  it.each([8, null])('rejects issue-review progress and notes for source owner %s', async owner => {
    const { service, repo, jobs } = context(2, owner);
    repo.findOne.mockResolvedValue(jobs.get(2) as never);
    await expect(service.saveCodingIssueReviewProgress(2, 7, {} as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.saveCodingIssueReviewNotes(2, 7, {} as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
