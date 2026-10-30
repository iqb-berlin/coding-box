import type { EntityManager } from 'typeorm';
import type { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import type { UnitVariableDetailsDto } from '../../../models/unit-variable-details.dto';

export const WORKSPACE_FILE_METADATA_READER = Symbol('WORKSPACE_FILE_METADATA_READER');

export interface DerivedVariableMetadataSnapshot {
  metadataAvailable: boolean;
  derivedVariableMap: Map<string, Set<string>>;
  derivedVariablesBySourceMap: Map<string, Set<string>>;
}

/** Read-only file metadata required by coding; no upload or mutation operations. */
export interface WorkspaceFileMetadataReader {
  getUnitVariableMap(workspaceId: number, manager?: EntityManager): Promise<Map<string, Set<string>>>;
  getIntendedIncompleteSchemeVariableMap(workspaceId: number): Promise<Map<string, Set<string>>>;
  getDerivedVariableMap(workspaceId: number, manager?: EntityManager): Promise<Map<string, Set<string>>>;
  getDerivedVariablesBySourceMap(workspaceId: number, manager?: EntityManager): Promise<Map<string, Set<string>>>;
  getDerivedVariableMetadata(workspaceId: number, manager?: EntityManager): Promise<DerivedVariableMetadataSnapshot>;
  getManualInstructionVariableMap(workspaceId: number): Promise<Map<string, Set<string>>>;
  getCoderTrainingRequiredVariableMap(workspaceId: number): Promise<Map<string, Set<string>>>;
  getUnitVariableDetails(workspaceId: number): Promise<UnitVariableDetailsDto[]>;
  getVariableInfoForScheme(workspaceId: number, schemeFileId: string, manager?: EntityManager): Promise<VariableInfo[]>;
}
