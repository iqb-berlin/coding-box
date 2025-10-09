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
  coded_code_v1?: number;
  coded_score_v1?: number;
  coded_status_v2?: string;
  coded_code_v2?: number;
  coded_score_v2?: number;
  coded_status_v3?: string;
  coded_code_v3?: number;
  coded_score_v3?: number;
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
