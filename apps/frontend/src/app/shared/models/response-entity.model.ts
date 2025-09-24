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
