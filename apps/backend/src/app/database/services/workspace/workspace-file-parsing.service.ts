import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { FileIo } from '../../../admin/workspace/file-io.interface';

@Injectable()
export class WorkspaceFileParsingService {
  private readonly logger = new Logger(WorkspaceFileParsingService.name);

  async extractUnitInfo(xmlDocument: cheerio.CheerioAPI): Promise<Record<string, unknown>> {
    try {
      const result: Record<string, unknown> = {};
      const metadata = xmlDocument('Metadata');
      if (metadata.length) {
        const metadataInfo: Record<string, string> = {};

        const id = metadata.find('Id');
        if (id.length) {
          metadataInfo.id = id.text().trim();
        }

        const label = metadata.find('Label');
        if (label.length) {
          metadataInfo.label = label.text().trim();
        }

        const description = metadata.find('Description');
        if (description.length) {
          metadataInfo.description = description.text().trim();
        }

        result.metadata = metadataInfo;
      }

      const baseVariables = xmlDocument('BaseVariables Variable');
      if (baseVariables.length) {
        const variables: Array<Record<string, unknown>> = [];

        baseVariables.each((index, element) => {
          const variable = xmlDocument(element);
          const variableInfo: Record<string, unknown> = {};

          const attrs = variable.attr();
          if (attrs) {
            variableInfo.id = attrs.id;
            variableInfo.alias = attrs.alias;
            variableInfo.type = attrs.type;
            variableInfo.format = attrs.format;
            variableInfo.multiple = attrs.multiple === 'true';
            variableInfo.nullable = attrs.nullable !== 'false';

            if (attrs.values) {
              variableInfo.values = attrs.values.split('|');
            }

            if (attrs.valuesComplete) {
              variableInfo.valuesComplete = attrs.valuesComplete === 'true';
            }

            if (attrs.page) {
              variableInfo.page = attrs.page;
            }
          }

          const alias = variable.text().trim();
          if (alias) {
            variableInfo.alias = alias;
          }

          variables.push(variableInfo);
        });

        result.variables = variables;
      }

      const definitions = xmlDocument('Definition');
      if (definitions.length) {
        const definitionsArray: Array<Record<string, string>> = [];

        definitions.each((index, element) => {
          const definition = xmlDocument(element);
          const definitionInfo: Record<string, string> = {};

          const attrs = definition.attr();
          if (attrs) {
            definitionInfo.id = attrs.id;
            definitionInfo.type = attrs.type;
          }

          definitionsArray.push(definitionInfo);
        });

        result.definitions = definitionsArray;
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error extracting Unit information: ${message}`);
      return {};
    }
  }

  async extractBookletInfo(xmlDocument: cheerio.CheerioAPI): Promise<Record<string, unknown>> {
    try {
      const result: Record<string, unknown> = {};
      const metadata = xmlDocument('Metadata');
      if (metadata.length) {
        const metadataInfo: Record<string, string> = {};
        const id = metadata.find('Id');
        if (id.length) {
          metadataInfo.id = id.text().trim();
        }
        const label = metadata.find('Label');
        if (label.length) {
          metadataInfo.label = label.text().trim();
        }
        const description = metadata.find('Description');
        if (description.length) {
          metadataInfo.description = description.text().trim();
        }

        result.metadata = metadataInfo;
      }

      const units = xmlDocument('Units Unit');
      if (units.length) {
        const unitsArray: Array<Record<string, string>> = [];

        units.each((index, element) => {
          const unit = xmlDocument(element);
          const unitInfo: Record<string, string> = {};

          const attrs = unit.attr();
          if (attrs) {
            unitInfo.id = attrs.id;
            unitInfo.label = attrs.label;
            unitInfo.labelShort = attrs.labelshort;
          }

          unitsArray.push(unitInfo);
        });

        result.units = unitsArray;
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error extracting Booklet information: ${message}`);
      return {};
    }
  }

