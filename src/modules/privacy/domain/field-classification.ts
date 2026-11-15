import type { SensitiveCategory } from './sensitive-category.js';

const FIELD_CATEGORIES: Record<string, SensitiveCategory> = {
  firstName: 'person',
  lastName: 'person',
  fullName: 'person',
  customerName: 'customer',
  legalName: 'customer',
  businessName: 'customer',
  customerId: 'customer-account',
  accountId: 'customer-account',
  customerAccountId: 'customer-account',
  facilityName: 'installation',
  installationId: 'installation',
  installationName: 'installation',
  assetId: 'meter',
  meterId: 'meter',
  meterIdentifier: 'meter',
  ticketCode: 'ticket',
  ticketId: 'ticket',
  requestId: 'request',
  contractId: 'contract',
  contractCode: 'contract',
  personalNit: 'personal-nit',
  nit: 'tax-id',
  taxId: 'tax-id',
  businessTaxId: 'tax-id',
  dpi: 'personal-id',
  personalId: 'personal-id',
  documentNumber: 'personal-id',
  phoneNumber: 'phone',
  phone: 'phone',
  email: 'email',
  address: 'address',
  physicalAddress: 'address',
  externalReference: 'external-reference',
  externalId: 'external-reference',
  externalSystemReference: 'external-reference',
};

const EXCLUDED_FIELDS = new Set([
  'assignedSpecialistSub',
  'executedBySub',
  'cognitoSub',
  'userId',
  'sessionId',
  'accessToken',
  'refreshToken',
  'idToken',
  'csrfToken',
  'password',
  'clientSecret',
  'authorization',
  'cookie',
]);

const TECHNICAL_FIELDS = new Set([
  'demandThreshold',
  'demandUnit',
  'evaluationConsumption',
  'consumptionUnit',
  'measuredDemand',
  'consumption',
  'measuredValue',
  'referenceValue',
  'difference',
  'percentage',
  'unit',
  'value',
  'measuredAt',
  'executedAt',
  'createdAt',
  'updatedAt',
  'periodStart',
  'periodEnd',
  'findingType',
  'interpretation',
  'status',
  'type',
  'requestType',
  'sourceKind',
]);

export function classifyField(key: string): SensitiveCategory | null {
  return FIELD_CATEGORIES[key] ?? null;
}

export function isExcludedField(key: string): boolean {
  return EXCLUDED_FIELDS.has(key);
}

export function isTechnicalField(key: string): boolean {
  return TECHNICAL_FIELDS.has(key);
}
