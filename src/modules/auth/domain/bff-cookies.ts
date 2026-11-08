export const CSRF_HEADER_NAME = 'x-csrf-token';

export function readCookie(
  header: string | string[] | undefined,
  name: string,
): string | undefined {
  const source = Array.isArray(header) ? header.join(';') : header;
  if (!source) {
    return undefined;
  }

  for (const part of source.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    if (!value) {
      return undefined;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function headerValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
