import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as xml2js from 'xml2js';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { BookletMetadataDto } from '../../../../../../../api-dto/booklet-info/booklet-metadata.dto';
import { BookletUnitDto } from '../../../../../../../api-dto/booklet-info/booklet-unit.dto';
import { BookletRestrictionDto } from '../../../../../../../api-dto/booklet-info/booklet-restriction.dto';
import { BookletConfigDto } from '../../../../../../../api-dto/booklet-info/booklet-config.dto';
import { BookletConfigItemDto } from '../../../../../../../api-dto/booklet-info/booklet-config-item.dto';
import { BookletTestletDto } from '../../../../../../../api-dto/booklet-info/booklet-testlet.dto';
import FileUpload from '../../entities/file_upload.entity';

@Injectable()
export class BookletInfoService {
  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>
  ) {}

  /**
   * Get booklet info from XML
   * @param workspaceId Workspace ID
   * @param bookletId Booklet ID
   * @returns BookletInfoDto
   */
  async getBookletInfo(workspaceId: number, bookletId: string): Promise<BookletInfoDto> {
    // Fetch the booklet XML from the fileUpload database table
    const bookletFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_id: bookletId
      }
    });

    if (!bookletFile) {
      throw new Error(`Booklet with ID ${bookletId} not found in workspace ${workspaceId}`);
    }

    // Parse the XML
    const bookletXml = bookletFile.data;
    const bookletInfo = await this.parseBookletXml(bookletXml);
    return bookletInfo;
  }

  /**
   * Parse booklet XML according to booklet.xsd schema
   * @param bookletXml Booklet XML
   * @returns BookletInfoDto
   */
  private async parseBookletXml(bookletXml: string): Promise<BookletInfoDto> {
    // Configure parser to handle arrays properly and preserve attributes
    const parser = new xml2js.Parser({
      explicitArray: true, // Always return arrays for elements that can occur multiple times
      mergeAttrs: false, // Don't merge attributes into the element
      attrkey: '$', // Use $ for attributes
      charkey: '_' // Use _ for element text content
    });

    try {
      if (!bookletXml || typeof bookletXml !== 'string') {
        throw new Error('Invalid booklet XML: XML data is empty or not a string');
      }

      const result = await parser.parseStringPromise(bookletXml);

      // Validate that the parsed result has the expected structure
      if (!result || !result.Booklet) {
        throw new Error('Invalid booklet XML: Missing Booklet element');
      }

      // Validate and extract booklet metadata (required by schema)
      if (!result.Booklet.Metadata || !result.Booklet.Metadata.length) {
        throw new Error('Invalid booklet XML: Missing Metadata element');
      }

      const metadataElement = result.Booklet.Metadata[0] as Record<string, unknown>;

      // Check for required metadata fields
      if (!metadataElement.Id || !Array.isArray(metadataElement.Id) || metadataElement.Id.length === 0) {
        throw new Error('Invalid booklet XML: Missing required Id in Metadata');
      }

      if (!metadataElement.Label || !Array.isArray(metadataElement.Label) || metadataElement.Label.length === 0) {
        throw new Error('Invalid booklet XML: Missing required Label in Metadata');
      }

      const metadata: BookletMetadataDto = {
        id: metadataElement.Id[0] as string || '',
        label: metadataElement.Label[0] as string || '',
        description: metadataElement.Description && Array.isArray(metadataElement.Description) ?
          metadataElement.Description[0] as string : undefined
      };

      // Extract BookletConfig if present
      let config: BookletConfigDto | undefined;
      if (result.Booklet.BookletConfig &&
          Array.isArray(result.Booklet.BookletConfig) &&
          result.Booklet.BookletConfig.length > 0) {
        const configElement = result.Booklet.BookletConfig[0] as Record<string, unknown>;

        if (configElement.Config && Array.isArray(configElement.Config) && configElement.Config.length > 0) {
          const configItems: BookletConfigItemDto[] = [];

          configElement.Config.forEach((configItem: Record<string, unknown>) => {
            if (configItem.$ && typeof configItem.$ === 'object') {
              const configAttrs = configItem.$ as Record<string, string>;
              const key = configAttrs.key || '';

              // Get the value (content of the Config element)
              let value = '';
              if (typeof configItem === 'string') {
                value = configItem;
              } else if (configItem._ && typeof configItem._ === 'string') {
                value = configItem._ as string;
              }

              if (key && value) {
                configItems.push({ key, value });
              }
            }
          });

          if (configItems.length > 0) {
            config = { items: configItems };
          }
        }
      }

      // Validate and extract units (required by schema)
      if (!result.Booklet.Units || !Array.isArray(result.Booklet.Units) || result.Booklet.Units.length === 0) {
        throw new Error('Invalid booklet XML: Missing Units element');
      }

      // Extract units and testlets recursively
      const units: BookletUnitDto[] = [];
      const testlets: BookletTestletDto[] = [];
      const position = 1; // Track position for ordering

      // Process Units element
      const unitsElement = result.Booklet.Units[0] as Record<string, unknown>;
      this.processUnitsAndTestlets(unitsElement, units, position, testlets);

      // If no units were found, the XML might be invalid
      if (units.length === 0) {
        // No units found in booklet XML
      }

      // Extract restrictions from Units.Restrictions
      const restrictions: BookletRestrictionDto[] = [];
      this.extractRestrictionsFromElement(unitsElement, restrictions);

      // Build the response object
      const response: BookletInfoDto = {
        metadata,
        units,
        restrictions,
        rawXml: bookletXml // Include the raw XML in the response
      };

      // Add optional properties if they exist
      if (config) {
        response.config = config;
      }

      if (testlets.length > 0) {
        response.testlets = testlets;
      }

      return response;
    } catch (error) {
      // Error occurred while parsing booklet XML
      if (error instanceof Error) {
        throw new Error(`Failed to parse booklet XML: ${error.message}`);
      } else {
        throw new Error('Failed to parse booklet XML: Unknown error');
      }
    }
  }

  /**
   * Process Units and Testlets recursively to extract all units
   * @param element The Units or Testlet element to process
   * @param units Array to collect all units
   * @param position Starting position for units
   * @param testlets Optional array to collect testlet information
   * @returns The next position to use
   */
  private processUnitsAndTestlets(
    element: Record<string, unknown>,
    units: BookletUnitDto[],
    position: number,
    testlets?: BookletTestletDto[]
  ): number {
    let currentPosition = position;

    // Process direct Unit children
    if (element.Unit && Array.isArray(element.Unit)) {
      element.Unit.forEach((unit: Record<string, unknown>) => {
        if (unit.$ && typeof unit.$ === 'object') {
          const unitAttrs = unit.$ as Record<string, string>;
          units.push({
            id: unitAttrs.id || '',
            label: unitAttrs.label || '',
            alias: unitAttrs.alias || unitAttrs.id || '',
            position: currentPosition
          });
          currentPosition += 1;
        }
      });
    }

    // Process Testlet children and collect testlet information
    if (element.Testlet && Array.isArray(element.Testlet)) {
      element.Testlet.forEach((testlet: Record<string, unknown>) => {
        if (testlet.$ && typeof testlet.$ === 'object') {
          const testletAttrs = testlet.$ as Record<string, string>;

          // If we're collecting testlet information
          if (testlets && Array.isArray(testlets)) {
            const testletUnits: BookletUnitDto[] = [];
            const testletRestrictions: BookletRestrictionDto[] = [];

            // Extract restrictions from testlet
            this.extractRestrictionsFromElement(testlet, testletRestrictions);

            // Process units within this testlet
            const nextPosition = this.processUnitsAndTestlets(testlet, testletUnits, currentPosition);

            // Add testlet to the collection
            testlets.push({
              id: testletAttrs.id || '',
              label: testletAttrs.label || '',
              units: testletUnits,
              restrictions: testletRestrictions.length > 0 ? testletRestrictions : undefined
            });

            currentPosition = nextPosition;
          } else {
            // If we're not collecting testlet info, just process units
            currentPosition = this.processUnitsAndTestlets(testlet, units, currentPosition);
          }
        }
      });
    }

    return currentPosition;
  }

  /**
   * Extract restrictions from an element
   * @param element The element to extract restrictions from
   * @param restrictions Array to collect restrictions
   */
  private extractRestrictionsFromElement(
    element: Record<string, unknown>,
    restrictions: BookletRestrictionDto[]
  ): void {
    if (!element.Restrictions || !Array.isArray(element.Restrictions) || element.Restrictions.length === 0) {
      return;
    }

    const restrictionsElement = element.Restrictions[0] as Record<string, unknown>;

    // Extract TimeMax restriction
    if (restrictionsElement.TimeMax && Array.isArray(restrictionsElement.TimeMax) && restrictionsElement.TimeMax.length > 0) {
      const timeMax = restrictionsElement.TimeMax[0] as Record<string, unknown>;
      let timeMaxValue = '';

      // Handle TimeMax with minutes attribute
      if (timeMax.$ && typeof timeMax.$ === 'object') {
        const timeMaxAttrs = timeMax.$ as Record<string, string>;
        if (timeMaxAttrs.minutes) {
          timeMaxValue = timeMaxAttrs.minutes;

          // Include leave attribute if present
          if (timeMaxAttrs.leave) {
            timeMaxValue += ` (leave: ${timeMaxAttrs.leave})`;
          }
        }
      } else if (typeof timeMax === 'string' || (timeMax._ && typeof timeMax._ === 'string')) {
        // Handle TimeMax as string value
        timeMaxValue = (timeMax._ as string) || timeMax as unknown as string;
      }

      if (timeMaxValue) {
        restrictions.push({
          type: 'timeMax',
          value: timeMaxValue
        });
      }
    }

    // Extract CodeToEnter restriction
    if (restrictionsElement.CodeToEnter && Array.isArray(restrictionsElement.CodeToEnter) && restrictionsElement.CodeToEnter.length > 0) {
      const codeToEnter = restrictionsElement.CodeToEnter[0] as Record<string, unknown>;
      let codeValue = '';
      let promptText = '';

      if (codeToEnter.$ && typeof codeToEnter.$ === 'object') {
        const codeAttrs = codeToEnter.$ as Record<string, string>;
        if (codeAttrs.code) {
          codeValue = codeAttrs.code;
        }
      }

      // Get the prompt text (content of the CodeToEnter element)
      if (typeof codeToEnter === 'string') {
        promptText = codeToEnter;
      } else if (codeToEnter._ && typeof codeToEnter._ === 'string') {
        promptText = codeToEnter._ as string;
      }

      if (codeValue) {
        restrictions.push({
          type: 'codeToEnter',
          value: codeValue + (promptText ? ` (${promptText})` : '')
        });
      }
    }

    // Extract DenyNavigationOnIncomplete restriction
    if (restrictionsElement.DenyNavigationOnIncomplete &&
        Array.isArray(restrictionsElement.DenyNavigationOnIncomplete) &&
        restrictionsElement.DenyNavigationOnIncomplete.length > 0) {
      const denyNav = restrictionsElement.DenyNavigationOnIncomplete[0] as Record<string, unknown>;
      let denyNavValue = '';

      if (denyNav.$ && typeof denyNav.$ === 'object') {
        const denyNavAttrs = denyNav.$ as Record<string, string>;
        if (denyNavAttrs.presentation || denyNavAttrs.response) {
          denyNavValue = `presentation:${denyNavAttrs.presentation || 'OFF'},response:${denyNavAttrs.response || 'OFF'}`;
        }
      } else if (typeof denyNav === 'string' || (denyNav._ && typeof denyNav._ === 'string')) {
        denyNavValue = (denyNav._ as string) || denyNav as unknown as string;
      }

      if (denyNavValue) {
        restrictions.push({
          type: 'denyNavigationOnIncomplete',
          value: denyNavValue
        });
      }
    }
  }
}
