import {
  Observable, catchError, map, of, switchMap, timeout
} from 'rxjs';
import type { TestResultsUploadResultDto } from '../../../../../../api-dto/files/test-results-upload-result.dto';
import type { TestPersonCodingService } from '../../coding/services/test-person-coding.service';
import {
  getSecondAutocodingFreshnessWarnings, ManualCodingCompletionOverview
} from '../../shared/utils/coding-freshness-text.util';

const RESULT_DETAILS_TIMEOUT_MS = 5000;

type ManualOverviewResult = {
  overview: ManualCodingCompletionOverview | null;
  loadFailed: boolean;
};

export type UploadCodingContext = {
  codingFreshness: TestResultsUploadResultDto['codingFreshness'] | null;
  codingFreshnessLoadFailed: boolean;
  manualOverview: ManualOverviewResult;
};

function getLatestCodingFreshness(
  completedResults: TestResultsUploadResultDto[]
): TestResultsUploadResultDto['codingFreshness'] | null {
  for (let index = completedResults.length - 1; index >= 0; index -= 1) {
    const codingFreshness = completedResults[index].codingFreshness;
    if (codingFreshness) return codingFreshness;
  }
  return null;
}

export function loadUploadCodingContext(
  codingService: TestPersonCodingService,
  workspaceId: number,
  completedResults: TestResultsUploadResultDto[],
  shouldLoadCodingFreshness: boolean
): Observable<UploadCodingContext> {
  const completedCodingFreshness = getLatestCodingFreshness(completedResults);
  const codingFreshness$ = completedCodingFreshness || !shouldLoadCodingFreshness ?
    of({ codingFreshness: completedCodingFreshness, codingFreshnessLoadFailed: false }) :
    codingService.getCodingFreshness(workspaceId, { reportErrors: true }).pipe(
      timeout(RESULT_DETAILS_TIMEOUT_MS),
      map(codingFreshness => ({ codingFreshness, codingFreshnessLoadFailed: false })),
      catchError(() => of({ codingFreshness: null, codingFreshnessLoadFailed: true }))
    );

  return codingFreshness$.pipe(
    switchMap(freshness => {
      const hasManualCodingWarning = getSecondAutocodingFreshnessWarnings(freshness.codingFreshness?.items || []).length > 0;
      const manualOverview$ = hasManualCodingWarning ?
        codingService.getAppliedResultsOverview(workspaceId).pipe(
          timeout(RESULT_DETAILS_TIMEOUT_MS),
          map(overview => ({ overview, loadFailed: overview === null })),
          catchError(() => of({ overview: null, loadFailed: true }))
        ) :
        of({ overview: null, loadFailed: false });
      return manualOverview$.pipe(map(manualOverview => ({ ...freshness, manualOverview })));
    })
  );
}
