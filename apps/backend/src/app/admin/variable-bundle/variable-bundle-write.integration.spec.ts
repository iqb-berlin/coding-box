import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VariableBundleController } from './variable-bundle.controller';
import { VariableBundleService } from '../../database/services/coding/variable-bundle.service';
import { VariableBundle } from '../../database/entities/variable-bundle.entity';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { createRequestValidationPipe } from '../../http/request-validation';

describe('Variable bundle writes with additional JSON fields', () => {
  let app: INestApplication;
  let url: string;
  const repository = {
    findOne: jest.fn(), create: jest.fn(value => value), save: jest.fn(async value => value)
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VariableBundleController],
      providers: [VariableBundleService, { provide: getRepositoryToken(VariableBundle), useValue: repository }]
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createRequestValidationPipe());
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/admin/workspace/47/variable-bundle`;
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app?.close());

  it('ignores attacker-selected primary keys on create', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bundle',
        variables: [],
        id: 99,
        workspace_id: 88,
        codingJobVariableBundles: [{ id: 91 }]
      })
    });
    expect(response.status).toBe(201);
    expect(repository.save).toHaveBeenCalledWith({
      name: 'Bundle',
      description: undefined,
      variables: [],
      workspace_id: 47,
      codingJobVariableBundles: []
    });
  });

  it('updates permitted fields while retaining the authorized workspace and cascade relations', async () => {
    repository.findOne.mockResolvedValue({
      id: 12,
      workspace_id: 47,
      name: 'Original',
      variables: [],
      codingJobVariableBundles: [{ id: 7 }]
    });
    const response = await fetch(`${url}/12`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Changed',
        id: 99,
        workspace_id: 88,
        codingJobVariableBundles: [{ id: 91 }]
      })
    });
    expect(response.status).toBe(200);
    expect(repository.save).toHaveBeenCalledWith({
      id: 12,
      workspace_id: 47,
      name: 'Changed',
      variables: [],
      codingJobVariableBundles: [{ id: 7 }]
    });
  });
});
