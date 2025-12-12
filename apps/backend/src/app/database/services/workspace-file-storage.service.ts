import { Injectable } from '@nestjs/common';
import AdmZip = require('adm-zip');
import * as path from 'path';
import FileUpload from '../entities/file_upload.entity';
import { FileIo } from '../../admin/workspace/file-io.interface';

@Injectable()
export class WorkspaceFileStorageService {
  sanitizePath(filePath: string): string {
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.startsWith('..')) {
      throw new Error('Invalid file path: Path cannot navigate outside root.');
    }
    return normalizedPath.replace(/\\/g, '/');
  }

  getMimeType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.xml': 'text/xml',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.zip': 'application/zip'
    };
    return mimeTypes[extension] || 'application/octet-stream';
  }

  unzipToFileIos(zipBuffer: Buffer): FileIo[] {
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      throw new Error('ZIP is empty.');
    }

    const fileIos: FileIo[] = [];

    zipEntries.forEach(zipEntry => {
      if (zipEntry.isDirectory) {
        return;
      }

      const entryName = zipEntry.entryName;
      const sanitizedEntryName = this.sanitizePath(entryName);
      const entryData = zipEntry.getData();

      const mimeType = this.getMimeType(sanitizedEntryName);
      fileIos.push({
        originalname: path.basename(sanitizedEntryName),
        buffer: entryData,
        mimetype: mimeType,
        size: entryData.length,
        fieldname: '',
        encoding: ''
      });
    });

    return fileIos;
  }

  createZipBufferFromFiles(files: FileUpload[]): Buffer {
    const zip = new AdmZip();

    const filesByType: Record<string, FileUpload[]> = {};
    files.forEach(file => {
      if (!filesByType[file.file_type]) {
        filesByType[file.file_type] = [];
      }
      filesByType[file.file_type].push(file);
    });

    for (const [fileType, filesForType] of Object.entries(filesByType)) {
      for (const file of filesForType) {
        const fileContent = Buffer.from(file.data.toString(), 'utf8');
        const zipPath = `${fileType}/${file.filename}`;
        zip.addFile(zipPath, fileContent);
      }
    }

    return zip.toBuffer();
  }
}
