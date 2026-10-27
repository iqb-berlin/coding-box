import { Injectable, signal } from '@angular/core';

/** Presentation state survives tab changes; workflow data stays in the domain facades. */
@Injectable()
export class ManualCodingViewState {
  readonly showEmptyResponsesDetails = signal(false);
  readonly showDuplicateValuesDetails = signal(false);
  readonly showProgressInfo = signal(false);
  readonly showTotalDetails = signal(false);
  readonly showVariableCoverageInfo = signal(false);
  readonly showAppliedResultsInfo = signal(false);
  readonly showCaseCoverageInfo = signal(false);
}
