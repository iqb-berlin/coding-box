export interface CodingJob {
  id: number;
  name: string;
  description?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  assignedCoders: number[];
  variables?: Variable[];
  variableBundles?: VariableBundle[];
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
