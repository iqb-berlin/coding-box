import { BadRequestException } from '@nestjs/common';
import { CodingJob } from '../../entities/coding-job.entity';
import { CoderTrainingDiscussionService } from './coder-training-discussion.service';
import { CoderTrainingDisplayService } from './coder-training-display.service';
import { WithinTrainingCoderResult, WithinTrainingCodingRow } from './coder-training.types';
import { MissingsProfilesService } from './missings-profiles.service';

describe('CoderTrainingDiscussionService with real missing-score resolution', () => {
  function fixture(profileIds: number[]) {
    const getMissing = jest.fn().mockResolvedValue({ code: -98, score: 2 });
    const resolve = jest.fn(async (_workspace: number, profileId: number) => profileId);
    const profiles = {
      resolveMissingsProfileId: resolve,
      getMissingByCodeForProfileOrDefault: getMissing
    } as unknown as MissingsProfilesService;
    const display = new CoderTrainingDisplayService(profiles);
    const service = new CoderTrainingDiscussionService({} as never, {} as never, profiles, {} as never, display);
    const jobs = profileIds.map((id, index) => ({ id: index + 1, missings_profile_id: id })) as CodingJob[];
    const units = new Map(jobs.map(job => [job.id, {} as WithinTrainingCodingRow]));
    const coders = jobs.map(job => ({
      jobId: job.id, coderName: `Coder ${job.id}`, code: '-98', score: 0, notes: null, codingIssueOption: null
    })) as WithinTrainingCoderResult[];
    return {
      service, jobs, units, coders, getMissing, resolve
    };
  }

  it('resolves the shared profile score for an automatic agreement across jobs', async () => {
    const f = fixture([9, 9]);
    await expect(f.service.deriveAutomaticDiscussionResultForRawResponse(7, 10, 42, f.jobs, f.units, f.coders))
      .resolves.toEqual({ code: -98, score: 2 });
    expect(f.getMissing).toHaveBeenCalledWith(7, 9, -98);
  });

  it('rejects conflicting source profiles before reading a score', async () => {
    const f = fixture([9, 11]);
    await expect(f.service.deriveAutomaticDiscussionResultForRawResponse(7, 10, 42, f.jobs, f.units, f.coders))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(f.getMissing).not.toHaveBeenCalled();
  });

  it('does not derive a discussion result for disagreement', async () => {
    const f = fixture([9, 11]);
    f.coders[1].code = '1';
    await expect(f.service.deriveAutomaticDiscussionResultForRawResponse(7, 10, 42, f.jobs, f.units, f.coders))
      .resolves.toBeNull();
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('uses only source jobs containing the response when resolving the profile', async () => {
    const f = fixture([9, 11]);
    f.units.delete(2);
    f.coders.splice(1);
    await expect(f.service.deriveAutomaticDiscussionResultForRawResponse(7, 10, 42, f.jobs, f.units, f.coders))
      .resolves.toEqual({ code: -98, score: 2 });
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.resolve).toHaveBeenCalledWith(7, 9);
  });
});
