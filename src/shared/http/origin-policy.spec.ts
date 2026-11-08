import { corsOrigin, isCookieOriginAllowed } from './origin-policy.js';

const FRONTEND = 'http://localhost:5173';

describe('origin policy', () => {
  it('allows any origin and a missing origin only in development', () => {
    expect(
      isCookieOriginAllowed({
        nodeEnv: 'development',
        origin: 'http://localhost:4173',
        frontendOrigin: FRONTEND,
      }),
    ).toBe(true);
    expect(
      isCookieOriginAllowed({
        nodeEnv: 'development',
        origin: undefined,
        frontendOrigin: FRONTEND,
      }),
    ).toBe(true);
  });

  it('keeps production and every other environment on the configured origin', () => {
    for (const nodeEnv of ['production', 'test', undefined, 'Development']) {
      expect(
        isCookieOriginAllowed({
          nodeEnv,
          origin: FRONTEND,
          frontendOrigin: FRONTEND,
        }),
      ).toBe(true);
      expect(
        isCookieOriginAllowed({
          nodeEnv,
          origin: 'https://evil.example',
          frontendOrigin: FRONTEND,
        }),
      ).toBe(false);
      expect(
        isCookieOriginAllowed({
          nodeEnv,
          origin: undefined,
          frontendOrigin: FRONTEND,
        }),
      ).toBe(false);
    }
  });

  it('lets a missing production origin reach the existing CSRF check only when a session and header are present', () => {
    expect(
      isCookieOriginAllowed({
        nodeEnv: 'production',
        origin: undefined,
        frontendOrigin: FRONTEND,
        csrfFallback: { headerPresent: true, sessionPresent: true },
      }),
    ).toBe(true);
    expect(
      isCookieOriginAllowed({
        nodeEnv: 'production',
        origin: 'https://evil.example',
        frontendOrigin: FRONTEND,
        csrfFallback: { headerPresent: true, sessionPresent: true },
      }),
    ).toBe(false);
    expect(
      isCookieOriginAllowed({
        nodeEnv: 'production',
        origin: undefined,
        frontendOrigin: FRONTEND,
        csrfFallback: { headerPresent: false, sessionPresent: true },
      }),
    ).toBe(false);
  });

  it('reflects the request origin in development and never uses a wildcard', () => {
    expect(corsOrigin('development', FRONTEND)).toBe(true);
    expect(corsOrigin('production', FRONTEND)).toBe(FRONTEND);
    expect(corsOrigin('test', FRONTEND)).toBe(FRONTEND);
    expect(corsOrigin(undefined, FRONTEND)).toBe(FRONTEND);
    expect(corsOrigin('production', FRONTEND)).not.toBe('*');
  });
});
