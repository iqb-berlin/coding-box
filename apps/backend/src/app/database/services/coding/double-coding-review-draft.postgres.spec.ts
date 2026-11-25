import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMock } from '@golevelup/ts-jest';
import User from '../../entities/user.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { DoubleCodingReviewDecision } from '../../entities/double-coding-review-decision.entity';
import { getCodingReviewCapabilities } from '../shared/coding-ownership.policy';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { CodingJobService } from './coding-job.service';
import { DoubleCodingReviewDecisionService } from './double-coding-review-decision.service';
import { KappaPostgresFixture } from './kappa-query.postgres.test.factory';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;

describePostgres('Double-coding review draft ownership with PostgreSQL', () => {
  const fixture = new KappaPostgresFixture();
  let decisions: DoubleCodingReviewDecisionService;

  beforeAll(async () => {
    await fixture.open(serverUrl!);
    const module = await Test.createTestingModule({
      providers: [
        DoubleCodingReviewDecisionService,
        { provide: getRepositoryToken(ResponseEntity), useValue: fixture.db.getRepository(ResponseEntity) },
        { provide: getRepositoryToken(DoubleCodingReviewDecision), useValue: fixture.db.getRepository(DoubleCodingReviewDecision) },
        {
          provide: WorkspaceExclusionService,
          useValue: {
            resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
          }
        },
        { provide: CodingJobService, useValue: { getSelectableReviewCodeForUnit: async () => ({ code: 1, score: 1 }) } }
      ]
    }).useMocker(() => createMock()).compile();
    decisions = module.get(DoubleCodingReviewDecisionService);
  }, 60000);

  afterAll(async () => fixture.close());

  it('allows edits to an owned case and preserves its draft when a foreign job joins the case', async () => {
    const { workspaceId, profileId } = await fixture.workspace('Review draft permissions');
    const [manager, firstCoder, secondCoder, otherManager] = await fixture.db.getRepository(User).save(
      ['manager', 'first-coder', 'second-coder', 'other-manager'].map(username => ({
        username, identity: username, issuer: 'review-draft-test', isAdmin: false
      }))
    );
    await fixture.db.getRepository(WorkspaceUser).save([
      ...[manager, otherManager].map(user => ({ workspaceId, userId: user.id, accessLevel: 2 })),
      ...[firstCoder, secondCoder].map(user => ({
        workspaceId, userId: user.id, accessLevel: 1, canCode: true
      }))
    ]);
    const responseId = await fixture.response(workspaceId, 'UNIT', 'VAR', 'person');
    const firstJob = await fixture.job(workspaceId, profileId, firstCoder.id, { creator_user_id: manager.id });
    const secondJob = await fixture.job(workspaceId, profileId, secondCoder.id, { creator_user_id: manager.id });
    const sourceUnitId = await fixture.result(firstJob, responseId, 'UNIT', 'VAR');
    await fixture.result(secondJob, responseId, 'UNIT', 'VAR', { code: 1 });

    const canEdit = async () => (await getCodingReviewCapabilities(fixture.db.manager, workspaceId, [responseId], manager.id))
      .canEditDraft.get(responseId);
    const save = (comment: string) => decisions.saveDoubleCodedReviewDraft(workspaceId, responseId, manager.id, manager.username, {
      sourceUnitId, code: 1, comment
    });
    await expect(canEdit()).resolves.toBe(true);
    const draft = await save('First draft');
    await expect(save('Edited draft')).resolves.toMatchObject({ id: draft.id, state: 'draft', comment: 'Edited draft' });

    const foreignJob = await fixture.job(workspaceId, profileId, secondCoder.id, { creator_user_id: otherManager.id });
    await fixture.result(foreignJob, responseId, 'UNIT', 'VAR');
    await expect(canEdit()).resolves.toBe(false);
    await expect(save('Denied edit')).rejects.toBeInstanceOf(ForbiddenException);
    const persisted = await fixture.db.getRepository(DoubleCodingReviewDecision).findBy({ workspace_id: workspaceId, response_id: responseId });
    expect(persisted).toMatchObject([{
      id: draft.id, manager_user_id: manager.id, state: 'draft', comment: 'Edited draft'
    }]);
  });
});
