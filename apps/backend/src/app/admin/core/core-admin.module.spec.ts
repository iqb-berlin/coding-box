import { DatabaseExportProcessor } from '../database/database-export.processor';
import { getEnabledCoreAdminProcessors } from './core-admin.module';

describe('CoreAdminModule processor selection', () => {
  it('enables the database export processor by default', () => {
    expect(getEnabledCoreAdminProcessors(undefined, undefined)).toEqual([
      DatabaseExportProcessor
    ]);
  });

  it('does not register database exports for the dedicated data export worker', () => {
    expect(getEnabledCoreAdminProcessors('data-export', undefined)).toEqual([]);
  });

  it('can isolate the database export processor when requested', () => {
    expect(getEnabledCoreAdminProcessors('database-export', undefined)).toEqual([
      DatabaseExportProcessor
    ]);
  });

  it('can remove the database export processor from a process', () => {
    expect(getEnabledCoreAdminProcessors('all', 'database-export')).toEqual([]);
  });
});
