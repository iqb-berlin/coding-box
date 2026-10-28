import { Variable } from '../../models/coding-job.model';

/** Availability with and without an explicit derive-error opt-in. */
export class JobVariableCasePolicy {
  constructor(private readonly includeDeriveError: boolean) {}

  getVariableEffectiveCases(variable: Variable): number {
    if (this.shouldUseDeriveErrorAvailability(variable)) {
      return this.getVariableEffectiveCasesWithDeriveError(variable);
    }

    return this.getVariableRegularEffectiveCases(variable);
  }

  getVariableRegularEffectiveCases(variable: Variable): number {
    return variable.uniqueCasesAfterAggregation ?? variable.responseCount ?? variable.availableCases ?? 0;
  }

  getVariableEffectiveCasesWithDeriveError(variable: Variable): number {
    return variable.uniqueCasesAfterAggregationWithDeriveError ??
      Math.max(
        this.getVariableRegularEffectiveCases(variable),
        variable.availableCasesWithDeriveError ?? 0
      );
  }

  getVariableAvailableCases(variable: Variable): number {
    if (this.shouldUseDeriveErrorAvailability(variable)) {
      return variable.availableCasesWithDeriveError ??
        this.getVariableRegularAvailableCases(variable);
    }

    return this.getVariableRegularAvailableCases(variable);
  }

  getVariableRegularAvailableCases(variable: Variable): number {
    return variable.availableCases ?? this.getVariableRegularEffectiveCases(variable);
  }

  getVariableSelectableAvailableCases(variable: Variable): number {
    const regularAvailable = this.getVariableRegularAvailableCases(variable);

    if (this.includeDeriveError && this.hasDeriveErrorResponses(variable)) {
      return Math.max(
        regularAvailable,
        variable.availableCasesWithDeriveError ?? regularAvailable
      );
    }

    return regularAvailable;
  }

  requiresExplicitDeriveErrorSelection(variable: Variable): boolean {
    return this.includeDeriveError &&
      this.hasDeriveErrorResponses(variable) &&
      variable.includeDeriveError !== true &&
      this.getVariableRegularAvailableCases(variable) === 0 &&
      (variable.availableCasesWithDeriveError ?? 0) > 0;
  }

  getVariableSelectableEffectiveCases(variable: Variable): number {
    const regularEffective = this.getVariableRegularEffectiveCases(variable);

    if (this.includeDeriveError && this.hasDeriveErrorResponses(variable)) {
      return Math.max(
        regularEffective,
        this.getVariableEffectiveCasesWithDeriveError(variable)
      );
    }

    return regularEffective;
  }

  shouldUseDeriveErrorAvailability(variable: Variable): boolean {
    return this.includeDeriveError &&
      variable.includeDeriveError === true &&
      this.hasDeriveErrorResponses(variable);
  }

  hasDeriveErrorResponses(variable: Variable): boolean {
    return this.includeDeriveError &&
      ((variable.deriveErrorResponseCount ?? 0) > 0 || variable.includeDeriveError === true);
  }
}
