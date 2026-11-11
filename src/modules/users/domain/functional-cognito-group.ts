import {
  COGNITO_GROUP_ADMINISTRATOR,
  COGNITO_GROUP_TECHNICAL_SPECIALIST,
  COGNITO_GROUP_VALIDATOR,
} from '../../identity-access/domain/cognito-group-mapping.js';

export const FUNCTIONAL_COGNITO_GROUPS = [
  COGNITO_GROUP_TECHNICAL_SPECIALIST,
  COGNITO_GROUP_VALIDATOR,
  COGNITO_GROUP_ADMINISTRATOR,
] as const;

export type FunctionalCognitoGroup = (typeof FUNCTIONAL_COGNITO_GROUPS)[number];

export function isFunctionalCognitoGroup(
  group: string,
): group is FunctionalCognitoGroup {
  return (FUNCTIONAL_COGNITO_GROUPS as readonly string[]).includes(group);
}
