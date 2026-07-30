import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { lastValueFrom, of, throwError } from 'rxjs';
import { CodingStatusMutationInterceptor } from './coding-status-mutation.interceptor';
import { CODING_STATUS_MUTATION_METADATA } from './coding-status-mutation.decorator';
import { WsgCodingJobController } from '../../wsg-admin/coding-job/coding-job.controller';
import { WorkspaceCoderTrainingController } from '../workspace/workspace-coder-training.controller';
import { WorkspaceCodingJobDefinitionController } from '../workspace/workspace-coding-job-definition.controller';

describe('CodingStatusMutationInterceptor', () => {
  const buildContext = (workspaceId = '42') => ({
    getHandler: jest.fn().mockReturnValue(() => undefined),
    getClass: jest.fn().mockReturnValue(class TestController {}),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({ params: { workspace_id: workspaceId } })
    })
  }) as unknown as ExecutionContext;

  it('increments after a successful explicitly marked mutation', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true)
    } as unknown as Reflector;
    const connection = {
      query: jest.fn().mockResolvedValue([])
    } as unknown as DataSource;
    const interceptor = new CodingStatusMutationInterceptor(reflector, connection);

    await expect(lastValueFrom(interceptor.intercept(
      buildContext(),
      { handle: () => of('ok') }
    ))).resolves.toBe('ok');
    expect(connection.query).toHaveBeenCalledTimes(1);
  });

  it('does not increment unmarked requests', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false)
    } as unknown as Reflector;
    const connection = { query: jest.fn() } as unknown as DataSource;
    const interceptor = new CodingStatusMutationInterceptor(reflector, connection);

    await lastValueFrom(interceptor.intercept(
      buildContext(),
      { handle: () => of('ok') }
    ));
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('does not increment failed mutations', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true)
    } as unknown as Reflector;
    const connection = { query: jest.fn() } as unknown as DataSource;
    const interceptor = new CodingStatusMutationInterceptor(reflector, connection);

    await expect(lastValueFrom(interceptor.intercept(
      buildContext(),
      { handle: () => throwError(() => new Error('failed')) }
    ))).rejects.toThrow('failed');
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('marks progress changes but not pure note changes', () => {
    expect(Reflect.getMetadata(
      CODING_STATUS_MUTATION_METADATA,
      WsgCodingJobController.prototype.saveCodingProgress
    )).toBe(true);
    expect(Reflect.getMetadata(
      CODING_STATUS_MUTATION_METADATA,
      WsgCodingJobController.prototype.saveCodingNotes
    )).toBeUndefined();
  });

  it('marks refresh apply but not refresh preview', () => {
    expect(Reflect.getMetadata(
      CODING_STATUS_MUTATION_METADATA,
      WorkspaceCodingJobDefinitionController.prototype.applyJobDefinitionRefresh
    )).toBe(true);
    expect(Reflect.getMetadata(
      CODING_STATUS_MUTATION_METADATA,
      WorkspaceCodingJobDefinitionController.prototype.previewJobDefinitionRefresh
    )).toBeUndefined();
  });

  it('does not mark training previews or draft discussion results', () => {
    expect(Reflect.getMetadata(
      CODING_STATUS_MUTATION_METADATA,
      WorkspaceCoderTrainingController.prototype.generateCoderTrainingPackages
    )).toBeUndefined();
    expect(Reflect.getMetadata(
      CODING_STATUS_MUTATION_METADATA,
      WorkspaceCoderTrainingController.prototype.saveDiscussionResult
    )).toBeUndefined();
    expect(Reflect.getMetadata(
      CODING_STATUS_MUTATION_METADATA,
      WorkspaceCoderTrainingController.prototype.applyDiscussionResults
    )).toBe(true);
  });
});
