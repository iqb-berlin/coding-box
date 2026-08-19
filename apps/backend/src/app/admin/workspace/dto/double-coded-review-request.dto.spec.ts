import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ApplyDoubleCodedResolutionsRequestDto,
  DoubleCodedReviewQueryDto,
  SaveDoubleCodedReviewDraftRequestDto
} from './double-coded-review-request.dto';

describe('double-coded review request DTOs', () => {
  it('transforms a valid review query into typed filters', async () => {
    const query = plainToInstance(DoubleCodedReviewQueryDto, {
      page: '2',
      limit: '25',
      onlyConflicts: 'true',
      excludeTrainings: 'false',
      coderId: '9',
      agreementFilter: 'differ',
      sortBy: 'personInfo',
      sortDirection: 'desc',
      jobDefinitionIds: '11,12',
      coderTrainingIds: '21'
    });

    await expect(validate(query)).resolves.toEqual([]);
    expect(query).toMatchObject({
      page: 2,
      limit: 25,
      onlyConflicts: true,
      excludeTrainings: false,
      coderId: 9,
      agreementFilter: 'differ',
      sortBy: 'personInfo',
      sortDirection: 'desc',
      jobDefinitionIds: [11, 12],
      coderTrainingIds: [21]
    });
  });

  it.each([
    { page: 'abc' },
    { limit: '101' },
    { onlyConflicts: 'yes' },
    { agreementFilter: 'different' },
    { sortBy: 'coder' },
    { sortDirection: 'sideways' },
    { jobDefinitionIds: '12invalid' }
  ])('rejects an invalid review query: %o', async rawQuery => {
    const query = plainToInstance(DoubleCodedReviewQueryDto, rawQuery);

    expect(await validate(query)).not.toHaveLength(0);
  });

  it('validates nested apply decisions', async () => {
    const request = plainToInstance(ApplyDoubleCodedResolutionsRequestDto, {
      decisions: [{
        responseId: '10',
        sourceUnitId: '77',
        code: '-3',
        score: '0',
        resolutionComment: ' checked '
      }]
    });

    await expect(validate(request)).resolves.toEqual([]);
    expect(request.decisions[0]).toMatchObject({
      responseId: 10,
      sourceUnitId: 77,
      code: -3,
      score: 0,
      resolutionComment: 'checked'
    });
  });

  it('rejects empty or malformed apply decisions', async () => {
    const emptyRequest = plainToInstance(ApplyDoubleCodedResolutionsRequestDto, {
      decisions: []
    });
    const malformedRequest = plainToInstance(ApplyDoubleCodedResolutionsRequestDto, {
      decisions: [{ responseId: 0, sourceUnitId: 'invalid', code: 1.5 }]
    });

    expect(await validate(emptyRequest)).not.toHaveLength(0);
    expect(await validate(malformedRequest)).not.toHaveLength(0);
  });

  it.each([
    { responseId: 10, sourceUnitId: 77 },
    {
      responseId: 10, sourceUnitId: 77, selectedJobId: 5, code: 2
    },
    {
      responseId: 10, sourceUnitId: 77, selectedJobId: null, code: null
    }
  ])('requires exactly one review selection: %o', async decision => {
    const request = plainToInstance(ApplyDoubleCodedResolutionsRequestDto, {
      decisions: [decision]
    });

    const errors = await validate(request);

    expect(errors).not.toHaveLength(0);
    expect(errors[0].children?.[0].children?.[0].constraints).toEqual({
      exactlyOneReviewSelection:
        'Exactly one of selectedJobId or code must be provided'
    });
  });

  it('accepts an existing coder result as the only review selection', async () => {
    const request = plainToInstance(ApplyDoubleCodedResolutionsRequestDto, {
      decisions: [{
        responseId: 10,
        sourceUnitId: 77,
        selectedJobId: 5
      }]
    });

    await expect(validate(request)).resolves.toEqual([]);
  });

  it('validates a draft body', async () => {
    const draft = plainToInstance(SaveDoubleCodedReviewDraftRequestDto, {
      sourceUnitId: '77',
      code: '-4',
      score: '0',
      comment: ' draft '
    });

    await expect(validate(draft)).resolves.toEqual([]);
    expect(draft).toMatchObject({
      sourceUnitId: 77,
      code: -4,
      score: 0,
      comment: 'draft'
    });
  });
});
