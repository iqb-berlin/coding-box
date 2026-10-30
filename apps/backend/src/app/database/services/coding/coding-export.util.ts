import { PassThrough } from 'stream';
import * as ExcelJS from 'exceljs';
import { StreamingWorkbookTarget } from './coding-export.types';

export const getCurrentCodingTuplePresenceCondition = (
  responseAlias: string
): string => `(
  ${responseAlias}.autocoder_invalidated_version IS NOT NULL OR
  ${responseAlias}.code_v3 IS NOT NULL OR
  ${responseAlias}.score_v3 IS NOT NULL OR
  ${responseAlias}.code_v2 IS NOT NULL OR
  ${responseAlias}.score_v2 IS NOT NULL OR
  ${responseAlias}.code_v1 IS NOT NULL OR
  ${responseAlias}.score_v1 IS NOT NULL
)`;

export const getCurrentAutocodingCandidateCondition = (
  responseAlias: string
): string => `(
  ${responseAlias}.autocoder_invalidated_version IS NOT NULL OR
  NOT EXISTS (
    SELECT 1
    FROM coding_job_unit current_autocoding_cju
    WHERE current_autocoding_cju.response_id = ${responseAlias}.id
  )
)`;

export function createStreamingWorkbookTarget(outputFilePath?: string): StreamingWorkbookTarget {
  if (outputFilePath) {
    return {
      workbook: new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: outputFilePath,
        useStyles: true,
        useSharedStrings: false
      }),
      chunks: []
    };
  }

  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on('data', chunk => chunks.push(chunk));
  return {
    workbook: new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: true,
      useSharedStrings: false
    }),
    chunks
  };
}

export function getStreamingWorkbookBuffer(
  chunks: Buffer[],
  outputFilePath?: string
): Buffer {
  return outputFilePath ? Buffer.alloc(0) : Buffer.concat(chunks);
}

export async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}

export function isExportCancellationError(error: Error): boolean {
  return /^Export job .* was cancelled$/.test(error.message);
}

export function getByVariableWorksheetLimit(): number {
  const configuredLimit = Number.parseInt(process.env.EXPORT_MAX_WORKSHEETS || '1000', 10);
  return Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1000;
}

export function isLaterCoding(
  candidate: Date | string | null,
  existing: Date | string | null
): boolean {
  if (!candidate) return false;
  if (!existing) return true;
  return new Date(candidate).getTime() >= new Date(existing).getTime();
}

export function calculateAverageCodingTime(timestamps: Date[]): number | null {
  if (timestamps.length < 2) {
    return null;
  }

  const sortedTimestamps = [...timestamps].sort((a, b) => a.getTime() - b.getTime());

  const timeSpans: number[] = [];
  const MAX_GAP_MS = 10 * 60 * 1000; // 10 minutes in milliseconds

  for (let i = 1; i < sortedTimestamps.length; i++) {
    const timeSpan = sortedTimestamps[i].getTime() - sortedTimestamps[i - 1].getTime();

    if (timeSpan <= MAX_GAP_MS) {
      timeSpans.push(timeSpan);
    }
  }

  if (timeSpans.length === 0) {
    return null;
  }

  const totalTimeMs = timeSpans.reduce((sum, span) => sum + span, 0);
  const averageTimeMs = totalTimeMs / timeSpans.length;

  return averageTimeMs / 1000; // Convert to seconds
}
