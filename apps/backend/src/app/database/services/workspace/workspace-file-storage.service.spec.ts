import AdmZip = require('adm-zip');
import FileUpload from '../../entities/file_upload.entity';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';

describe('WorkspaceFileStorageService', () => {
  let service: WorkspaceFileStorageService;

  beforeEach(() => {
    service = new WorkspaceFileStorageService();
  });

  it('should restore base64 encoded binary files in ZIP export', () => {
    const binaryContent = Buffer.from([0, 255, 127, 10, 0, 88]);
    const files = [
      {
        file_type: 'Resource',
        filename: 'image.png',
        data: binaryContent.toString('base64')
      } as FileUpload
    ];

    const zipBuffer = service.createZipBufferFromFiles(files, {
      Resource: 'Ressourcen'
    });

    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntry('Ressourcen/image.png');

    expect(entry).toBeDefined();
    expect(entry.getData()).toEqual(binaryContent);
  });

  it('should keep utf8 text content unchanged in ZIP export', () => {
    const xmlContent = '<?xml version="1.0" encoding="utf-8"?><x>äöü</x>';
    const files = [
      {
        file_type: 'Unit',
        filename: 'unit.xml',
        data: xmlContent
      } as FileUpload
    ];

    const zipBuffer = service.createZipBufferFromFiles(files, {
      Unit: 'Aufgaben'
    });

    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntry('Aufgaben/unit.xml');

    expect(entry).toBeDefined();
    expect(entry.getData().toString('utf8')).toBe(xmlContent);
  });

  it('should keep files with duplicate names by assigning unique zip paths', () => {
    const files = [
      {
        file_type: 'Unit',
        filename: 'unit.xml',
        data: '<unit>first</unit>'
      } as FileUpload,
      {
        file_type: 'Unit',
        filename: 'unit.xml',
        data: '<unit>second</unit>'
      } as FileUpload
    ];

    const zipBuffer = service.createZipBufferFromFiles(files, {
      Unit: 'Aufgaben'
    });

    const zip = new AdmZip(zipBuffer);
    const first = zip.getEntry('Aufgaben/unit.xml');
    const second = zip.getEntry('Aufgaben/unit (2).xml');

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first.getData().toString('utf8')).toBe('<unit>first</unit>');
    expect(second.getData().toString('utf8')).toBe('<unit>second</unit>');
  });
});
