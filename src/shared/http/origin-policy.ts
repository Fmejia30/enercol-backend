export interface CsrfOriginFallback {
  headerPresent: boolean;
  sessionPresent: boolean;
}

export function isDevelopmentNodeEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development';
}

export function isCookieOriginAllowed(input: {
  nodeEnv: string | undefined;
  origin: string | undefined;
  frontendOrigin: string;
  csrfFallback?: CsrfOriginFallback;
}): boolean {
  if (isDevelopmentNodeEnv(input.nodeEnv)) {
    return true;
  }
  if (input.origin === input.frontendOrigin) {
    return true;
  }
  return (
    !input.origin &&
    input.csrfFallback?.headerPresent === true &&
    input.csrfFallback.sessionPresent === true
  );
}

export function corsOrigin(
  nodeEnv: string | undefined,
  frontendOrigin: string,
): true | string {
  if (isDevelopmentNodeEnv(nodeEnv)) {
    return true;
  }
  return frontendOrigin;
}
