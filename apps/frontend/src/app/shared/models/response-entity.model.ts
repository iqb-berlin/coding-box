export interface ResponseEntity {
  id: number;
  unitId: number;
  variableid: string;
  status: string;
  value: string;
  subform: string;
  code: number;
  score: number;
  codedstatus: string;
  status_v1?: string;
  code_v1?: number;
  score_v1?: number;
  status_v2?: string;
  code_v2?: number;
  score_v2?: number;
  status_v3?: string;
  code_v3?: number;
  score_v3?: number;
  unit?: {
    name: string;
    alias: string;
    booklet?: {
      person?: {
        login: string;
        code: string;
      };
      bookletinfo?: {
        name: string;
      };
    };
  };
}
