import {
  getWorkspaceCodingStatusRevision,
  normalizeWorkspaceId,
  touchWorkspaceCodingStatusRevision
} from './workspace-coding-status-revision.util';

describe('workspace coding status revision', () => {
  it('rejects invalid workspace ids', () => {
    expect(() => normalizeWorkspaceId(0)).toThrow('valid workspace id');
    expect(() => normalizeWorkspaceId(Number.NaN)).toThrow('valid workspace id');
  });

  it('increments the coding status revision atomically', async () => {
    const executor = { query: jest.fn().mockResolvedValue([]) };

    await touchWorkspaceCodingStatusRevision(executor, 42);

    expect(executor.query).toHaveBeenCalledWith(
      expect.stringContaining('status_revision + 1'),
      [42]
    );
  });

  it('returns zero revisions when no row exists', async () => {
    const executor = { query: jest.fn().mockResolvedValue([]) };

    await expect(getWorkspaceCodingStatusRevision(executor, 42)).resolves.toEqual({
      testResultsRevision: 0,
      codingStatusRevision: '0'
    });
  });

  it('keeps bigint coding status revisions as strings', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue([{
        revision: '17',
        status_revision: '9007199254740993'
      }])
    };

    await expect(getWorkspaceCodingStatusRevision(executor, 42)).resolves.toEqual({
      testResultsRevision: 17,
      codingStatusRevision: '9007199254740993'
    });
  });
});
