export interface JobDefinitionIdentity {
  id?: number | null;
  name?: string | null;
}

export function getJobDefinitionDisplayLabel(
  definition: JobDefinitionIdentity
): string {
  const name = definition.name?.trim();
  const hasId = typeof definition.id === 'number' && Number.isFinite(definition.id);

  if (name && hasId) {
    if (name === `Definition #${definition.id}`) {
      return name;
    }
    return `${name} (#${definition.id})`;
  }

  if (name) {
    return name;
  }

  if (hasId) {
    return `Definition #${definition.id}`;
  }

  return 'Jobdefinition';
}
