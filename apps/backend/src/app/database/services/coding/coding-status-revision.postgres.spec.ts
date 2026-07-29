import { DataSource, QueryRunner } from 'typeorm';
import { CodingFreshnessService } from './coding-freshness.service';
import {
  WorkspaceCodingStatusMutation,
  WorkspaceCodingStatusMutationService
} from '../shared';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ?
  describe :
  describe.skip;

const postgresConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  username: process.env.POSTGRES_USER || 'root',
  password: process.env.POSTGRES_PASSWORD || 'root-password',
  database: process.env.POSTGRES_DB || 'coding-box'
};

type MutationInternals = {
  beginOperation(
    executor: DataSource,
    id: number
  ): Promise<WorkspaceCodingStatusMutation>;
  completeOperation(
    executor: DataSource,
    id: number,
    operation: WorkspaceCodingStatusMutation
  ): Promise<void>;
  failOperation(
    executor: DataSource,
    id: number,
    revision: number
  ): Promise<void>;
};

describePostgres('Coding status revision Postgres integration', () => {
  let dataSource: DataSource;
  let workspaceId: number | undefined;

  const createServices = (): {
    freshness: CodingFreshnessService;
    mutation: WorkspaceCodingStatusMutationService;
  } => {
    let freshness: CodingFreshnessService;
    const mutation = new WorkspaceCodingStatusMutationService(
      dataSource,
      { get: () => freshness } as never
    );
    freshness = new CodingFreshnessService(
      {} as never,
      {} as never,
      dataSource,
      mutation,
      undefined,
      undefined
    );
    return { freshness, mutation };
  };

  const mutationInternals = (
    service: WorkspaceCodingStatusMutationService
  ): MutationInternals => service as unknown as MutationInternals;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      ...postgresConfig
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    if (workspaceId !== undefined) {
      await dataSource.query('DELETE FROM workspace WHERE id = $1', [workspaceId]);
      workspaceId = undefined;
    }
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('advances after a lower transaction id writes after a higher one committed', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [workspace] = await dataSource.query(
      `INSERT INTO workspace (name, settings)
       VALUES ($1, '{}'::jsonb)
       RETURNING id`,
      [`sr-order-${suffix}`]
    ) as Array<{ id: number }>;
    workspaceId = workspace.id;
    const [before] = await dataSource.query(
      `SELECT revision
       FROM workspace_coding_status_revision
       WHERE workspace_id = $1`,
      [workspaceId]
    ) as Array<{ revision: string }>;

    const lowerTransaction = dataSource.createQueryRunner();
    const higherTransaction = dataSource.createQueryRunner();
    await lowerTransaction.connect();
    await higherTransaction.connect();

    try {
      await lowerTransaction.startTransaction();
      const [lowerId] = await lowerTransaction.query(
        'SELECT txid_current()::text AS id'
      ) as Array<{ id: string }>;
      await higherTransaction.startTransaction();
      const [higherId] = await higherTransaction.query(
        'SELECT txid_current()::text AS id'
      ) as Array<{ id: string }>;
      expect(BigInt(lowerId.id)).toBeLessThan(BigInt(higherId.id));

      await higherTransaction.query(
        'SELECT touch_workspace_coding_status_revision_by_id($1)',
        [workspaceId]
      );
      await higherTransaction.commitTransaction();
      await lowerTransaction.query(
        'SELECT touch_workspace_coding_status_revision_by_id($1)',
        [workspaceId]
      );
      await lowerTransaction.commitTransaction();
    } finally {
      await rollbackIfActive(lowerTransaction);
      await rollbackIfActive(higherTransaction);
      await lowerTransaction.release();
      await higherTransaction.release();
    }

    const [after] = await dataSource.query(
      `SELECT revision
       FROM workspace_coding_status_revision
       WHERE workspace_id = $1`,
      [workspaceId]
    ) as Array<{ revision: string }>;
    expect(BigInt(after.revision)).toBe(BigInt(before.revision) + BigInt(2));
  }, 30000);

  it('advances only once for repeated touches in one transaction', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [workspace] = await dataSource.query(
      `INSERT INTO workspace (name, settings)
       VALUES ($1, '{}'::jsonb)
       RETURNING id`,
      [`sr-dedupe-${suffix}`]
    ) as Array<{ id: number }>;
    workspaceId = workspace.id;
    const [before] = await dataSource.query(
      `SELECT revision
       FROM workspace_coding_status_revision
       WHERE workspace_id = $1`,
      [workspaceId]
    ) as Array<{ revision: string }>;

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await runner.query(
        'SELECT touch_workspace_coding_status_revision_by_id($1)',
        [workspaceId]
      );
      await runner.query(
        'SELECT touch_workspace_coding_status_revision_by_id($1)',
        [workspaceId]
      );
      await runner.query(
        'SELECT touch_workspace_coding_status_revision_by_id($1)',
        [workspaceId]
      );
      await runner.commitTransaction();
    } finally {
      await rollbackIfActive(runner);
      await runner.release();
    }

    const [after] = await dataSource.query(
      `SELECT revision
       FROM workspace_coding_status_revision
       WHERE workspace_id = $1`,
      [workspaceId]
    ) as Array<{ revision: string }>;
    expect(BigInt(after.revision)).toBe(BigInt(before.revision) + BigInt(1));
  }, 30000);

  it('advances both workspaces when a response moves between them', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const runner = dataSource.createQueryRunner();
    let workspaceIds: number[] = [];
    let bookletInfoId: number | undefined;
    await runner.connect();
    await runner.startTransaction();

    try {
      const workspaces = await runner.query(
        `INSERT INTO workspace (name, settings)
         VALUES ($1, '{}'::jsonb), ($2, '{}'::jsonb)
         RETURNING id`,
        [`sr-move-a-${suffix}`, `sr-move-b-${suffix}`]
      ) as Array<{ id: number }>;
      workspaceIds = workspaces.map(workspace => workspace.id);
      const persons = await runner.query(
        `INSERT INTO persons ("group", login, code, workspace_id)
         VALUES ('g', 'a', 'a', $1), ('g', 'b', 'b', $2)
         RETURNING id`,
        workspaceIds
      ) as Array<{ id: number }>;
      const [bookletInfo] = await runner.query(
        `INSERT INTO bookletinfo (name, size)
         VALUES ($1, 0)
         RETURNING id`,
        [`sr-move-${suffix}`]
      ) as Array<{ id: number }>;
      bookletInfoId = bookletInfo.id;
      const booklets = await runner.query(
        `INSERT INTO booklet (infoid, personid)
         VALUES ($1, $2), ($1, $3)
         RETURNING id`,
        [bookletInfo.id, persons[0].id, persons[1].id]
      ) as Array<{ id: number }>;
      const units = await runner.query(
        `INSERT INTO unit (bookletid, name)
         VALUES ($1, 'UNIT-A'), ($2, 'UNIT-B')
         RETURNING id`,
        booklets.map(booklet => booklet.id)
      ) as Array<{ id: number }>;
      const [response] = await runner.query(
        `INSERT INTO response (unitid, variableid, status, value)
         VALUES ($1, 'VAR', 0, 'a')
         RETURNING id`,
        [units[0].id]
      ) as Array<{ id: number }>;
      await runner.commitTransaction();
      await runner.startTransaction();
      const before = await runner.query(
        `SELECT workspace_id, revision
         FROM workspace_coding_status_revision
         WHERE workspace_id = ANY($1::int[])
         ORDER BY workspace_id`,
        [workspaceIds]
      ) as Array<{ workspace_id: number; revision: string }>;

      await runner.query(
        'UPDATE response SET unitid = $1 WHERE id = $2',
        [units[1].id, response.id]
      );
      const [movedResponse] = await runner.query(
        'SELECT workspace_id FROM response WHERE id = $1',
        [response.id]
      ) as Array<{ workspace_id: number }>;
      expect(movedResponse.workspace_id).toBe(workspaceIds[1]);

      const after = await runner.query(
        `SELECT workspace_id, revision
         FROM workspace_coding_status_revision
         WHERE workspace_id = ANY($1::int[])
         ORDER BY workspace_id`,
        [workspaceIds]
      ) as Array<{ workspace_id: number; revision: string }>;
      expect(after).toHaveLength(2);
      expect(after.map((row, index) => (
        BigInt(row.revision) - BigInt(before[index].revision)
      ))).toEqual([BigInt(1), BigInt(1)]);

      await runner.query(
        'UPDATE persons SET workspace_id = $1 WHERE id = $2',
        [workspaceIds[0], persons[1].id]
      );
      const [synchronizedHierarchy] = await runner.query(
        `SELECT unit_record.workspace_id AS unit_workspace_id,
                response_record.workspace_id AS response_workspace_id
         FROM unit unit_record
         INNER JOIN response response_record
           ON response_record.unitid = unit_record.id
         WHERE response_record.id = $1`,
        [response.id]
      ) as Array<{
        unit_workspace_id: number;
        response_workspace_id: number;
      }>;
      expect(synchronizedHierarchy).toEqual({
        unit_workspace_id: workspaceIds[0],
        response_workspace_id: workspaceIds[0]
      });
    } finally {
      await rollbackIfActive(runner);
      await runner.release();
      if (workspaceIds.length > 0) {
        await dataSource.query(
          'DELETE FROM workspace WHERE id = ANY($1::int[])',
          [workspaceIds]
        );
      }
      if (bookletInfoId !== undefined) {
        await dataSource.query(
          'DELETE FROM bookletinfo WHERE id = $1',
          [bookletInfoId]
        );
      }
    }
  }, 30000);

  it('expires only the orphaned operation when revision updates overlap', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [workspace] = await dataSource.query(
      `INSERT INTO workspace (name, settings)
       VALUES ($1, '{}'::jsonb)
       RETURNING id`,
      [`sr-operations-${suffix}`]
    ) as Array<{ id: number }>;
    workspaceId = workspace.id;
    const { freshness, mutation } = createServices();
    const serviceInternals = mutationInternals(mutation);

    const orphanedOperation = await serviceInternals.beginOperation(
      dataSource,
      workspaceId
    );
    const completedOperation = await serviceInternals.beginOperation(
      dataSource,
      workspaceId
    );
    await serviceInternals.completeOperation(
      dataSource,
      workspaceId,
      completedOperation
    );

    await expect(freshness.getWorkspaceStatusRevision(workspaceId))
      .resolves.toMatchObject({ stable: false });

    await dataSource.query(
      `UPDATE workspace_coding_status_revision_operation
       SET started_at = now() - interval '25 hours'
       WHERE workspace_id = $1
         AND test_results_revision = $2`,
      [workspaceId, orphanedOperation.revision]
    );
    await expect(freshness.getWorkspaceStatusRevision(workspaceId))
      .resolves.toMatchObject({ stable: false });

    await expect(mutation.recoverExpired(workspaceId)).resolves.toBe(true);
    const nextOperation = await serviceInternals.beginOperation(
      dataSource,
      workspaceId
    );
    const operations = await dataSource.query(
      `SELECT test_results_revision
       FROM workspace_coding_status_revision_operation
       WHERE workspace_id = $1
       ORDER BY test_results_revision`,
      [workspaceId]
    ) as Array<{ test_results_revision: number }>;
    expect(operations.map(operation => Number(operation.test_results_revision)))
      .toEqual([nextOperation.revision]);

    await serviceInternals.completeOperation(
      dataSource,
      workspaceId,
      nextOperation
    );
    await expect(freshness.getWorkspaceStatusRevision(workspaceId))
      .resolves.toMatchObject({ stable: true });
  }, 30000);

  it('conservatively reconciles a lone expired operation without another mutation', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [workspace] = await dataSource.query(
      `INSERT INTO workspace (name, settings)
       VALUES ($1, '{}'::jsonb)
       RETURNING id`,
      [`sr-orphan-${suffix}`]
    ) as Array<{ id: number }>;
    workspaceId = workspace.id;
    const { freshness, mutation } = createServices();
    const serviceInternals = mutationInternals(mutation);

    const orphanedOperation = await serviceInternals.beginOperation(
      dataSource,
      workspaceId
    );
    await dataSource.query(
      `UPDATE workspace_coding_status_revision_operation
       SET started_at = now() - interval '25 hours'
       WHERE workspace_id = $1
         AND test_results_revision = $2`,
      [workspaceId, orphanedOperation.revision]
    );

    await expect(freshness.getWorkspaceStatusRevision(workspaceId))
      .resolves.toMatchObject({ stable: false });
    await expect(mutation.recoverAllExpired())
      .resolves.toBe(1);
    await expect(freshness.getWorkspaceStatusRevision(workspaceId))
      .resolves.toMatchObject({ stable: true });
  }, 30000);

  it('does not hide an earlier failed operation after an unrelated operation succeeds', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [workspace] = await dataSource.query(
      `INSERT INTO workspace (name, settings)
       VALUES ($1, '{}'::jsonb)
       RETURNING id`,
      [`sr-failure-${suffix}`]
    ) as Array<{ id: number }>;
    workspaceId = workspace.id;
    const { freshness, mutation } = createServices();
    const serviceInternals = mutationInternals(mutation);

    const failedOperation = await serviceInternals.beginOperation(
      dataSource,
      workspaceId
    );
    await serviceInternals.failOperation(
      dataSource,
      workspaceId,
      failedOperation.revision
    );
    const successfulOperation = await serviceInternals.beginOperation(
      dataSource,
      workspaceId
    );
    await serviceInternals.completeOperation(
      dataSource,
      workspaceId,
      successfulOperation
    );

    await expect(freshness.getWorkspaceStatusRevision(workspaceId))
      .resolves.toMatchObject({ stable: false });
    const [status] = await dataSource.query(
      `SELECT failed_test_results_revision
       FROM workspace_coding_status_revision
       WHERE workspace_id = $1`,
      [workspaceId]
    ) as Array<{ failed_test_results_revision: number }>;
    expect(Number(status.failed_test_results_revision))
      .toBe(failedOperation.revision);

    await expect(
      mutation.reconcile(workspaceId)
    ).resolves.toBe(true);
    await expect(freshness.getWorkspaceStatusRevision(workspaceId))
      .resolves.toMatchObject({ stable: true });
  }, 30000);
});

const rollbackIfActive = async (runner: QueryRunner): Promise<void> => {
  if (runner.isTransactionActive) {
    await runner.rollbackTransaction();
  }
};
