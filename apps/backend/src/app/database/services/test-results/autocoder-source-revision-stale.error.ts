export class AutocoderSourceRevisionStaleError extends Error {
  constructor(
    workspaceId: number,
    expectedRevision: number | undefined
  ) {
    super(
      `Auto-coding results were not applied for workspace ${workspaceId}: ` +
      `test results revision changed after the job was planned${
        expectedRevision === undefined ? '.' : ` (planned revision ${expectedRevision}).`
      }`
    );
    this.name = 'AutocoderSourceRevisionStaleError';
  }
}
