/** Read diagnostics without assuming that a rejected value is an Error. */
export function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error &&
      typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

export function getErrorStack(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'stack' in error &&
    typeof error.stack === 'string' ? error.stack : undefined;
}

/** Stream and callback APIs require an Error, while JavaScript may throw anything. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(getErrorMessage(error));
}
