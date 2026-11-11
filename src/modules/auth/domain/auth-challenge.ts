export const SUPPORTED_CHALLENGES = [
  'NEW_PASSWORD_REQUIRED',
  'SMS_MFA',
  'SOFTWARE_TOKEN_MFA',
  'EMAIL_OTP',
  'MFA_SETUP',
] as const;

export type SupportedChallenge = (typeof SUPPORTED_CHALLENGES)[number];

export function isSupportedChallenge(
  value: string,
): value is SupportedChallenge {
  return SUPPORTED_CHALLENGES.some((challenge) => challenge === value);
}

export interface ChallengeEnvelope {
  session: string;
  username: string;
  requiredAttributes: string[];
  attempts?: number;
}
