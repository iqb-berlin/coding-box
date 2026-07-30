import { DataSource, EntityManager, QueryRunner } from 'typeorm';

type QueryExecutor = Pick<DataSource, 'query'> |
Pick<EntityManager, 'query'> |
Pick<QueryRunner, 'query'>;

export interface WorkspaceCodingStatusRevision {
  testResultsRevision: number;
  codingStatusRevision: string;
}

export function normalizeWorkspaceId(workspaceId: number): number {
  const normalized = Number(workspaceId);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error('A valid workspace id is required for the coding-status revision.');
  }
  return normalized;
}

export async function touchWorkspaceCodingStatusRevision(
  executor: QueryExecutor,
  workspaceId: number
): Promise<void> {
  await executor.query(
    `
      INSERT INTO workspace_test_results_revision (
        workspace_id,
        revision,
        status_revision,
        updated_at
      )
      VALUES ($1, 0, 1, now())
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        status_revision = workspace_test_results_revision.status_revision + 1,
        updated_at = now()
    `,
    [normalizeWorkspaceId(workspaceId)]
  );
}

export async function getWorkspaceCodingStatusRevision(
  executor: QueryExecutor,
  workspaceId: number
): Promise<WorkspaceCodingStatusRevision> {
  const rows = await executor.query(
    `
      SELECT revision, status_revision
      FROM workspace_test_results_revision
      WHERE workspace_id = $1
    `,
    [normalizeWorkspaceId(workspaceId)]
  ) as Array<{
    revision: number | string;
    status_revision: number | string;
  }>;

  return {
    testResultsRevision: Number(rows[0]?.revision || 0),
    codingStatusRevision: String(rows[0]?.status_revision || 0)
  };
}
