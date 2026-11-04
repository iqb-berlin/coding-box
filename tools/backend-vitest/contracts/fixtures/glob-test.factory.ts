import path from 'node:path';
import { DataSource } from 'typeorm';

// This fixture deliberately contains no Jest-specific API or helper import.
export const source = new DataSource({
  type: 'postgres',
  entities: [path.join(__dirname, '../../../../apps/backend/src/app/database/entities/*.entity.ts')],
  synchronize: false
});
