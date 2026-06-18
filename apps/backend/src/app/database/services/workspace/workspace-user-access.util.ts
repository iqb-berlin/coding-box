import { BadRequestException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import User from '../../entities/user.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';

export const STUDY_MANAGER_ACCESS_LEVEL = 3;

export const DEFAULT_WORKSPACE_USER_ACCESS = {
  accessLevel: 1,
  canCode: true
} as const;

type WorkspaceUserAccessEntry = Pick<WorkspaceUser, 'workspaceId' | 'userId' | 'accessLevel'>;
type WorkspaceUserDeletionEntry = Pick<WorkspaceUser, 'workspaceId' | 'userId'>;

export async function lockWorkspaceUserRows(
  manager: EntityManager,
  workspaceIds: number[]
): Promise<WorkspaceUser[]> {
  const uniqueWorkspaceIds = Array.from(new Set(workspaceIds));
  if (uniqueWorkspaceIds.length === 0) {
    return [];
  }

  return manager
    .getRepository(WorkspaceUser)
    .createQueryBuilder('workspaceUser')
    .setLock('pessimistic_write')
    .where({ workspaceId: In(uniqueWorkspaceIds) })
    .getMany();
}

export async function lockUserRows(
  manager: EntityManager,
  userIds: number[]
): Promise<void> {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) {
    return;
  }

  await manager
    .getRepository(User)
    .createQueryBuilder('appUser')
    .setLock('pessimistic_write')
    .where({ id: In(uniqueUserIds) })
    .getMany();
}

export function assertStudyManagersRemain(
  workspaceIds: number[],
  existingEntries: WorkspaceUserAccessEntry[],
  entriesToUpsert: WorkspaceUserAccessEntry[],
  entriesToDelete: WorkspaceUserDeletionEntry[]
): void {
  const uniqueWorkspaceIds = Array.from(new Set(workspaceIds));
  if (uniqueWorkspaceIds.length === 0) {
    return;
  }

  const studyManagersByWorkspaceId = new Map<number, Set<number>>();
  uniqueWorkspaceIds.forEach(workspaceId => {
    studyManagersByWorkspaceId.set(workspaceId, new Set<number>());
  });

  existingEntries
    .filter(entry => entry.accessLevel === STUDY_MANAGER_ACCESS_LEVEL)
    .forEach(entry => {
      studyManagersByWorkspaceId.get(entry.workspaceId)?.add(entry.userId);
    });

  entriesToDelete.forEach(entry => {
    studyManagersByWorkspaceId.get(entry.workspaceId)?.delete(entry.userId);
  });

  entriesToUpsert.forEach(entry => {
    const studyManagerIds = studyManagersByWorkspaceId.get(entry.workspaceId);
    if (!studyManagerIds) {
      return;
    }

    if (entry.accessLevel === STUDY_MANAGER_ACCESS_LEVEL) {
      studyManagerIds.add(entry.userId);
    } else {
      studyManagerIds.delete(entry.userId);
    }
  });

  const workspaceWithoutStudyManager = uniqueWorkspaceIds.find(
    workspaceId => (studyManagersByWorkspaceId.get(workspaceId)?.size ?? 0) === 0
  );
  if (workspaceWithoutStudyManager !== undefined) {
    throw new BadRequestException('At least one study manager must remain assigned to each workspace.');
  }
}
