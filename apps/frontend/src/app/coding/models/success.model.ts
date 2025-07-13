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
}
