/**
 * Common utility functions that can be used across the application
 */

/**
 * Formats a date to a string in the format "DD.MM.YYYY HH:MM:SS"
 * @param date The date to format
 * @returns The formatted date string
 */
export function formatDate(date: Date): string {
  if (!date) return '';

  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Truncates a string to a specified length and adds an ellipsis if truncated
 * @param str The string to truncate
 * @param maxLength The maximum length of the string
 * @returns The truncated string
 */
export function truncateString(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;

  return `${str.substring(0, maxLength)}...`;
}

/**
 * Generates a random string of a specified length
 * @param length The length of the random string
 * @returns The random string
 */
export function generateRandomString(length: number): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters.charAt(randomIndex);
  }

  return result;
}

/**
 * Debounces a function to prevent it from being called too frequently
 * @param func The function to debounce
 * @param wait The time to wait before calling the function
 * @returns The debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | null = null;

  return function debouncedFunction(...args: Parameters<T>): void {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout !== null) {
      clearTimeout(timeout);
    }

    timeout = window.setTimeout(later, wait) as unknown as number;
  };
}

/**
 * Checks if a value is null or undefined
 * @param value The value to check
 * @returns True if the value is null or undefined, false otherwise
 */
export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Decodes a base64 string to a UTF-8 string, correctly handling multibyte characters like Umlauts.
 * @param base64 The base64 string to decode
 * @returns The decoded UTF-8 string
 */
export function base64ToUtf8(base64: string): string {
  if (!base64) return '';
  try {
    // atob() decodes base64 to a "binary" string (one byte per character).
    // TextEncoder/Decoder or decodeURIComponent(escape()) are common ways to convert this to UTF-8.
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to decode base64 to UTF-8:', e);
    // Fallback to atob if everything else fails
    try {
      return atob(base64);
    } catch (atobError) {
      return base64;
    }
  }
}

/**
 * Encodes a UTF-8 string to a base64 string, correctly handling multibyte characters like Umlauts.
 * @param str The string to encode
 * @returns The base64 encoded string
 */
export function utf8ToBase64(str: string): string {
  if (!str) return '';
  try {
    const bytes = new TextEncoder().encode(str);
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
      binaryString += String.fromCharCode(bytes[i]);
    }
    return btoa(binaryString);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to encode UTF-8 to base64:', e);
    // Fallback to btoa if everything else fails
    try {
      return btoa(str);
    } catch (btoaError) {
      return str;
    }
  }
}
