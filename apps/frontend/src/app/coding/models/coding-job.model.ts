export interface CodingJob {
  id: number;
  workspace_id: number;
  name: string;
  description?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  assignedCoders: number[];
  assignedVariables?: Variable[];
  assignedVariableBundles?: VariableBundle[];
  variables?: Variable[];
  variableBundles?: VariableBundle[];
  variableBundleIds?: number[];
}

export interface Variable {
  unitName: string;
  variableId: string;
}

export interface VariableBundle {
  id: number;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  variables: Variable[];
}
