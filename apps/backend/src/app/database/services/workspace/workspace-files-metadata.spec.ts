import { NotFoundException } from '@nestjs/common';
import { WorkspaceFilesService } from './workspace-files.service';

describe('Workspace metadata read access', () => {
  const read = (file: unknown) => {
    const repository = { findOne: jest.fn().mockResolvedValue(file) };
    const service = { fileUploadRepository: repository } as unknown as WorkspaceFilesService;
    return { repository, result: WorkspaceFilesService.prototype.readMetadataFile.call(service, 12, 5) };
  };

  it('reads only Resource files in the requested workspace and supports uppercase extensions', async () => {
    const { repository, result } = read({ filename: 'UNIT.VOMD', data: '{"title":"ä"}' });
    await expect(result).resolves.toEqual({ filename: 'UNIT.VOMD', base64Data: Buffer.from('{"title":"ä"}').toString('base64'), mimeType: 'application/json' });
    expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 5, workspace_id: 12, file_type: 'Resource' } });
  });

  it.each([null, { filename: 'unit.voud', data: '{}' }, { filename: 'people.xml', data: '{}' }])('rejects a missing or non-metadata resource', async file => {
    await expect(read(file).result).rejects.toBeInstanceOf(NotFoundException);
  });
});
