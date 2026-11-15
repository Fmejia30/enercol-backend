export const SENSITIVE_CATEGORIES = [
  'person',
  'phone',
  'email',
  'address',
  'personal-id',
  'personal-nit',
  'customer',
  'tax-id',
  'customer-account',
  'contract',
  'installation',
  'meter',
  'ticket',
  'request',
  'external-reference',
] as const;

export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

const TOKEN_PREFIX: Record<SensitiveCategory, string> = {
  person: 'PERSON',
  phone: 'PHONE',
  email: 'EMAIL',
  address: 'ADDRESS',
  'personal-id': 'PERSONAL_ID',
  'personal-nit': 'PERSONAL_NIT',
  customer: 'CUSTOMER',
  'tax-id': 'TAX_ID',
  'customer-account': 'CUSTOMER_ACCOUNT',
  contract: 'CONTRACT',
  installation: 'INSTALLATION',
  meter: 'METER',
  ticket: 'TICKET',
  request: 'REQUEST',
  'external-reference': 'EXTERNAL_REF',
};

export const TOKEN_PREFIXES = Object.values(TOKEN_PREFIX);

const TOKEN_BODY = '[A-Za-z0-9_-]{24}';
const PREFIX_GROUP = TOKEN_PREFIXES.join('|');

export function wellFormedTokenPattern(): RegExp {
  return new RegExp(`\\[(?:${PREFIX_GROUP})_${TOKEN_BODY}\\]`, 'g');
}

export function tokenLookalikePattern(): RegExp {
  return new RegExp(`\\[(?:${PREFIX_GROUP})_[^\\]]*\\]`, 'g');
}

export function prefixFor(category: SensitiveCategory): string {
  return TOKEN_PREFIX[category];
}

export function isSensitiveCategory(value: string): value is SensitiveCategory {
  return (SENSITIVE_CATEGORIES as readonly string[]).includes(value);
}
