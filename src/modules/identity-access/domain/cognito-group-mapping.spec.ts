import {
  COGNITO_GROUP_TECHNICAL_SPECIALIST,
  COGNITO_GROUP_VALIDATOR,
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

  it('returns no roles when the claim is missing or not a list of groups', () => {
    expect(mapCognitoGroupsToRoles(undefined)).toEqual([]);
    expect(mapCognitoGroupsToRoles('ESPECIALISTA_TECNICO')).toEqual([]);
    expect(mapCognitoGroupsToRoles([1, null])).toEqual([]);
  });
});
