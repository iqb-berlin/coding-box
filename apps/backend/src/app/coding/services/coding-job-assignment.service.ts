import { Injectable } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../entities/coding-job-variable-bundle.entity';

@Injectable()
export class CodingJobAssignmentService {
  constructor(
    private dataSource: DataSource
  ) {}

  async assignCoders(codingJobId: number, userIds: number[], manager?: EntityManager): Promise<CodingJobCoder[]> {
    const entityManager = manager || this.dataSource.manager;

    await entityManager.delete(CodingJobCoder, { coding_job_id: codingJobId });

    const assignments = userIds.map(userId => {
      const assignment = new CodingJobCoder();
      assignment.coding_job_id = codingJobId;
      assignment.user_id = userId;
      return assignment;
    });

    return entityManager.save(assignments);
  }

  async assignVariables(
    codingJobId: number,
    variables: { unitName: string; variableId: string }[],
    manager?: EntityManager
  ): Promise<CodingJobVariable[]> {
    const entityManager = manager || this.dataSource.manager;

    await entityManager.delete(CodingJobVariable, { coding_job_id: codingJobId });

    const assignments = variables.map(v => {
      const assignment = new CodingJobVariable();
      assignment.coding_job_id = codingJobId;
      assignment.unit_name = v.unitName;
      assignment.variable_id = v.variableId;
      return assignment;
    });

    return entityManager.save(assignments);
  }

  async assignVariableBundles(
    codingJobId: number,
    variableBundleIds: number[],
    manager?: EntityManager
  ): Promise<CodingJobVariableBundle[]> {
    const entityManager = manager || this.dataSource.manager;

    await entityManager.delete(CodingJobVariableBundle, { coding_job_id: codingJobId });

    const assignments = variableBundleIds.map(bundleId => {
      const assignment = new CodingJobVariableBundle();
      assignment.coding_job_id = codingJobId;
      assignment.variable_bundle_id = bundleId;
      return assignment;
    });

    return entityManager.save(assignments);
  }
}
