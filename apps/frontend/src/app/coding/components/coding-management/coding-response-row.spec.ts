import { SearchResponseItem } from '../../../models/coding-interfaces';
import { codingResponseRow } from './coding-response-row';

describe('coding response row', () => {
  it('preserves zero coding results and source identity in the table projection', () => {
    const item = {
      responseId: 2, unitId: 3, unitName: 'U', variableId: 'v', value: 'answer', code: 0, score: 0, code_v1: 0, status_v1: 'CODING_COMPLETE', personLogin: 'login', personCode: 'code', personGroup: 'group'
    } as SearchResponseItem;
    expect(codingResponseRow(item)).toMatchObject({
      id: 2, unitid: 3, variableid: 'v', code: '0', score: '0', code_v1: 0, status_v1: 'CODING_COMPLETE', login_name: 'login', person_code: 'code', person_group: 'group', isGeoGebraValue: false
    });
  });
});
