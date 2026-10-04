import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import User from '../../entities/user.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import {
  assertCodingResourceCreation,
  assertCodingResourceMutation,
  assertCodingReviewMutation,
  canMutateCodingResource,
  codingResourceEntities,
  getCodingReviewCapabilities
} from './coding-ownership.policy';

describe('Coding resource ownership', () => {
  const makeManager = (level: number, owner: number | null, isAdmin = false) => ({
    query: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(async (entity, options) => {
      if (entity === User) return { id: 7, isAdmin };
      if (entity === WorkspaceUser) return { userId: 7, workspaceId: 1, accessLevel: level };
      return options.where.workspace_id === 1 ? { id: 9, workspace_id: 1, creatorUserId: owner } : null;
    }),
    find: jest.fn(async () => [])
  });

  it.each([
    [0, 7, false], [1, 7, false], [2, 7, true], [2, 8, false],
    [2, null, false], [3, 8, true], [3, null, true]
  ])('level %s with owner %s has mutation capability %s', (level, owner, allowed) => {
    expect(canMutateCodingResource({ userId: 7, accessLevel: level as number, isAdmin: false }, owner as number | null)).toBe(allowed);
  });

  it('allows administrators regardless of legacy ownership', () => {
    expect(canMutateCodingResource({ userId: 7, accessLevel: 0, isAdmin: true }, null)).toBe(true);
  });

  it.each(Object.keys(codingResourceEntities))('enforces ownership for %s', async kind => {
    const own = makeManager(2, 7);
    await expect(assertCodingResourceMutation(own as unknown as EntityManager, 1, kind as keyof typeof codingResourceEntities, 9, 7)).resolves.toMatchObject({ creatorUserId: 7 });
    for (const owner of [8, null]) {
      const foreign = makeManager(2, owner);
      await expect(assertCodingResourceMutation(foreign as unknown as EntityManager, 1, kind as keyof typeof codingResourceEntities, 9, 7)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('fails closed without an authenticated actor', async () => {
    const manager = makeManager(3, 7);
    await expect(assertCodingResourceCreation(manager as unknown as EntityManager, 1)).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.findOne).not.toHaveBeenCalled();
  });

  it('does not grant a coder administrative creation rights', async () => {
    await expect(assertCodingResourceCreation(makeManager(1, 7) as unknown as EntityManager, 1, 7)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes lookup to the requested workspace', async () => {
    await expect(assertCodingResourceMutation(makeManager(3, 7) as unknown as EntityManager, 2, 'job', 9, 7)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('locks the resource when already inside a transaction', async () => {
    const manager = { ...makeManager(2, 7), queryRunner: { isTransactionActive: true } };
    await assertCodingResourceMutation(manager as unknown as EntityManager, 1, 'job', 9, 7);
    expect(manager.findOne).toHaveBeenLastCalledWith(codingResourceEntities.job, expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
  });

  const unit = (jobId: number, coderId: number, creatorUserId: number | null) => ({
    response_id: 42,
    coding_job: {
      id: jobId, workspace_id: 1, creatorUserId, job_type: 'regular', codingJobCoders: [{ user_id: coderId }]
    }
  });

  it.each([7, 8, null])('checks every job of a response, including owner %s outside UI scope', async owner => {
    const manager = makeManager(2, 7);
    manager.find.mockResolvedValue([unit(1, 11, 7), unit(2, 12, owner)] as never);
    const result = await getCodingReviewCapabilities(manager as unknown as EntityManager, 1, [42], 7);
    expect(result.canEditDraft.get(42)).toBe(owner === 7);
    expect(result.canApplyResults).toBe(false);
    expect(manager.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      where: expect.objectContaining({ coding_job: { workspace_id: 1 } })
    }));
  });

  it('rejects an empty or single-coder review case', async () => {
    const manager = makeManager(2, 7);
    await expect(assertCodingReviewMutation(manager as unknown as EntityManager, 1, 42, 7)).rejects.toBeInstanceOf(ForbiddenException);
    manager.find.mockResolvedValue([unit(1, 11, 7), unit(2, 11, 7)] as never);
    await expect(assertCodingReviewMutation(manager as unknown as EntityManager, 1, 42, 7)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([[3, false], [0, true]])('retains level 3 or administrator review capabilities for legacy jobs', async (level, isAdmin) => {
    const manager = makeManager(level as number, null, isAdmin as boolean);
    manager.find.mockResolvedValue([unit(1, 11, null), unit(2, 12, null)] as never);
    const result = await getCodingReviewCapabilities(manager as unknown as EntityManager, 1, [42], 7);
    expect(result.canEditDraft.get(42)).toBe(true);
    expect(result.canApplyResults).toBe(true);
  });

  it('serializes the ownership check with job creation, reassignment and deletion', async () => {
    const manager = makeManager(2, 7);
    manager.find.mockResolvedValue([unit(1, 11, 7), unit(2, 12, 7)] as never);
    await assertCodingReviewMutation(manager as unknown as EntityManager, 1, 42, 7);
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(manager.find.mock.invocationCallOrder[0]);
  });
});
