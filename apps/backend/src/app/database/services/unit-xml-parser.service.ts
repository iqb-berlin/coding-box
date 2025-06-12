import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import FileUpload from '../entities/file_upload.entity';

interface BaseVariable {
  id: string;
  type: string;
  format: string;
  nullable: string;
}

@Injectable()
export class UnitXmlParserService {
  private readonly logger = new Logger(UnitXmlParserService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>
  ) {}

  async getAllUnitXmlFiles(): Promise<FileUpload[]> {
    this.logger.log('Fetching all unit XML files');
    try {
      const files = await this.fileUploadRepository.find({
        where: { file_type: 'Unit' },
        select: ['id', 'filename', 'file_id', 'data']
      });

      this.logger.log(`Found ${files.length} unit XML files`);
      return files;
    } catch (error) {
      this.logger.error(`Error retrieving unit XML files: ${error.message}`, error.stack);
      throw new Error(`Could not retrieve unit XML files: ${error.message}`);
    }
  }

  async parseBaseVariables(): Promise<BaseVariable[]> {
    const unitFiles = await this.getAllUnitXmlFiles();
    const baseVariables: BaseVariable[] = [];

    for (const file of unitFiles) {
      try {
        const xmlContent = file.data;
        const $ = cheerio.load(xmlContent, { xmlMode: true, recognizeSelfClosing: true });

        // Find all Variable elements under BaseVariables
        $('BaseVariables Variable').each((_, element) => {
          const variable: BaseVariable = {
            id: $(element).attr('id') || '',
            type: $(element).attr('type') || '',
            format: $(element).attr('format') || '',
            nullable: $(element).attr('nullable') || ''
          };

          baseVariables.push(variable);
        });
      } catch (error) {
        this.logger.error(`Error parsing XML file ${file.filename}: ${error.message}`);
        // Continue with the next file
      }
    }

    this.logger.log(`Parsed ${baseVariables.length} base variables from ${unitFiles.length} unit XML files`);
    return baseVariables;
  }
}
