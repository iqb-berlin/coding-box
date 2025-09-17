/**
 * Data transfer object for a coding scheme reference
 * Based on the CodingSchemeRef element in unit.xsd schema
 */
export class UnitCodingSchemeRefDto {
  content!: string;
  schemer!: string;
  schemeType?: string;
  lastChange?: Date;
}
