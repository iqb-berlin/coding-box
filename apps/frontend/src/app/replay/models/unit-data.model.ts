import { PageData } from './page-data.model';
import { ResponseData } from './response-data.model';

export interface UnitData {
  id: string;
  title: string;
  pages: PageData[];
  responses: ResponseData[];
}
