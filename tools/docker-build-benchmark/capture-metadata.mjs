import { writeFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import snapshot from '../../scripts/quality/entity-metadata-snapshot.cjs';

if (!process.env.BUILD_COMPARISON_METADATA_FILE) throw new Error('A snapshot file is required');
// Observe entities registered by the actual application artifact. Do not open
// database connections, synchronize a schema, or substitute source entities.
DataSource.prototype.initialize = async function () {
  try {
    await this.buildMetadatas();
    if (this.entityMetadatas.length !== 43) throw new Error(`Expected 43 entities, received ${this.entityMetadatas.length}`);
    writeFileSync(process.env.BUILD_COMPARISON_METADATA_FILE, JSON.stringify(snapshot(this), null, 2));
    console.log(`Captured ${this.entityMetadatas.length} runtime entity metadata records`);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
