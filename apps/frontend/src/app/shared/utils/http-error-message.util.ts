/** Prefer a backend error message, including validation errors, over the UI fallback. */
export function extractHttpErrorMessage(error: unknown, fallback: string): string {
  const payload = error as {
    error?: { message?: string | string[] };
    message?: string;
  } | null;

  if (Array.isArray(payload?.error?.message)) return payload.error.message.join(', ');
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
}
