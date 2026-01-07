import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as xml2js from 'xml2js';
import { UnitInfoDto } from '../../../../../../api-dto/unit-info/unit-info.dto';
import { UnitMetadataDto } from '../../../../../../api-dto/unit-info/unit-metadata.dto';
import { UnitDefinitionDto } from '../../../../../../api-dto/unit-info/unit-definition.dto';
import { UnitVariableDto } from '../../../../../../api-dto/unit-info/unit-variable.dto';
import { UnitVariableValueDto } from '../../../../../../api-dto/unit-info/unit-variable-value.dto';
import { UnitCodingSchemeRefDto } from '../../../../../../api-dto/unit-info/unit-coding-scheme-ref.dto';
import { UnitDependencyDto } from '../../../../../../api-dto/unit-info/unit-dependency.dto';
import { FileUpload } from '../../common';

// XML element interfaces for parsing
interface XmlAttributes {
  [key: string]: string;
}

interface XmlElement {
  $?: XmlAttributes;
  _?: string; // Element text content
}

interface MetadataElement extends XmlElement {
  Id?: string[];
  Label?: string[];
  Description?: string[];
  Transcript?: string[];
  Reference?: string[];
  Lastchange?: string[];
}

interface DefinitionElement extends XmlElement {
  // $ contains player, editor, lastChange attributes
}

interface CodingSchemeRefElement extends XmlElement {
  // $ contains schemer, schemeType, lastChange attributes
}

interface DependencyElement extends XmlElement {
  // $ contains for attribute
}

interface DependenciesElement extends XmlElement {
  File?: DependencyElement[];
  file?: DependencyElement[]; // Deprecated lowercase version
  Service?: DependencyElement[];
}

interface ValueElement extends XmlElement {
  label?: string[];
  value?: string[];
}

interface ValuesElement extends XmlElement {
  Value?: ValueElement[];
}

interface ValuePositionLabelsElement extends XmlElement {
  ValuePositionLabel?: string[];
}

interface VariableElement extends XmlElement {
  // $ contains id, alias, type, format, multiple, nullable, page attributes
  Values?: ValuesElement[];
  ValuePositionLabels?: ValuePositionLabelsElement[];
}

interface BaseVariablesElement extends XmlElement {
  Variable?: VariableElement[];
}

interface DerivedVariablesElement extends XmlElement {
  Variable?: VariableElement[];
}

interface UnitElement extends XmlElement {
  Metadata?: MetadataElement[];
  Definition?: DefinitionElement[];
  DefinitionRef?: DefinitionElement[];
  CodingSchemeRef?: CodingSchemeRefElement[];
  Dependencies?: DependenciesElement[];
  BaseVariables?: BaseVariablesElement[];
  DerivedVariables?: DerivedVariablesElement[];
}

