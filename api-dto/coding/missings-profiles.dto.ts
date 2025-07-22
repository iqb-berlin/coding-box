export interface MissingDto {
  id: string;
  label: string;
  description: string;
  code: number;
}

export class MissingsProfilesDto {
  id?: number;
  label!: string;
  missings!: string;

  parseMissings(): MissingDto[] {
    try {
      if (!this.missings) {
        return [];
      }

      if (Array.isArray(this.missings)) {
        return this.missings as unknown as MissingDto[];
      }

      if (typeof this.missings === 'string') {
        const parsed = JSON.parse(this.missings);
        return Array.isArray(parsed) ? parsed : [];
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  setMissings(missings: MissingDto[]): void {
    if (typeof missings === 'string') {
      this.missings = missings;
    } else {
      this.missings = JSON.stringify(missings);
    }
  }
}
