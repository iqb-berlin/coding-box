import { DataSource, EntityManager, QueryRunner } from 'typeorm';

const WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE = 774020251;

type QueryRunnerFactory = Pick<DataSource, 'createQueryRunner'> &
Partial<Pick<DataSource, 'options'>>;

interface BlockingMutationPoolState {
  active: number;
  limit: number;
  waiters: Array<() => void>;
}

// Blocking advisory locks occupy a pool connection. Keep one connection free
// for legacy callbacks that still obtain their own connection while allowing
// independent workspace mutations to use the remaining pool capacity.
const blockingMutationPoolStates = new WeakMap<
QueryRunnerFactory,
BlockingMutationPoolState
>();

export type WorkspaceTestResultsMutationLockAttempt<T> =
  | { acquired: true; value: T }
  | { acquired: false };

function normalizeWorkspaceId(workspaceId: number): number {
  const normalized = Number(workspaceId);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error('A valid workspace id is required for the test-results mutation lock.');
  }
  return normalized;
}

function getBlockingMutationPoolLimit(connection: QueryRunnerFactory): number {
  const options = connection.options as {
    poolSize?: number;
    extra?: { max?: number };
  } | undefined;
  const configuredPoolSize = options?.extra?.max ?? options?.poolSize ?? 10;
  const normalizedPoolSize = Number.isInteger(configuredPoolSize) &&
    configuredPoolSize > 0 ?
    configuredPoolSize :
    10;
  return Math.max(1, normalizedPoolSize - 1);
}

async function acquireBlockingMutationPoolSlot(
  connection: QueryRunnerFactory
): Promise<() => void> {
  let state = blockingMutationPoolStates.get(connection);
  if (!state) {
    state = {
      active: 0,
      limit: getBlockingMutationPoolLimit(connection),
      waiters: []
    };
    blockingMutationPoolStates.set(connection, state);
  }

  if (state.active >= state.limit) {
    await new Promise<void>(resolve => {
      state.waiters.push(resolve);
    });
  } else {
    state.active += 1;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;

    const next = state.waiters.shift();
    if (next) {
      next();
      return;
    }

    state.active -= 1;
    if (state.active === 0) {
      blockingMutationPoolStates.delete(connection);
    }
  };
}

async function withBlockingMutationPoolSlot<T>(
  connection: QueryRunnerFactory,
  callback: () => Promise<T>
): Promise<T> {
  const releaseSlot = await acquireBlockingMutationPoolSlot(connection);
  try {
    return await callback();
  } finally {
    releaseSlot();
  }
}

export async function lockWorkspaceTestResultsMutationInTransaction(
  manager: EntityManager,
  workspaceId: number
): Promise<void> {
  await manager.query(
    'SELECT pg_advisory_xact_lock($1::int, $2::int)',
    [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  );
}

export async function lockWorkspaceTestResultsMutation(
  queryRunner: QueryRunner,
  workspaceId: number
): Promise<void> {
  await queryRunner.query(
    'SELECT pg_advisory_lock($1::int, $2::int)',
    [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  );
}

export async function unlockWorkspaceTestResultsMutation(
  queryRunner: QueryRunner,
  workspaceId: number
): Promise<void> {
  await queryRunner.query(
    'SELECT pg_advisory_unlock($1::int, $2::int)',
    [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  );
}

export async function tryLockWorkspaceTestResultsMutation(
  queryRunner: QueryRunner,
  workspaceId: number
): Promise<boolean> {
  const rows = await queryRunner.query(
    'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
    [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  ) as Array<{ locked: boolean }>;
  return rows[0]?.locked === true;
}

export async function withWorkspaceTestResultsMutationLock<T>(
  connection: QueryRunnerFactory,
  workspaceId: number,
  callback: (queryRunner: QueryRunner) => Promise<T>
): Promise<T> {
  return withBlockingMutationPoolSlot(connection, async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const queryRunner = connection.createQueryRunner();
    let locked = false;

    await queryRunner.connect();

    try {
      await lockWorkspaceTestResultsMutation(queryRunner, normalizedWorkspaceId);
      locked = true;
      return await callback(queryRunner);
    } finally {
      try {
        if (locked) {
          await unlockWorkspaceTestResultsMutation(
            queryRunner,
            normalizedWorkspaceId
          );
        }
      } finally {
        await queryRunner.release();
      }
    }
  });
}

export async function tryWithWorkspaceTestResultsMutationLock<T>(
  connection: QueryRunnerFactory,
  workspaceId: number,
  callback: (queryRunner: QueryRunner) => Promise<T>
): Promise<WorkspaceTestResultsMutationLockAttempt<T>> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const queryRunner: QueryRunner = connection.createQueryRunner();
  let locked = false;

  await queryRunner.connect();

  try {
    locked = await tryLockWorkspaceTestResultsMutation(
      queryRunner,
      normalizedWorkspaceId
    );
    if (!locked) {
      return { acquired: false };
    }
    return {
      acquired: true,
      value: await callback(queryRunner)
    };
  } finally {
    try {
      if (locked) {
        await unlockWorkspaceTestResultsMutation(
          queryRunner,
          normalizedWorkspaceId
        );
      }
    } finally {
      await queryRunner.release();
    }
  }
}
