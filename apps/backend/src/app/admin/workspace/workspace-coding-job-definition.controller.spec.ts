import { WorkspaceCodingJobDefinitionController } from './workspace-coding-job-definition.controller';

describe('WorkspaceCodingJobDefinitionController', () => {
  it('reads job definitions through the workspace-scoped service path', async () => {
    const jobDefinitionService = {
      getJobDefinition: jest.fn().mockResolvedValue({
        id: 42,
        workspace_id: 5
      })
    };
    const controller = new WorkspaceCodingJobDefinitionController(jobDefinitionService as never);

    await expect(controller.getJobDefinition(5, 42)).resolves.toMatchObject({
      id: 42,
      workspace_id: 5
    });

    expect(jobDefinitionService.getJobDefinition).toHaveBeenCalledWith(42, 5);
  });

  it('updates job definitions through the workspace-scoped service path', async () => {
    const jobDefinitionService = {
      updateJobDefinition: jest.fn().mockResolvedValue({
        id: 42,
        workspace_id: 5,
        status: 'approved'
      })
    };
    const controller = new WorkspaceCodingJobDefinitionController(jobDefinitionService as never);

    await expect(controller.updateJobDefinition(5, 42, { status: 'approved' })).resolves.toMatchObject({
      id: 42,
      workspace_id: 5,
      status: 'approved'
    });

    expect(jobDefinitionService.updateJobDefinition).toHaveBeenCalledWith(42, 5, { status: 'approved' });
  });

  it('approves job definitions through the workspace-scoped service path', async () => {
    const jobDefinitionService = {
      approveJobDefinition: jest.fn().mockResolvedValue({
        id: 42,
        workspace_id: 5,
        status: 'approved'
      })
    };
    const controller = new WorkspaceCodingJobDefinitionController(jobDefinitionService as never);

    await expect(controller.approveJobDefinition(5, 42, { status: 'approved' })).resolves.toMatchObject({
      id: 42,
      workspace_id: 5,
      status: 'approved'
    });

    expect(jobDefinitionService.approveJobDefinition).toHaveBeenCalledWith(42, 5, { status: 'approved' });
  });

  it('deletes job definitions through the workspace-scoped service path', async () => {
    const jobDefinitionService = {
      deleteJobDefinition: jest.fn().mockResolvedValue(undefined)
    };
    const controller = new WorkspaceCodingJobDefinitionController(jobDefinitionService as never);

    await expect(controller.deleteJobDefinition(5, 42)).resolves.toEqual({
      success: true,
      message: 'Job definition deleted successfully'
    });

    expect(jobDefinitionService.deleteJobDefinition).toHaveBeenCalledWith(42, 5);
  });

  it('creates coding jobs through the job definition service', async () => {
    const jobDefinitionService = {
      createCodingJobFromDefinition: jest.fn().mockResolvedValue({
        success: true,
        jobsCreated: 2,
        message: 'created',
        distribution: {},
        doubleCodingInfo: {},
        jobs: []
      })
    };
    const controller = new WorkspaceCodingJobDefinitionController(jobDefinitionService as never);

    await expect(controller.createCodingJobFromDefinition(5, 42)).resolves.toMatchObject({
      success: true,
      jobsCreated: 2
    });

    expect(jobDefinitionService.createCodingJobFromDefinition).toHaveBeenCalledWith(42, 5);
  });

  it('previews coding jobs through the normalized job definition service path', async () => {
    const jobDefinitionService = {
      previewCodingJobFromDefinition: jest.fn().mockResolvedValue({
        distribution: {},
        distributionByCoderId: {},
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        warnings: [],
        selectedVariables: [],
        selectedVariableBundles: [],
        selectedCoders: [
          {
            id: 1,
            name: 'Ada',
            username: 'Ada',
            capacityPercent: 100
          }
        ]
      })
    };
    const controller = new WorkspaceCodingJobDefinitionController(jobDefinitionService as never);

    await expect(controller.previewCodingJobFromDefinition(5, 42)).resolves.toMatchObject({
      distribution: {},
      selectedVariables: [],
      selectedVariableBundles: [],
      selectedCoders: [
        {
          id: 1,
          name: 'Ada',
          username: 'Ada',
          capacityPercent: 100
        }
      ]
    });

    expect(jobDefinitionService.previewCodingJobFromDefinition).toHaveBeenCalledWith(42, 5);
  });

  it('exports job definition distribution snapshots as downloadable CSV', async () => {
    const jobDefinitionService = {
      exportDistributionSnapshotAsCsv: jest.fn().mockResolvedValue('header\nrow')
    };
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };
    const controller = new WorkspaceCodingJobDefinitionController(jobDefinitionService as never);

    await controller.exportJobDefinitionDistributionAsCsv(5, 42, response as never);

    expect(jobDefinitionService.exportDistributionSnapshotAsCsv).toHaveBeenCalledWith(42, 5);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(/^attachment; filename="job-definition-distribution-5-42-\d{4}-\d{2}-\d{2}\.csv"$/)
    );
    expect(response.send).toHaveBeenCalledWith('\uFEFFheader\nrow');
  });
});
