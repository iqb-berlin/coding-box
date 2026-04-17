export interface ContentPoolSettings {
  enabled: boolean;
  baseUrl: string;
}

export interface ContentPoolAcpSummary {
  id: string;
  packageId?: string;
  name?: string;
  description?: string;
}

export interface ContentPoolAcpListResponse {
  settings: ContentPoolSettings;
  acps: ContentPoolAcpSummary[];
}

export interface ContentPoolReplaceCodingSchemeRequest {
  username: string;
  password: string;
  acpId: string;
  fileId: number;
  changelog?: string;
}

export interface ContentPoolReplaceCodingSchemeResponse {
  acpId: string;
  fileName: string;
  snapshotId?: string;
  versionNumber?: number;
  changelog: string;
}
