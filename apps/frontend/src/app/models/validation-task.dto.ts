export interface ValidationTaskDto {
  id: number;
  workspace_id: number;
  validation_type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  page?: number;
  limit?: number;
  created_at: Date;
  updated_at: Date;
}
