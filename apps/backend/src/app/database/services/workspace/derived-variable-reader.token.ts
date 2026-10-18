import type { EntityManager } from 'typeorm';

export const DERIVED_VARIABLE_READER = Symbol('DERIVED_VARIABLE_READER');

/** Read-only port; coding providers do not depend on the workspace file service. */
export interface DerivedVariableReader {
  getDerivedVariableMap(workspaceId: number, manager?: EntityManager): Promise<Map<string, Set<string>>>;
}
