export interface ValidationTaskDto {
  id: number;
  workspace_id: number;
  validation_type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'testFiles' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'deleteTestResults' | 'deleteTestLogs' | 'duplicateResponses';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  progress_message?: string;
  error?: string;
  page?: number;
  limit?: number;
  cache_key?: string;
  created_at: Date;
  updated_at: Date;
}
