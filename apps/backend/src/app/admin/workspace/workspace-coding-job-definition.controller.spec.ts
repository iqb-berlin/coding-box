import { WorkspaceCodingJobDefinitionController } from './workspace-coding-job-definition.controller';

describe('WorkspaceCodingJobDefinitionController', () => {
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
});
