export interface WorkspaceAdmin {
  label: string;
  id: string;
  type: string;
  flags: {
    mode: string;
  };
}

export interface Testcenter {
  id: number;
  label: string;
}
