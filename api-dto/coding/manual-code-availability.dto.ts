export interface ManualCodeAvailabilityWarningDto {
  unitName: string;
  variableId: string;
  responseCount: number;
  casesInJobs: number;
  availableCases: number;
  uniqueCasesAfterAggregation: number;
  regularCodeCount: number;
  selectableRegularCodeCount: number;
  onlySpecialOptionsAvailable: boolean;
  message: string;
}

export interface ManualCodeAvailabilityValidationDto {
  checkedVariables: number;
  warningCount: number;
  warnings: ManualCodeAvailabilityWarningDto[];
}
