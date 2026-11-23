export type TestResultsUploadPhase = 'reading' | 'processing';

export interface TestResultsUploadProgressDto {
  progress: number;
  phase?: TestResultsUploadPhase;
}

export function readTestResultsUploadProgress(raw: unknown): TestResultsUploadProgressDto {
  if (typeof raw === 'number') return { progress: raw };
  const progress = raw as Partial<TestResultsUploadProgressDto> | null | undefined;
  return {
    progress: typeof progress?.progress === 'number' ? progress.progress : 0,
    ...(progress?.phase === 'reading' || progress?.phase === 'processing' ? { phase: progress.phase } : {})
  };
}
