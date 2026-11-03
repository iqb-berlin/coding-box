import { Success } from '../../models/success.model';
import { SearchResponseItem } from '../../../models/coding-interfaces';
import { extractGeoGebraBase64 } from '../../utils/geogebra-value.util';

export function codingResponseRow(item: SearchResponseItem): Success {
  const geoGebraBase64 = extractGeoGebraBase64(item.value);
  return {
    id: item.responseId,
    unitid: item.unitId,
    variableid: item.variableId || '',
    status: item.status || '',
    value: item.value || '',
    isGeoGebraValue: !!geoGebraBase64,
    geoGebraBase64,
    subform: '',
    code: item.code?.toString() || null,
    score: item.score?.toString() || null,
    unit: { name: item.unitName },
    codedstatus: item.codedStatus || '',
    unitname: item.unitName || '',
    login_name: item.personLogin || '',
    login_group: item.personGroup || '',
    login_code: item.personCode || '',
    booklet_id: item.bookletName || '',
    person_code: item.personCode || '',
    person_group: item.personGroup || '',
    variable_page: item.variablePage || '0',
    code_v1: item.code_v1,
    code_v2: item.code_v2,
    code_v3: item.code_v3,
    status_v1: item.status_v1,
    status_v2: item.status_v2,
    status_v3: item.status_v3
  };
}
