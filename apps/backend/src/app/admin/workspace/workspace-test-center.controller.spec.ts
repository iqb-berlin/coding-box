import { WorkspaceTestCenterController } from './workspace-test-center.controller';
import { ImportResultDto } from '../../../../../../api-dto/files/import-options.dto';

describe('WorkspaceTestCenterController import completion', () => {
  it.each([true, false])('does not turn a saved import result (success=%s) into an HTTP error if filter refresh fails', async success => {
    const result: ImportResultDto = {
      success, testFiles: 0, responses: 1, logs: 0, persons: 1, booklets: 1, units: 1, importedGroups: []
    };
    const service = { importWorkspaceFiles: jest.fn().mockResolvedValue(result) };
    const cache = {
      generateFlatResponseFilterOptionsVersionKey: jest.fn().mockReturnValue('key'),
      incr: jest.fn().mockRejectedValue(new Error('Redis unavailable'))
    };
    const controller = new WorkspaceTestCenterController(service as never, cache as never, {} as never);
    const actual = await controller.importWorkspaceFiles(
      '1', '1', '', 'tc', 'token', 'false', 'true', 'false', 'false', 'false', 'false', 'false', 'g1', 'false', 'false', '', 'true', 'run', 'skip'
    );
    expect(actual.success).toBe(success);
    expect(cache.incr).toHaveBeenCalled();
    expect(actual.issues).toEqual([expect.objectContaining({ level: 'warning', message: expect.stringContaining('Antwortfilter') })]);
  });
});
