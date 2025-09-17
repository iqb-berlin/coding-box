import { UnitMetadataDto } from './unit-metadata.dto';
import { UnitDefinitionDto } from './unit-definition.dto';
import { UnitVariableDto } from './unit-variable.dto';
import { UnitCodingSchemeRefDto } from './unit-coding-scheme-ref.dto';
import { UnitDependencyDto } from './unit-dependency.dto';

/**
 * Data transfer object for unit information
 * Based on the unit.xsd schema
 */
export class UnitInfoDto {
  metadata!: UnitMetadataDto;
  definition!: UnitDefinitionDto;
  codingSchemeRef?: UnitCodingSchemeRefDto;
  dependencies?: UnitDependencyDto[];
  baseVariables?: UnitVariableDto[];
  derivedVariables?: UnitVariableDto[];
  rawXml!: string;
}
