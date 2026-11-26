import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

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

      const codingSchemeRefs = xmlDocument('CodingSchemeRef, codingSchemeRef')
        .map((_, element) => xmlDocument(element).text().trim())
        .get()
        .filter(Boolean);
      if (codingSchemeRefs.length > 0) {
        const normalizedRefs = codingSchemeRefs.map(ref => ref
          .toUpperCase()
          .replace(/\.VOCS$/i, '')
          .replace(/\.XML$/i, ''));
        result.codingSchemeRef = codingSchemeRefs[0].toUpperCase();
        result.codingSchemeRefNormalized = normalizedRefs[0];
        result.codingSchemeRefs = Array.from(new Set(normalizedRefs));
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

  identifyHtmlFile(filename: string, html: string) {
    const document = cheerio.load(html);
    const scripts = document('script[type="application/ld+json"]').toArray();
    const blocks = scripts.flatMap(element => {
      try {
        const parsed: unknown = JSON.parse(document(element).text());
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return [parsed as Record<string, unknown>];
        }
      } catch {
        // A malformed block does not invalidate the other metadata in the file.
      }
      return [];
    });

    const modules = blocks.map(metadata => this.identifyHtmlModule(metadata))
      .filter(module => module !== undefined);
    // Preserve single-block identification. In mixed documents prefer declared modules, then legacy untyped metadata.
    const selected = scripts.length === 1 ? modules[0] :
      modules.find(({ kind }) => kind === 'player' || kind === 'schemer') ??
      modules.find(({ kind }) => !kind);
    if (selected) {
      return {
        fileId: selected.fileId, fileType: selected.fileType, metadata: selected.metadata, usesFilename: false
      };
    }
    return {
      fileId: this.getResourceId(filename), fileType: 'Resource', metadata: blocks[0] ?? {}, usesFilename: true
    };
  }

  private identifyHtmlModule(metadata: Record<string, unknown>) {
    const type = metadata['@type'] ?? metadata.type;
    const kind = typeof type === 'string' ? type.toLowerCase() : type;

    const isSchemer = kind === 'schemer';
    const id = isSchemer ? metadata['@id'] ?? metadata.id : metadata.id || metadata['@id'];
    const { version } = metadata;
    const release = typeof version === 'string' || typeof version === 'number' ?
      /^(\d+(?:\.\d+){0,2})(?:[-+]\S+)?$/.exec(String(version)) : null;
    if (typeof id !== 'string' || !id.trim() || !release) return undefined;
    const fileId = this.normalizePlayerId(`${id}-${release[1]}`);
    return fileId ? {
      fileId, fileType: isSchemer ? 'Schemer' : 'Resource', metadata, kind
    } : undefined;
  }

  getResourceId(filename: string): string {
    if (!filename) {
      throw new Error('Invalid file: originalname is required.');
    }
    const filePathParts = decodeURIComponent(filename).split('/')
      .map(part => part.trim());
    const fileName = filePathParts.pop();
    if (!fileName) {
      throw new Error('Invalid file: Could not determine the file name.');
    }
    return fileName.toUpperCase();
  }

  private normalizePlayerId(name: string): string | undefined {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;

    const matches = name.match(reg);

    if (!matches) {
      return undefined;
    }

    const [, module = '', , major = '', minorDot = '', patchDot = ''] = matches;

    const majorVersion = parseInt(major, 10) || 0;
    const minorVersion = minorDot ? parseInt(minorDot.substring(1), 10) : 0;
    const patchVersion = patchDot ? parseInt(patchDot.substring(1), 10) : 0;
    // const label = labelWithDash ? labelWithDash.substring(1) : '';

    return `${module}-${majorVersion}.${minorVersion}.${patchVersion}`.toUpperCase();
  }
}
