/**
 * Data transfer object for unit metadata
 * Based on the Metadata element in unit.xsd schema
 */
export class UnitMetadataDto {
  id!: string;
  label!: string;
  description?: string;
  transcript?: string;
  reference?: string;
  lastChange?: Date;
}