  async extractTestTakersInfo(xmlDocument: cheerio.CheerioAPI): Promise<Record<string, unknown>> {
    try {
      const result: Record<string, unknown> = {};

      const testTakers = xmlDocument('Testtaker');
      if (testTakers.length) {
        const testTakersArray: Array<Record<string, unknown>> = [];

        testTakers.each((index, element) => {
          const testTaker = xmlDocument(element);
          const testTakerInfo: Record<string, unknown> = {};

          const attrs = testTaker.attr();
          if (attrs) {
            testTakerInfo.id = attrs.id;
            testTakerInfo.login = attrs.login;
            testTakerInfo.code = attrs.code;
          }

          const booklets = testTaker.find('Booklet');
          if (booklets.length) {
            const bookletsArray: string[] = [];

            booklets.each((bookletIndex, bookletElement) => {
              const booklet = xmlDocument(bookletElement);
              bookletsArray.push(booklet.text().trim());
            });

            testTakerInfo.booklets = bookletsArray;
          }

          testTakersArray.push(testTakerInfo);
        });

        result.testTakers = testTakersArray;
      }

      const groups = xmlDocument('Group');
      if (groups.length) {
        const groupsArray: Array<Record<string, unknown>> = [];

        groups.each((groupIndex, element) => {
          const group = xmlDocument(element);
          const groupInfo: Record<string, unknown> = {};

          const attrs = group.attr();
          if (attrs) {
            groupInfo.id = attrs.id;
            groupInfo.label = attrs.label;
          }

          const members = group.find('Member');
          if (members.length) {
            const membersArray: string[] = [];

            members.each((memberIndex, memberElement) => {
              const member = xmlDocument(memberElement);
              membersArray.push(member.text().trim());
            });

            groupInfo.members = membersArray;
          }

          groupsArray.push(groupInfo);
        });

        result.groups = groupsArray;
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error extracting TestTakers information: ${message}`);
      return {};
    }
  }

  getPlayerId(file: FileIo): string {
    try {
      const playerCode = file.buffer.toString();
      const playerContent = cheerio.load(playerCode);
      const metaDataElement = playerContent('script[type="application/ld+json"]');
      const metadata = JSON.parse(metaDataElement.text());
      const id = metadata.id || metadata['@id'];
      const version = metadata.version;

      if (!id || !version) {
        return this.getResourceId(file);
      }

      return this.normalizePlayerId(`${id}-${version}`);
    } catch (error) {
      return this.getResourceId(file);
    }
  }

  getSchemerId(file: FileIo): string {
    try {
      const schemerCode = file.buffer.toString();
      const schemerContent = cheerio.load(schemerCode);
      const metaDataElement = schemerContent('script[type="application/ld+json"]');
      const metadata = JSON.parse(metaDataElement.text());
      return this.normalizePlayerId(`${metadata['@id']}-${metadata.version}`);
    } catch (error) {
      return this.getResourceId(file);
    }
  }

  getResourceId(file: FileIo): string {
    if (!file?.originalname) {
      throw new Error('Invalid file: originalname is required.');
    }
    const filePathParts = decodeURIComponent(file.originalname).split('/')
      .map(part => part.trim());
    const fileName = filePathParts.pop();
    if (!fileName) {
      throw new Error('Invalid file: Could not determine the file name.');
    }
    return fileName.toUpperCase();
  }

  normalizePlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;

    const matches = name.match(reg);

    if (!matches) {
      throw new Error(`Invalid player name: ${name}`);
    }

    const [, module = '', , major = '', minorDot = '', patchDot = ''] = matches;

    const majorVersion = parseInt(major, 10) || 0;
    const minorVersion = minorDot ? parseInt(minorDot.substring(1), 10) : 0;
    const patchVersion = patchDot ? parseInt(patchDot.substring(1), 10) : 0;
    // const label = labelWithDash ? labelWithDash.substring(1) : '';

    return `${module}-${majorVersion}.${minorVersion}.${patchVersion}`.toUpperCase();
  }
}
