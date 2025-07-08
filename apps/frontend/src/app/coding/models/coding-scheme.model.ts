import { CodingCategory } from './coding-category.model';

export interface CodingScheme {
  id: number;
  name: string;
  description?: string;
  categories: CodingCategory[];
}