@Injectable()
export class UnitInfoService {
  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>
  ) {}

  async getUnitInfo(workspaceId: number, unitId: string): Promise<UnitInfoDto> {
    const unitFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_id: unitId
      }
    });

    if (!unitFile) {
      throw new Error(`Unit with ID ${unitId} not found in workspace ${workspaceId}`);
    }

    const unitXml = unitFile.data;
    return this.parseUnitXml(unitXml);
  }

  /**
   * Validate unit XML structure
   * @param result Parsed XML result
   */
  private validateUnitStructure(result: { Unit: UnitElement }): void {
    if (!result || !result.Unit) {
      throw new Error('Invalid unit XML: Missing Unit element');
    }

    if (!result.Unit.Metadata || !result.Unit.Metadata.length) {
      throw new Error('Invalid unit XML: Missing Metadata element');
    }

    const metadataElement = result.Unit.Metadata[0];

    if (!metadataElement.Id || !Array.isArray(metadataElement.Id) || metadataElement.Id.length === 0) {
      throw new Error('Invalid unit XML: Missing required Id in Metadata');
    }

    if (!metadataElement.Label || !Array.isArray(metadataElement.Label) || metadataElement.Label.length === 0) {
      throw new Error('Invalid unit XML: Missing required Label in Metadata');
    }

    // Validate definition (required by schema)
    if (!result.Unit.Definition && !result.Unit.DefinitionRef) {
      throw new Error('Invalid unit XML: Missing Definition or DefinitionRef element');
    }
  }

  /**
   * Validate definition element
   * @param element Definition or DefinitionRef element
   * @param elementType Type of element ('Definition' or 'DefinitionRef')
   */
  private validateDefinitionElement(element: XmlElement, elementType: string): void {
    if (!element.$ || !element.$.player) {
      throw new Error(`Invalid unit XML: Missing required player attribute in ${elementType}`);
    }
  }

  /**
   * Validate coding scheme reference element
   * @param element CodingSchemeRef element
   */
  private validateCodingSchemeElement(element: XmlElement): void {
    // For legacy/external units we treat the schemer attribute as optional.
    // Only enforce that the element at least has an attributes object.
    if (!element.$) {
      throw new Error('Invalid unit XML: CodingSchemeRef element has no attributes');
    }
  }

  private async parseUnitXml(unitXml: string): Promise<UnitInfoDto> {
    // Validate input before parsing
    if (!unitXml || typeof unitXml !== 'string') {
      throw new Error('Invalid unit XML: XML data is empty or not a string');
    }

    const parser = new xml2js.Parser({
      explicitArray: true, // Always return arrays for elements that can occur multiple times
      mergeAttrs: false, // Don't merge attributes into the element
      attrkey: '$', // Use $ for attributes
      charkey: '_' // Use _ for element text content
    });

    try {
      const result = await parser.parseStringPromise(unitXml) as { Unit: UnitElement };

      // Validate parsed result outside the try block
      this.validateUnitStructure(result);

      const metadataElement = result.Unit.Metadata[0];

      // Extract metadata
      const metadata: UnitMetadataDto = {
        id: metadataElement.Id[0] as string || '',
        label: metadataElement.Label[0] as string || '',
        description: metadataElement.Description && Array.isArray(metadataElement.Description) ?
          metadataElement.Description[0] as string : undefined,
        transcript: metadataElement.Transcript && Array.isArray(metadataElement.Transcript) ?
          metadataElement.Transcript[0] as string : undefined,
        reference: metadataElement.Reference && Array.isArray(metadataElement.Reference) ?
          metadataElement.Reference[0] as string : undefined
      };

      // Extract lastChange from metadata attributes if present
      if (metadataElement.$ && metadataElement.$.lastChange) {
        metadata.lastChange = new Date(metadataElement.$.lastChange as string);
      } else if (metadataElement.Lastchange && Array.isArray(metadataElement.Lastchange) && metadataElement.Lastchange.length > 0) {
        // Handle deprecated Lastchange element
        metadata.lastChange = new Date(metadataElement.Lastchange[0] as string);
      }

      // Definition validation is now handled in validateUnitStructure

      let definition: UnitDefinitionDto;
      if (result.Unit.Definition && Array.isArray(result.Unit.Definition) && result.Unit.Definition.length > 0) {
        const definitionElement = result.Unit.Definition[0];
        // Validation moved to validateDefinitionElement method
        this.validateDefinitionElement(definitionElement, 'Definition');

        definition = {
          type: 'Definition',
          player: definitionElement.$.player as string,
          editor: definitionElement.$.editor as string,
          content: definitionElement._ as string || ''
        };

        if (definitionElement.$.lastChange) {
          definition.lastChange = new Date(definitionElement.$.lastChange as string);
        }
      } else if (result.Unit.DefinitionRef && Array.isArray(result.Unit.DefinitionRef) && result.Unit.DefinitionRef.length > 0) {
        const definitionRefElement = result.Unit.DefinitionRef[0];
        // Validation moved to validateDefinitionElement method
        this.validateDefinitionElement(definitionRefElement, 'DefinitionRef');

        definition = {
          type: 'DefinitionRef',
          player: definitionRefElement.$.player as string,
          editor: definitionRefElement.$.editor as string,
          content: definitionRefElement._ as string || ''
        };

        if (definitionRefElement.$.lastChange) {
          definition.lastChange = new Date(definitionRefElement.$.lastChange as string);
        }
      }

      let codingSchemeRef: UnitCodingSchemeRefDto | undefined;
      if (result.Unit.CodingSchemeRef && Array.isArray(result.Unit.CodingSchemeRef) && result.Unit.CodingSchemeRef.length > 0) {
        const codingSchemeRefElement = result.Unit.CodingSchemeRef[0];
        // Validation moved to validateCodingSchemeElement method
        this.validateCodingSchemeElement(codingSchemeRefElement);

        codingSchemeRef = {
          content: codingSchemeRefElement._ as string || '',
          schemer: codingSchemeRefElement.$?.schemer as string,
          schemeType: codingSchemeRefElement.$?.schemeType as string
        };

        if (codingSchemeRefElement.$.lastChange) {
          codingSchemeRef.lastChange = new Date(codingSchemeRefElement.$.lastChange as string);
        }
      }

      // Extract dependencies (optional)
      const dependencies: UnitDependencyDto[] = [];
      if (result.Unit.Dependencies && Array.isArray(result.Unit.Dependencies) && result.Unit.Dependencies.length > 0) {
        const dependenciesElement = result.Unit.Dependencies[0] as DependenciesElement;

        // Process File dependencies
        if (dependenciesElement.File && Array.isArray(dependenciesElement.File)) {
          dependenciesElement.File.forEach((fileElement: DependencyElement) => {
            const dependency: UnitDependencyDto = {
              type: 'File',
              content: fileElement._ as string || '',
              for: (fileElement.$ && fileElement.$.for) ?
                (fileElement.$.for as 'player' | 'editor' | 'schemer' | 'coder') : 'player'
            };
            dependencies.push(dependency);
          });
        }

        // Process deprecated 'file' dependencies (lowercase)
        if (dependenciesElement.file && Array.isArray(dependenciesElement.file)) {
          dependenciesElement.file.forEach((fileElement: DependencyElement) => {
            const dependency: UnitDependencyDto = {
              type: 'File',
              content: fileElement._ as string || '',
              for: (fileElement.$ && fileElement.$.for) ?
                (fileElement.$.for as 'player' | 'editor' | 'schemer' | 'coder') : 'player'
            };
            dependencies.push(dependency);
          });
        }

        // Process Service dependencies
        if (dependenciesElement.Service && Array.isArray(dependenciesElement.Service)) {
          dependenciesElement.Service.forEach((serviceElement: DependencyElement) => {
            const dependency: UnitDependencyDto = {
              type: 'Service',
              content: serviceElement._ as string || '',
              for: (serviceElement.$ && serviceElement.$.for) ?
                (serviceElement.$.for as 'player' | 'editor' | 'schemer' | 'coder') : 'player'
            };
            dependencies.push(dependency);
          });
        }
      }

      // Extract base variables (optional)
      const baseVariables: UnitVariableDto[] = [];
      if (result.Unit.BaseVariables && Array.isArray(result.Unit.BaseVariables) && result.Unit.BaseVariables.length > 0) {
        const baseVariablesElement = result.Unit.BaseVariables[0] as BaseVariablesElement;
        if (baseVariablesElement.Variable && Array.isArray(baseVariablesElement.Variable)) {
          baseVariablesElement.Variable.forEach((variableElement: VariableElement) => {
            if (!variableElement.$ || !variableElement.$.id || !variableElement.$.type) {
              return; // Skip invalid variables
            }

            const variable: UnitVariableDto = {
              id: variableElement.$.id as string,
              alias: variableElement.$.alias as string,
              type: variableElement.$.type as 'string' | 'integer' | 'number' | 'boolean' | 'attachment' | 'json' | 'no-value',
              format: variableElement.$.format as string,
              multiple: variableElement.$.multiple === 'true',
              nullable: variableElement.$.nullable === 'true',
              page: variableElement.$.page as string
            };

            // Extract values
            if (variableElement.Values && Array.isArray(variableElement.Values) && variableElement.Values.length > 0) {
              const valuesElement = variableElement.Values[0] as ValuesElement;
              variable.valuesComplete = valuesElement.$ && valuesElement.$.complete === 'true';

              if (valuesElement.Value && Array.isArray(valuesElement.Value)) {
                variable.values = [];
                valuesElement.Value.forEach((valueElement: ValueElement) => {
                  if (!valueElement.label || !valueElement.value ||
                      !Array.isArray(valueElement.label) || !Array.isArray(valueElement.value)) {
                    return; // Skip invalid values
                  }

                  const value: UnitVariableValueDto = {
                    label: valueElement.label[0] as string || '',
                    value: valueElement.value[0] as string || ''
                  };
                  variable.values.push(value);
                });
              }
            }

            // Extract value position labels
            if (variableElement.ValuePositionLabels && Array.isArray(variableElement.ValuePositionLabels) &&
                variableElement.ValuePositionLabels.length > 0) {
              const valuePositionLabelsElement = variableElement.ValuePositionLabels[0] as ValuePositionLabelsElement;
              if (valuePositionLabelsElement.ValuePositionLabel &&
                  Array.isArray(valuePositionLabelsElement.ValuePositionLabel)) {
                variable.valuePositionLabels = valuePositionLabelsElement.ValuePositionLabel.map(
                  (label: unknown) => label as string
                );
              }
            }

            baseVariables.push(variable);
          });
        }
      }

      // Extract derived variables (optional)
      const derivedVariables: UnitVariableDto[] = [];
      if (result.Unit.DerivedVariables && Array.isArray(result.Unit.DerivedVariables) && result.Unit.DerivedVariables.length > 0) {
        const derivedVariablesElement = result.Unit.DerivedVariables[0] as DerivedVariablesElement;
        if (derivedVariablesElement.Variable && Array.isArray(derivedVariablesElement.Variable)) {
          derivedVariablesElement.Variable.forEach((variableElement: VariableElement) => {
            if (!variableElement.$ || !variableElement.$.id || !variableElement.$.type) {
              return; // Skip invalid variables
            }

            const variable: UnitVariableDto = {
              id: variableElement.$.id as string,
              alias: variableElement.$.alias as string,
              type: variableElement.$.type as 'string' | 'integer' | 'number' | 'boolean' | 'attachment' | 'json' | 'no-value',
              format: variableElement.$.format as string,
              multiple: variableElement.$.multiple === 'true',
              nullable: variableElement.$.nullable === 'true',
              page: variableElement.$.page as string
            };

            // Extract values
            if (variableElement.Values && Array.isArray(variableElement.Values) && variableElement.Values.length > 0) {
              const valuesElement = variableElement.Values[0] as ValuesElement;
              variable.valuesComplete = valuesElement.$ && valuesElement.$.complete === 'true';

              if (valuesElement.Value && Array.isArray(valuesElement.Value)) {
                variable.values = [];
                valuesElement.Value.forEach((valueElement: ValueElement) => {
                  if (!valueElement.label || !valueElement.value ||
                      !Array.isArray(valueElement.label) || !Array.isArray(valueElement.value)) {
                    return; // Skip invalid values
                  }

                  const value: UnitVariableValueDto = {
                    label: valueElement.label[0] as string || '',
                    value: valueElement.value[0] as string || ''
                  };
                  variable.values.push(value);
                });
              }
            }

            // Extract value position labels
            if (variableElement.ValuePositionLabels && Array.isArray(variableElement.ValuePositionLabels) &&
                variableElement.ValuePositionLabels.length > 0) {
              const valuePositionLabelsElement = variableElement.ValuePositionLabels[0] as ValuePositionLabelsElement;
              if (valuePositionLabelsElement.ValuePositionLabel &&
                  Array.isArray(valuePositionLabelsElement.ValuePositionLabel)) {
                variable.valuePositionLabels = valuePositionLabelsElement.ValuePositionLabel.map(
                  (label: unknown) => label as string
                );
              }
            }

            derivedVariables.push(variable);
          });
        }
      }

      // Build the response object
      const response: UnitInfoDto = {
        metadata,
        definition,
        rawXml: unitXml
      };

      // Add optional properties if they exist
      if (codingSchemeRef) {
        response.codingSchemeRef = codingSchemeRef;
      }

      if (dependencies.length > 0) {
        response.dependencies = dependencies;
      }

      if (baseVariables.length > 0) {
        response.baseVariables = baseVariables;
      }

      if (derivedVariables.length > 0) {
        response.derivedVariables = derivedVariables;
      }

      return response;
    } catch (error) {
      // Error will be thrown and can be handled by the caller
      if (error instanceof Error) {
        throw new Error(`Failed to parse unit XML: ${error.message}`);
      } else {
        throw new Error('Failed to parse unit XML: Unknown error');
      }
    }
  }
}
