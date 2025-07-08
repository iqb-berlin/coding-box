export interface CodingCategory {
  id: number;
  name: string;
  description?: string;
  code: string;
  subcategories?: CodingCategory[];
}
