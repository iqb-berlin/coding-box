import { IsNull } from 'typeorm';

export const uncodedV2Criteria = {
  status_v2: IsNull(),
  code_v2: IsNull(),
  score_v2: IsNull()
};

type ResponseV2Coding = Partial<Record<keyof typeof uncodedV2Criteria, number | string | null>>;

export function isUncodedV2Response(response: ResponseV2Coding): boolean {
  return response.status_v2 == null && response.code_v2 == null && response.score_v2 == null;
}
