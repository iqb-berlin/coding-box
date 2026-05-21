import { Response } from 'express';
import { WorkspaceCodingReplayController } from './workspace-coding-replay.controller';
import FileUpload from '../../database/entities/file_upload.entity';

jest.mock('libxmljs2', () => ({}));

type HeaderResponse = Response & {
  setHeader: jest.Mock;
};

describe('WorkspaceCodingReplayController', () => {
  const unitDef = [{ file_id: 'UNIT-1.VOUD', data: 'unit def', workspace_id: 12 }];
  const player = [{ file_id: 'PLAYER-1.2.0', data: 'player', workspace_id: 12 }];
  const vocs = [{ file_id: 'UNIT-1.VOCS', data: 'vocs', workspace_id: 12 }];
  const unitFile = {
    data: '<Unit><DefinitionRef player="Player-1.2" /></Unit>'
  } as FileUpload;
  const response = { responses: [{ id: 'var1', content: '[]' }] };

  let workspacePlayerService: {
    findUnitDef: jest.Mock;
    findUnit: jest.Mock;
    findPlayer: jest.Mock;
  };
  let workspaceFilesService: {
    getVocs: jest.Mock;
  };
  let workspaceTestResultsService: {
    findUnitResponse: jest.Mock;
  };

  const createResponse = (): HeaderResponse => ({
    setHeader: jest.fn()
  } as unknown as HeaderResponse);

  const createController = (
    replayPayloadBrowserCacheSeconds?: string
  ): WorkspaceCodingReplayController => {
    workspacePlayerService = {
      findUnitDef: jest.fn().mockResolvedValue(unitDef),
      findUnit: jest.fn().mockResolvedValue([unitFile]),
      findPlayer: jest.fn().mockResolvedValue(player)
    };
    workspaceFilesService = {
      getVocs: jest.fn().mockResolvedValue(vocs)
    };
    workspaceTestResultsService = {
      findUnitResponse: jest.fn().mockResolvedValue(response)
    };

    return new WorkspaceCodingReplayController(
      { generateReplayUrlForResponse: jest.fn() } as never,
      workspacePlayerService as never,
      workspaceFilesService as never,
      workspaceTestResultsService as never,
      { get: jest.fn().mockReturnValue(replayPayloadBrowserCacheSeconds) } as never
    );
  };

  it('should return cacheable replay assets without test-person data', async () => {
    const controller = createController();
    const res = createResponse();

    const result = await controller.getReplayAssets(12, 'unit-1', res);

    expect(result).toEqual({
      unitDef,
      player,
      vocs
    });
    expect(workspacePlayerService.findUnitDef).toHaveBeenCalledWith(12, 'UNIT-1');
    expect(workspacePlayerService.findUnit).toHaveBeenCalledWith(12, 'UNIT-1');
    expect(workspaceFilesService.getVocs).toHaveBeenCalledWith(12, 'UNIT-1');
    expect(workspacePlayerService.findPlayer).toHaveBeenCalledWith(12, 'PLAYER-1.2.0');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization');
  });

  it('should return replay response separately from static assets', async () => {
    const controller = createController();
    const res = createResponse();

    const result = await controller.getReplayResponse(
      12,
      'person@code@booklet',
      'unit-1',
      res
    );

    expect(result).toEqual({
      response,
      serverTimings: expect.objectContaining({
        findUnitResponseMs: expect.any(Number),
        totalMs: expect.any(Number)
      })
    });
    expect(workspaceTestResultsService.findUnitResponse).toHaveBeenCalledWith(
      12,
      'person@code@booklet',
      'unit-1'
    );
    expect(workspacePlayerService.findUnitDef).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization');
  });

  it('should keep the combined replay payload route compatible', async () => {
    const controller = createController('60');
    const res = createResponse();

    const result = await controller.getReplayPayload(
      12,
      'person@code@booklet',
      'unit-1',
      res
    );

    expect(result).toEqual({
      unitDef,
      player,
      vocs,
      response,
      serverTimings: expect.objectContaining({
        payloadFindUnitDefMs: expect.any(Number),
        payloadFindUnitMs: expect.any(Number),
        payloadGetVocsMs: expect.any(Number),
        payloadExtractPlayerIdMs: expect.any(Number),
        payloadFindPlayerMs: expect.any(Number),
        payloadFindUnitResponseMs: expect.any(Number),
        payloadTotalMs: expect.any(Number)
      })
    });
    expect(workspacePlayerService.findUnitDef).toHaveBeenCalledWith(12, 'UNIT-1');
    expect(workspaceTestResultsService.findUnitResponse).toHaveBeenCalledWith(
      12,
      'person@code@booklet',
      'unit-1'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization');
  });

  it('should disable browser caching when the replay cache TTL is zero', async () => {
    const controller = createController('0');
    const res = createResponse();

    await controller.getReplayAssets(12, 'unit-1', res);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization');
  });

  it('should not cache replay errors', async () => {
    const controller = createController();
    const res = createResponse();
    workspacePlayerService.findUnitDef.mockResolvedValueOnce([]);

    await expect(controller.getReplayAssets(12, 'unit-1', res)).rejects.toThrow(
      'Error retrieving replay assets: Unit definition not found for unit-1'
    );

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization');
  });
});
