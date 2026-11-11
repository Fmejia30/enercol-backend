import type { UserRole } from '../../identity-access/domain/user-role.js';
import type { CognitoGlobalSignOutResult } from '../domain/user-administration.js';
import {
  USER_DISABLED_AUDIT_ACTION,
  USER_ENABLED_AUDIT_ACTION,
  USER_PROFILE_SELF_UPDATED_AUDIT_ACTION,
  USER_PROFILE_UPDATED_AUDIT_ACTION,
  USER_ROLES_UPDATED_AUDIT_ACTION,
} from '../domain/user-administration.js';

export interface ProfileSnapshot {
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

export interface ProfileUpdatedAudit {
  action: typeof USER_PROFILE_UPDATED_AUDIT_ACTION;
  actorSub: string;
  targetSub: string;
  metadata: {
    before: ProfileSnapshot | null;
    after: ProfileSnapshot;
  };
}

export type ProfileField = 'firstName' | 'lastName' | 'phoneNumber';

export interface SelfProfileUpdatedAudit {
  action: typeof USER_PROFILE_SELF_UPDATED_AUDIT_ACTION;
  actorSub: string;
  targetSub: string;
  metadata: {
    changedFields: ProfileField[];
    before: Partial<ProfileSnapshot> | null;
    after: Partial<ProfileSnapshot>;
  };
}

export interface RolesUpdatedAudit {
  action: typeof USER_ROLES_UPDATED_AUDIT_ACTION;
  actorSub: string;
  targetSub: string;
  metadata: {
    before: UserRole[];
    after: UserRole[];
  };
}

export interface StatusChangedAudit {
  action: typeof USER_DISABLED_AUDIT_ACTION | typeof USER_ENABLED_AUDIT_ACTION;
  actorSub: string;
  targetSub: string;
  metadata: {
    enabled: boolean;
    cognitoGlobalSignOut: CognitoGlobalSignOutResult;
  };
}

export type AdministrationAudit =
  | ProfileUpdatedAudit
  | SelfProfileUpdatedAudit
  | RolesUpdatedAudit
  | StatusChangedAudit;

export type ProfileWrite =
  | ({ mode: 'create' } & ProfileSnapshot)
  | {
      mode: 'update';
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
    };

export interface UserAdministrationChange {
  targetSub: string;
  profile: ProfileWrite | null;
  audits: readonly AdministrationAudit[];
}

export interface RoleCompensationIntervention {
  actorSub: string;
  targetSub: string;
  added: readonly string[];
  removed: readonly string[];
}

export interface UserAdministrationRepository {
  saveChanges(change: UserAdministrationChange): Promise<void>;
  recordIntervention(intervention: RoleCompensationIntervention): Promise<void>;
}

export const USER_ADMINISTRATION_REPOSITORY = Symbol(
  'USER_ADMINISTRATION_REPOSITORY',
);
