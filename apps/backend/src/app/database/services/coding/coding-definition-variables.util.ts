import { In, Repository } from 'typeorm';
import { JobDefinition, JobDefinitionVariable } from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';

/** Fetch shared bundles once per overview, scoped to the owning workspace. */
export async function loadDefinitionBundles(
  repository: Repository<VariableBundle>, definitions: JobDefinition[], workspaceId: number
): Promise<Map<number, VariableBundle>> {
  const ids = [...new Set(definitions.flatMap(
    definition => (definition.assigned_variable_bundles || []).map(bundle => bundle.id)
  ))];
  const bundles = ids.length > 0 ? await repository.find({
    where: { id: In(ids), workspace_id: workspaceId }
  }) : [];
  return new Map(bundles.map(bundle => [bundle.id, bundle]));
}

export function getDefinitionVariables(
  definition: JobDefinition, bundles: Map<number, VariableBundle>
): JobDefinitionVariable[] {
  return [
    ...(definition.assigned_variables || []),
    ...(definition.assigned_variable_bundles || []).flatMap(bundle => bundles.get(bundle.id)?.variables || [])
  ];
}
