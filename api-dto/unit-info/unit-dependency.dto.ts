/**
 * Data transfer object for a unit dependency
 * Based on the Dependency element in unit.xsd schema
 */
export class UnitDependencyDto {
  type!: 'File' | 'Service';
  content!: string;
  for!: 'player' | 'editor' | 'schemer' | 'coder';
}
