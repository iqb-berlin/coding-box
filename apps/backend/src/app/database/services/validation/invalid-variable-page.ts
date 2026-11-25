import { InvalidVariableDto } from '../../../../../../../api-dto/files/variable-validation.dto';

export class InvalidVariablePage {
  readonly data: InvalidVariableDto[] = [];
  readonly page: number;
  readonly limit: number;
  private readonly startIndex: number;
  total = 0;

  constructor(page: number, limit: number) {
    this.page = Math.max(1, page);
    this.limit = limit === Number.MAX_SAFE_INTEGER ?
      limit : Math.min(Math.max(1, limit), 1000);
    this.startIndex = (this.page - 1) * this.limit;
  }

  add(issue: InvalidVariableDto): void {
    if (this.total >= this.startIndex && this.data.length < this.limit) {
      this.data.push(issue);
    }
    this.total += 1;
  }
}
