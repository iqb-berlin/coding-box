/**
 * Data transfer object for unit definition
 * Based on the Definition/DefinitionRef element in unit.xsd schema
 */
export class UnitDefinitionDto {
  type!: 'Definition' | 'DefinitionRef';
  player!: string;
  editor?: string;
  content!: string;
  lastChange?: Date;
}
