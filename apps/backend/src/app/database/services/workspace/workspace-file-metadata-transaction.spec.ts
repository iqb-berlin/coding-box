import { WorkspaceFileMetadataService } from './workspace-file-metadata.service';
import FileUpload from '../../entities/file_upload.entity';

describe('workspace metadata transaction scope', () => {
  it('uses the caller transaction repository when a metadata cache miss must be refreshed', async () => {
    const ordinaryRepository = { find: jest.fn() };
    const transactionRepository = { find: jest.fn().mockResolvedValue([]) };
    const manager = { getRepository: jest.fn().mockReturnValue(transactionRepository) };
    const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true) };
    const service = new WorkspaceFileMetadataService(ordinaryRepository as never, cache as never, {} as never);

    await expect(service.getUnitVariableMap(7, manager as never)).resolves.toEqual(new Map());
    expect(manager.getRepository).toHaveBeenCalledWith(FileUpload);
    expect(transactionRepository.find).toHaveBeenCalledWith(expect.objectContaining({ where: { workspace_id: 7, file_type: 'Unit' } }));
    expect(ordinaryRepository.find).not.toHaveBeenCalled();
  });
});
