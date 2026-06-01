export type TestGroupsLoadStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'unknown';

export type TestGroupsLoadPhase =
  | 'fetching-testcenter-groups'
  | 'checking-workspace-groups'
  | 'checking-booklet-logs'
  | 'annotating-groups';

export interface TestGroupsLoadProgressDto {
  importRunId: string;
  status: TestGroupsLoadStatus;
  phase?: TestGroupsLoadPhase;
  totalGroups: number;
  processedGroups: number;
  existingGroups: number;
  groupsWithLogs: number;
  message?: string;
  error?: string;
  updatedAt: number;
}
