import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import User from '../../entities/user.entity';
import { lockWorkspaceTestResultsMutationInTransaction } from './workspace-test-results-lock.util';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';

export const codingResourceEntities = {
  bundle: VariableBundle,
  definition: JobDefinition,
  job: CodingJob,
  training: CoderTraining
};

export type CodingResourceKind = keyof typeof codingResourceEntities;

export interface CodingActor {
  userId: number;
  accessLevel: number;
  isAdmin: boolean;
}

export function canMutateCodingResource(actor: CodingActor, creatorUserId: number | null | undefined): boolean {
  return actor.isAdmin || actor.accessLevel >= 3 ||
    (actor.accessLevel === 2 && creatorUserId != null && creatorUserId === actor.userId);
}

export async function getCodingActor(manager: EntityManager, workspaceId: number, userId?: number | null): Promise<CodingActor> {
  if (!Number.isSafeInteger(userId) || (userId ?? 0) <= 0) {
    throw new ForbiddenException('An authenticated coding manager is required');
  }
  const user = await manager.findOne(User, { where: { id: userId as number } });
  if (!user) throw new ForbiddenException('Coding manager not found');
  const access = user.isAdmin ? null : await manager.findOne(WorkspaceUser, {
    where: { workspaceId, userId: user.id }
  });
  return { userId: user.id, isAdmin: user.isAdmin, accessLevel: access?.accessLevel ?? 0 };
}

export async function assertCodingResourceCreation(manager: EntityManager, workspaceId: number, userId?: number | null): Promise<number> {
  const actor = await getCodingActor(manager, workspaceId, userId);
  if (!actor.isAdmin && actor.accessLevel < 2) throw new ForbiddenException('Coding management access is required');
  return actor.userId;
}

export async function assertCodingResourceMutation(
  manager: EntityManager,
  workspaceId: number,
  kind: CodingResourceKind,
  id: number,
  userId?: number | null
): Promise<{ id: number; workspace_id: number; creatorUserId: number | null }> {
  const actor = await getCodingActor(manager, workspaceId, userId);
  const resource = await manager.findOne<{ id: number; workspace_id: number; creatorUserId: number | null }>(codingResourceEntities[kind], {
    where: { id, workspace_id: workspaceId },
    ...(manager.queryRunner?.isTransactionActive ? { lock: { mode: 'pessimistic_write' as const } } : {})
  });
  if (!resource) throw new NotFoundException('Coding resource not found in this workspace');
  if (!canMutateCodingResource(actor, resource.creatorUserId)) {
    throw new ForbiddenException('Only the creator may change this coding resource');
  }
  return resource;
}

/** Filter-independent authorization: UI scope must never hide another owner's job. */
export async function getCodingReviewCapabilities(
  manager: EntityManager,
  workspaceId: number,
  responseIds: number[],
  userId?: number | null
): Promise<{ canApplyResults: boolean; canEditDraft: Map<number, boolean> }> {
  const actor = await getCodingActor(manager, workspaceId, userId);
  const canEditDraft = new Map<number, boolean>();
  if (responseIds.length > 0) {
    const units = await manager.find(CodingJobUnit, {
      where: { response_id: In(responseIds), coding_job: { workspace_id: workspaceId } },
      relations: ['coding_job', 'coding_job.codingJobCoders']
    });
    for (const responseId of responseIds) {
      const jobs = units.filter(unit => unit.response_id === responseId)
        .map(unit => unit.coding_job)
        .filter(job => job && job.job_type !== 'coding_issue_review' &&
          new Set((job.codingJobCoders || []).map(coder => coder.user_id)).size === 1);
      const coders = new Set(jobs.flatMap(job => job.codingJobCoders.map(coder => coder.user_id)));
      canEditDraft.set(responseId, coders.size > 1 && jobs.length > 0 &&
        jobs.every(job => canMutateCodingResource(actor, job.creatorUserId)));
    }
  }
  return { canApplyResults: actor.isAdmin || actor.accessLevel >= 3, canEditDraft };
}

export async function assertCodingReviewMutation(manager: EntityManager, workspaceId: number, responseId: number, userId: number): Promise<void> {
  await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
  const capabilities = await getCodingReviewCapabilities(manager, workspaceId, [responseId], userId);
  if (!capabilities.canEditDraft.get(responseId)) {
    throw new ForbiddenException('Only the creator of all participating jobs may change this review');
  }
}
