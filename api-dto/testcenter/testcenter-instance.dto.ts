export interface TestcenterInstanceDto {
  label: string;
  baseUrl: string;
  source: 'standard' | 'environment' | 'administrator';
}

export interface TestcenterInstanceInput {
  label: string;
  baseUrl: string;
}

export interface TestcenterConnectionTestDto {
  version: string;
  checkedAt: string;
}
