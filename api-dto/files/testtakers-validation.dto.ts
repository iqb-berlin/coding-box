export interface TestTakerLoginDto {
  group: string;
  login: string;
  mode: string;
  bookletCodes: string[];
}

export interface MissingPersonDto {
  group: string;
  login: string;
  code: string;
  reason: string;
}

export interface TestTakersValidationDto {
  testTakersFound: boolean;
  totalGroups: number;
  totalLogins: number;
  totalBookletCodes: number;
  missingPersons: MissingPersonDto[];
}
