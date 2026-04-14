import { Injectable } from '@nestjs/common';
import AdmZip = require('adm-zip');
import * as path from 'path';
import FileUpload from '../../entities/file_upload.entity';
import { FileIo } from '../../../admin/workspace/file-io.interface';

@Injectable()
export class WorkspaceFileStorageService {
  private readonly textFileExtensions = new Set([
    '.xml',
    '.html',
    '.htm',
    '.xhtml',
    '.txt',
    '.json',
    '.csv',
    '.voud',
    '.vocs',
    '.vomd'
  ]);

  private isLikelyBase64(value: string): boolean {
    if (!value || value.length % 4 !== 0) {
      return false;
    }

    return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  private toZipContentBuffer(file: FileUpload): Buffer {
    const storedData =
      typeof file.data === 'string' ? file.data : String(file.data ?? '');
    const extension = path.extname(file.filename).toLowerCase();

    if (this.textFileExtensions.has(extension)) {
      return Buffer.from(storedData, 'utf8');
    }

    if (this.isLikelyBase64(storedData)) {
      return Buffer.from(storedData, 'base64');
    }

    return Buffer.from(storedData, 'utf8');
  }

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

  createZipBufferFromFiles(
    files: FileUpload[],
    folderNameMap?: Record<string, string>
  ): Buffer {
    const zip = new AdmZip();
    const usedZipPaths = new Set<string>();

    const filesByType: Record<string, FileUpload[]> = {};
    files.forEach(file => {
      if (!filesByType[file.file_type]) {
        filesByType[file.file_type] = [];
      }
      filesByType[file.file_type].push(file);
    });

    for (const [fileType, filesForType] of Object.entries(filesByType)) {
      const folderName = folderNameMap?.[fileType] || fileType;
      for (const file of filesForType) {
        const fileContent = this.toZipContentBuffer(file);
        const zipPath = this.createUniqueZipPath(
          folderName,
          file.filename,
          usedZipPaths
        );
        zip.addFile(zipPath, fileContent);
      }
    }

    return zip.toBuffer();
  }

  private createUniqueZipPath(
    folderName: string,
    originalFileName: string,
    usedZipPaths: Set<string>
  ): string {
    const safeFileName = path.basename(
      originalFileName && originalFileName.trim().length > 0 ?
        originalFileName :
        'file'
    );
    const extension = path.extname(safeFileName);
    const baseName = extension ?
      safeFileName.slice(0, -extension.length) :
      safeFileName;

    let index = 1;
    let candidate = `${folderName}/${safeFileName}`;

    while (usedZipPaths.has(candidate)) {
      index += 1;
      candidate = `${folderName}/${baseName} (${index})${extension}`;
    }

    usedZipPaths.add(candidate);
    return candidate;
  }
}
