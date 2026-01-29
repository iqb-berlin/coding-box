export interface Success {
  id: number;
  unitid: number;
  variableid: string;
  status: string;
  value: string;
  subform: string;
  code: string | null;
  score: string | null;
  codedstatus: string;
  unitname: string;
  login_name?: string;
  login_code?: string;
  login_group?: string;
  booklet_id?: string;
  codingSchemeRef?: string;
  variable_page?: string;
  person_code?: string;
  person_group?: string;
  code_v1?: number | null;
  code_v2?: number | null;
  code_v3?: number | null;
  status_v1?: string;
  status_v2?: string;
  status_v3?: string;
}
