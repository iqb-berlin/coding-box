import { EntityManager } from 'typeorm';

type ResponseCodingUpdate = { responseId: number; code: number | null; score: number | null };

/** Call within the owning mutation transaction after conflict/permission checks. */
export async function updateResponseCodingBatch(
  manager: EntityManager, updates: ResponseCodingUpdate[], completedStatus: number
): Promise<void> {
  const batchSize = 500;
  for (let offset = 0; offset < updates.length; offset += batchSize) {
    const batch = updates.slice(offset, offset + batchSize);
    const parameters: Array<number | null> = [completedStatus];
    const values = batch.map(update => {
      const first = parameters.length + 1;
      parameters.push(update.responseId, update.code, update.score);
      return `($${first}::integer, $${first + 1}::bigint, $${first + 2}::bigint)`;
    });
    await manager.query(`
      UPDATE response AS target
      SET code_v2 = source.code, score_v2 = source.score, status_v2 = $1,
          autocoder_invalidated_version = NULL
      FROM (VALUES ${values.join(', ')}) AS source(id, code, score)
      WHERE target.id = source.id
    `, parameters);
  }
}
