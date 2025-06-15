import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {

  Repository
} from 'typeorm';
import Ajv, { JSONSchemaType } from 'ajv';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as fs from 'fs';
import * as path from 'path';
import * as libxmljs from 'libxmljs2';
import Workspace from '../entities/workspace.entity';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
import FileUpload from '../entities/file_upload.entity';
import WorkspaceUser from '../entities/workspace_user.entity';
import { FileIo } from '../../admin/workspace/file-io.interface';
import User from '../entities/user.entity';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';

function sanitizePath(filePath: string): string {
  const normalizedPath = path.normalize(filePath); // System-basiertes Normalisieren
  if (normalizedPath.startsWith('..')) {
    throw new Error('Invalid file path: Path cannot navigate outside root.');
  }
  return normalizedPath.replace(/\\/g, '/'); // Einheitliche Darstellung für Pfade
}

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @InjectRepository(Workspace)
    private workspaceRepository: Repository<Workspace>,
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(WorkspaceUser)
    private workspaceUsersRepository:Repository<WorkspaceUser>,
    @InjectRepository(User)
    private usersRepository:Repository<User>
  ) {
  }

  async findAllUserWorkspaces(identity: string): Promise<WorkspaceFullDto[]> {
    this.logger.log('Returning all workspaces for user', identity);
    const user = await this.usersRepository.findOne({ where: { identity: identity } });
    const workspaces = await this.workspaceUsersRepository.find({
      where: { userId: user.id }
    });
    if (workspaces.length > 0) {
      const mappedWorkspaces = workspaces.map(workspace => ({ id: workspace.workspaceId }));
      return this.workspaceRepository.find({ where: mappedWorkspaces });
    }
    return [];
  }

  handleFile(workspaceId: number, file: FileIo): Array<Promise<unknown>> {
    const filePromises: Array<Promise<unknown>> = [];

    switch (file.mimetype) {
      case 'text/xml':
        filePromises.push(this.handleXmlFile(workspaceId, file));
        break;
      case 'text/html':
        filePromises.push(this.handleHtmlFile(workspaceId, file));
        break;
      case 'application/octet-stream':
        filePromises.push(this.handleOctetStreamFile(workspaceId, file));
        break;
      case 'application/zip':
      case 'application/x-zip-compressed':
      case 'application/x-zip':
        filePromises.push(...this.handleZipFile(workspaceId, file));
        break;
      default:
        this.logger.warn(`Unsupported file type: ${file.mimetype}`);
    }

    return filePromises;
  }

  private unsupportedFile(message: string): Promise<unknown> {
    this.logger.warn(message);
    return Promise.resolve();
  }

  private async validateXmlAgainstSchema(xml: string, xsdPath: string): Promise<void> {
    const xsd = fs.readFileSync(xsdPath, 'utf8');
    const xsdDoc = libxmljs.parseXml(xsd);

    const xmlDoc = libxmljs.parseXml(xml);

    if (!xmlDoc.validate(xsdDoc)) {
      const validationErrors = xmlDoc.validationErrors.map(err => err.message).join(', ');
      throw new Error(`XML-Validierung fehlgeschlagen: ${validationErrors}`);
    }

    this.logger.log('XML-Validierung erfolgreich!');
  }

  private async handleXmlFile(workspaceId: number, file: FileIo): Promise<unknown> {
    try {
      if (!file.buffer || !file.buffer.length) {
        this.logger.warn('Empty file buffer');
        return await Promise.resolve();
      }

      const xmlContent = file.buffer.toString('utf8');
      const xmlDocument = cheerio.load(file.buffer.toString('utf8'), { xmlMode: true, recognizeSelfClosing: true });
      const firstChild = xmlDocument.root().children().first();
      const rootTagName = firstChild ? firstChild.prop('tagName') : null;

      if (!rootTagName) {
        return await this.unsupportedFile('Invalid XML: No root tag found');
      }

      const fileTypeMapping: Record<string, string> = {
        UNIT: 'Unit',
        BOOKLET: 'Booklet',
        TESTTAKERS: 'TestTakers'
      };

      const fileType = fileTypeMapping[rootTagName];
      if (!fileType) {
        return await this.unsupportedFile(`Unsupported root tag: ${rootTagName}`);
      }

      const schemaPaths: Record<string, string> = {
        UNIT: path.resolve(__dirname, 'schemas/unit.xsd'),
        BOOKLET: path.resolve(__dirname, 'schemas/booklet.xsd'),
        TESTTAKERS: path.resolve(__dirname, 'schemas/testtakers.xsd')
      };
      const xsdPath = schemaPaths[rootTagName];
      if (!xsdPath || !fs.existsSync(xsdPath)) {
        return await this.unsupportedFile(`No XSD schema found for root tag: ${rootTagName}`);
      }

      await this.validateXmlAgainstSchema(xmlContent, xsdPath);

      const metadata = xmlDocument('Metadata');
      const idElement = metadata.find('Id');
      const fileId = idElement.length ? idElement.text().toUpperCase().trim() : null;
      const resolvedFileId = fileType === 'TestTakers' ? fileId || file.originalname : fileId;

      const existingFile = await this.fileUploadRepository.findOne({
        where: { file_id: resolvedFileId, workspace_id: workspaceId }
      });
      if (existingFile) {
        this.logger.warn(
          `File with ID ${resolvedFileId} in Workspace ${workspaceId} already exists.`
        );
        return {
          message: `File with ID ${resolvedFileId} already exists`,
          fileId: resolvedFileId,
          filename: file.originalname
        };
      }

      return await this.fileUploadRepository.upsert({
        workspace_id: workspaceId,
        filename: file.originalname,
        file_type: fileType,
        file_size: file.size,
        data: file.buffer.toString(),
        file_id: resolvedFileId
      }, ['file_id']);
    } catch (error) {
      this.logger.error(`Error processing XML file: ${error.message}`);
      throw error;
    }
  }

  private async handleHtmlFile(workspaceId: number, file: FileIo): Promise<unknown> {
    const resourceFileId = WorkspaceService.getPlayerId(file);

    return this.fileUploadRepository.upsert({
      filename: file.originalname,
      workspace_id: workspaceId,
      file_type: 'Resource',
      file_size: file.size,
      file_id: resourceFileId,
      data: file.buffer.toString()
    }, ['file_id']);
  }

  private async handleOctetStreamFile(workspaceId: number, file: FileIo): Promise<unknown> {
    const resourceId = WorkspaceService.getResourceId(file);

    if (file.originalname.endsWith('.vocs')) {
      try {
        const parsedData = JSON.parse(file.buffer.toString());
        const schemaPath = './schemas/coding-scheme.schema.json';
        const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
        const schema: JSONSchemaType<unknown> = JSON.parse(schemaContent);
        const ajv = new Ajv();
        const validate = ajv.compile(schema);
        const isValid = validate(parsedData);
        if (!isValid) {
          this.logger.error(`JSON validation failed: ${JSON.stringify(validate.errors)}`);
        }

        return await this.fileUploadRepository.upsert({
          filename: file.originalname,
          workspace_id: workspaceId,
          file_id: resourceId.toUpperCase(),
          file_type: 'Resource',
          file_size: file.size,
          data: file.buffer.toString()
        }, ['file_id']);
      } catch (error) {
        this.logger.error('Error parsing or validating JSON:', error);
        throw new Error('Invalid JSON file or failed validation');
      }
    }

    return this.fileUploadRepository.upsert({
      filename: file.originalname,
      workspace_id: workspaceId,
      file_id: resourceId.toUpperCase(),
      file_type: 'Resource',
      file_size: file.size,
      data: file.buffer.toString()
    }, ['file_id']);
  }

  private handleZipFile(workspaceId: number, file: FileIo): Array<Promise<unknown>> {
    const filePromises: Array<Promise<unknown>> = [];
    const zip = new AdmZip(file.buffer);

    if (file.originalname.endsWith('.itcr.zip')) {
      // const packageFiles = zip.getEntries().map(entry => entry.entryName);
      // const resourcePackagesPath = './packages';
      // const packageName = 'GeoGebra';
      // const zipExtractAllToAsync = util.promisify(zip.extractAllToAsync);
      //
      // filePromises.push(zipExtractAllToAsync(`${resourcePackagesPath}/${packageName}`, true, true)
      //   .then(async () => {
      //     const newResourcePackage = this.resourcePackageRepository.create({
      //       name: packageName,
      //       elements: packageFiles,
      //       createdAt: new Date()
      //     });
      //     await this.resourcePackageRepository.save(newResourcePackage);
      //
      //     const sanitizedFileName = sanitizePath(file.originalname);
      //     fs.writeFileSync(`${resourcePackagesPath}/${packageName}/${sanitizedFileName}`, file.buffer);
      //
      //     return newResourcePackage.id;
      //   }));
    } else {
      const zipEntries = zip.getEntries();
      zipEntries.forEach(zipEntry => {
        const sanitizedEntry = sanitizePath(zipEntry.entryName);

        if (zipEntry.isDirectory) {
          this.logger.debug(`Skipping directory entry: ${sanitizedEntry}`);
          return;
        }

        const fileContent = zipEntry.getData();
        filePromises.push(...this.handleFile(workspaceId, {
          fieldname: file.fieldname,
          originalname: `${sanitizedEntry}`,
          encoding: file.encoding,
          mimetype: WorkspaceService.getMimeType(sanitizedEntry),
          buffer: fileContent,
          size: fileContent.length
        } as FileIo));
      });
    }

    return filePromises;
  }

  static cleanResponses(rows: ResponseDto[]): ResponseDto[] {
    return Object.values(rows.reduce((agg, response) => {
      const key = [response.test_person, response.unit_id].join('@@@@@@');
      if (agg[key]) {
        if (!(agg[key].responses.length) && response.responses.length) {
          agg[key].responses = response.responses;
        }
        if (
          !(Object.keys(agg[key].unit_state || {}).length) &&
          (Object.keys(response.unit_state || {}).length)
        ) {
          agg[key].unit_state = response.unit_state;
        }
      } else {
        agg[key] = response;
      }
      return agg;
    }, <{ [key: string]: ResponseDto }>{}));
  }

  async testCenterImport(entries: Record<string, unknown>[]): Promise<boolean> {
    try {
      const registry = this.fileUploadRepository.create(entries);
      await this.fileUploadRepository.upsert(registry, ['file_id']);
      return true;
    } catch (error) {
      this.logger.error('Error during test center import', error);
      return false;
    }
  }

  private static getMimeType(fileName: string): string {
    if (/\.xml$/i.test(fileName)) return 'text/xml';
    if (/\.html$/i.test(fileName)) return 'text/html';
    return 'application/octet-stream';
  }

  private static getPlayerId(file: FileIo): string {
    try {
      const playerCode = file.buffer.toString();

      const playerContent = cheerio.load(playerCode);

      // Search for JSON+LD <script> tags in the parsed DOM.
      const metaDataElement = playerContent('script[type="application/ld+json"]');
      if (!metaDataElement.length) {
        console.error('Meta-data <script> tag not found');
      }

      const metadata = JSON.parse(metaDataElement.text());
      if (!metadata.id || !metadata.version) {
        console.error('Invalid metadata structure: Missing id or version');
      }

      return WorkspaceService.normalizePlayerId(`${metadata.id}-${metadata.version}`);
    } catch (error) {
      return WorkspaceService.getResourceId(file);
    }
  }

  private static getResourceId(file: FileIo): string {
    if (!file?.originalname) {
      throw new Error('Invalid file: originalname is required.');
    }
    const filePathParts = file.originalname.split('/')
      .map(part => part.trim());
    const fileName = filePathParts.pop();
    if (!fileName) {
      throw new Error('Invalid file: Could not determine the file name.');
    }
    return fileName.toUpperCase();
  }

  private static normalizePlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;

    const matches = name.match(reg);

    if (!matches) {
      throw new Error(`Invalid player name: ${name}`);
    }

    const [, module = '', , major = '', minorDot = ''] = matches;

    const majorVersion = parseInt(major, 10) || 0;
    const minorVersion = minorDot ? parseInt(minorDot.substring(1), 10) : 0;
    // const patchVersion = patchDot ? parseInt(patchDot.substring(1), 10) : 0;
    // const label = labelWithDash ? labelWithDash.substring(1) : '';

    return `${module}-${majorVersion}.${minorVersion}`.toUpperCase();
  }
}
