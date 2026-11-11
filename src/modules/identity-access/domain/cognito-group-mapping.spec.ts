import {
  COGNITO_GROUP_ADMINISTRATOR,
  COGNITO_GROUP_TECHNICAL_SPECIALIST,
  COGNITO_GROUP_VALIDATOR,
  cognitoGroupForRole,
  mapCognitoGroupsToRoles,
} from './cognito-group-mapping.js';
import { UserRole } from './user-role.js';

describe('mapCognitoGroupsToRoles', () => {
  it('maps ESPECIALISTA_TECNICO to the specialist role', () => {
    expect(
      mapCognitoGroupsToRoles([COGNITO_GROUP_TECHNICAL_SPECIALIST]),
    ).toEqual([UserRole.SPECIALIST]);
  });

  it('maps ESPECIALISTA_VALIDADOR to the validator role', () => {
    expect(mapCognitoGroupsToRoles([COGNITO_GROUP_VALIDATOR])).toEqual([
      UserRole.VALIDATOR,
    ]);
  });

  it('maps ADMINISTRADOR to the administrator role', () => {
    expect(mapCognitoGroupsToRoles([COGNITO_GROUP_ADMINISTRATOR])).toEqual([
      UserRole.ADMINISTRATOR,
    ]);
  });

  it('keeps the specialist and administrator roles together', () => {
    expect(
      mapCognitoGroupsToRoles([
        COGNITO_GROUP_ADMINISTRATOR,
        COGNITO_GROUP_TECHNICAL_SPECIALIST,
      ]),
    ).toEqual([UserRole.SPECIALIST, UserRole.ADMINISTRATOR]);
  });

  it('keeps both roles when the token contains the two EnerCol groups', () => {
    expect(
      mapCognitoGroupsToRoles([
        COGNITO_GROUP_VALIDATOR,
        COGNITO_GROUP_TECHNICAL_SPECIALIST,
      ]),
    ).toEqual([UserRole.SPECIALIST, UserRole.VALIDATOR]);
  });

  it('maps the EnerCol groups and ignores unknown groups', () => {
    expect(
      mapCognitoGroupsToRoles([
        'OTRO_GRUPO',
        COGNITO_GROUP_VALIDATOR,
        COGNITO_GROUP_TECHNICAL_SPECIALIST,
        COGNITO_GROUP_TECHNICAL_SPECIALIST,
      ]),
    ).toEqual([UserRole.SPECIALIST, UserRole.VALIDATOR]);
  });

  it('grants no role for an unknown group', () => {
    expect(mapCognitoGroupsToRoles(['GRUPO_DESCONOCIDO'])).toEqual([]);
  });

  it('returns no roles when the claim is missing or not a list of groups', () => {
    expect(mapCognitoGroupsToRoles(undefined)).toEqual([]);
    expect(mapCognitoGroupsToRoles('ESPECIALISTA_TECNICO')).toEqual([]);
    expect(mapCognitoGroupsToRoles([1, null])).toEqual([]);
  });

  it('maps each recognized role back to its Cognito group', () => {
    expect(cognitoGroupForRole(UserRole.SPECIALIST)).toBe(
      COGNITO_GROUP_TECHNICAL_SPECIALIST,
    );
    expect(cognitoGroupForRole(UserRole.VALIDATOR)).toBe(
      COGNITO_GROUP_VALIDATOR,
    );
    expect(cognitoGroupForRole(UserRole.ADMINISTRATOR)).toBe(
      COGNITO_GROUP_ADMINISTRATOR,
    );
  });
});
