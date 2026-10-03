import AdmZip = require('adm-zip');
import FileUpload from '../../entities/file_upload.entity';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';

describe('WorkspaceFileStorageService', () => {
  let service: WorkspaceFileStorageService;

  beforeEach(() => {
    service = new WorkspaceFileStorageService();
  });

  it.each([0x10000000, 0x7fffffff])('reads real ZIP content without allocating the declared %i bytes', declaredSize => {
    const zip = new AdmZip();
    zip.addFile('unit.xml', Buffer.from('<unit/>'));
    const buffer = zip.toBuffer();
    const centralHeader = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(declaredSize, centralHeader + 24);
    buffer.writeUInt32LE(declaredSize, 22);

    const originalAlloc = Buffer.alloc;
    const allocations: number[] = [];
    const allocationSpy = jest.spyOn(Buffer, 'alloc').mockImplementation((size: number) => {
      allocations.push(size);
      // Safely expose the old allocation path without exhausting the test host.
      if (size >= declaredSize) throw new Error('Unsafe declared-size allocation');
      return originalAlloc(size);
    });
    try {
      expect(service.unzipToFileIos(buffer)[0].buffer.toString()).toBe('<unit/>');
      expect(allocations).not.toContain(declaredSize);
    } finally {
      allocationSpy.mockRestore();
    }
  });

  it('rejects compressed content declaring zero output bytes', () => {
    const zip = new AdmZip();
    zip.addFile('unit.xml', Buffer.from('x'.repeat(16384)));
    const buffer = zip.toBuffer();
    const centralHeader = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(buffer.readUInt16LE(centralHeader + 10)).toBe(8);
    expect(service.unzipToFileIos(buffer)[0].buffer.length).toBe(16384);
    buffer.writeUInt32LE(0, centralHeader + 24);
    buffer.writeUInt32LE(0, 22);

    expect(() => service.unzipToFileIos(buffer)).toThrow();
  });

  it('imports valid XML and binary ZIP entries', () => {
    const zip = new AdmZip();
    const binary = Buffer.from([0, 255, 127, 10]);
    zip.addFile('folder/unit.xml', Buffer.from('<unit>ä</unit>'));
    zip.addFile('folder/image.png', binary);

    const files = service.unzipToFileIos(zip.toBuffer());

    expect(files.find(file => file.originalname === 'unit.xml')?.buffer.toString()).toBe('<unit>ä</unit>');
    expect(files.find(file => file.originalname === 'image.png')?.buffer).toEqual(binary);
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
