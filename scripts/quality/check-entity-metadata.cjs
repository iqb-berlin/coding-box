const fs = require('node:fs');
const path = require('node:path');

// Use production nullability and decorator emission, not Jest's relaxed config.
require('ts-node').register({
  project: path.resolve(__dirname, '../../apps/backend/tsconfig.app.json'),
  transpileOnly: true
});
const { DataSource } = require('typeorm');
const directory = path.resolve(__dirname, '../../apps/backend/src/app/database/entities');
const entities = fs.readdirSync(directory)
  .filter(file => file.endsWith('.entity.ts'))
  .flatMap(file => Object.values(require(path.join(directory, file))))
  .filter(value => typeof value === 'function');

// Build and validate all PostgreSQL metadata without opening a DB connection.
const source = new DataSource({ type: 'postgres', entities });
source.buildMetadatas().then(() => {
  console.log(`PostgreSQL entity metadata valid (${source.entityMetadatas.length} entities).`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
