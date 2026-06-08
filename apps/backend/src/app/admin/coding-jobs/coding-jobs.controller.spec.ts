import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { CodingJobsController } from './coding-jobs.controller';

describe('CodingJobsController', () => {
  let controller: CodingJobsController;
  let codingJobService: {
    assertUserCanAccessCodingJob: jest.Mock;
    getCodingJobById: jest.Mock;
    getCodingJobsByCoder: jest.Mock;
    getResponsesForCodingJob: jest.Mock;
  };
  let usersService: {
    getUserIsAdmin: jest.Mock;
  };

  const requestWithUser = (
    user: { id?: number | string; userId?: number | string } | undefined
  ): Request => ({ user }) as unknown as Request;

  const codingJob = (id: number, workspaceId: number) => ({
    id,
    workspace_id: workspaceId,
    name: `Job ${id}`,
    status: 'pending',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z')
  });

  beforeEach(() => {
    codingJobService = {
      assertUserCanAccessCodingJob: jest.fn().mockResolvedValue(undefined),
      getCodingJobById: jest.fn().mockResolvedValue(codingJob(7, 5)),
      getCodingJobsByCoder: jest.fn().mockResolvedValue([
        codingJob(7, 5),
        codingJob(8, 6)
      ]),
      getResponsesForCodingJob: jest.fn().mockResolvedValue([
        {
          id: 101,
          unitid: 11,
          variableid: 'var1',
          status: 0,
          value: 'A',
          subform: '',
          code_v1: 1,
          score_v1: 1,
          status_v1: 0,
          unit: {
            id: 11,
            name: 'Unit 1',
            alias: 'U1'
          }
        }
      ])
    };
    usersService = {
      getUserIsAdmin: jest.fn().mockResolvedValue(false)
    };
    controller = new CodingJobsController(
      codingJobService as never,
      usersService as never
    );
  });

  it('checks the current user before returning a direct coding job', async () => {
    await controller.getCodingJobById(7, requestWithUser({ id: 42 }));

    expect(codingJobService.assertUserCanAccessCodingJob)
      .toHaveBeenCalledWith(7, 5, 42);
  });

  it('does not load responses when the current user cannot access the job', async () => {
    codingJobService.assertUserCanAccessCodingJob
      .mockRejectedValue(new ForbiddenException());

    await expect(controller.getResponsesForCodingJob(
      7,
      requestWithUser({ id: 42 })
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(codingJobService.getResponsesForCodingJob).not.toHaveBeenCalled();
  });

  it('allows users to query their own direct coder-job list and checks each job', async () => {
    await controller.getCodingJobsByCoder(42, requestWithUser({ id: 42 }));

    expect(usersService.getUserIsAdmin).not.toHaveBeenCalled();
    expect(codingJobService.getCodingJobsByCoder).toHaveBeenCalledWith(42);
    expect(codingJobService.assertUserCanAccessCodingJob).toHaveBeenCalledWith(
      7,
      5,
      42
    );
    expect(codingJobService.assertUserCanAccessCodingJob).toHaveBeenCalledWith(
      8,
      6,
      42
    );
  });

  it('rejects direct coder-job queries for other users unless the requester is a system admin', async () => {
    await expect(controller.getCodingJobsByCoder(
      99,
      requestWithUser({ id: 42 })
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersService.getUserIsAdmin).toHaveBeenCalledWith(42);
    expect(codingJobService.getCodingJobsByCoder).not.toHaveBeenCalled();
  });

  it('allows system admins to query direct coder-job lists for other users', async () => {
    usersService.getUserIsAdmin.mockResolvedValue(true);

    await controller.getCodingJobsByCoder(99, requestWithUser({ id: 42 }));

    expect(codingJobService.getCodingJobsByCoder).toHaveBeenCalledWith(99);
    expect(codingJobService.assertUserCanAccessCodingJob).toHaveBeenCalledWith(
      7,
      5,
      42
    );
  });

  it('rejects direct requests without a user id', async () => {
    await expect(controller.getCodingJobById(
      7,
      requestWithUser(undefined)
    )).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
