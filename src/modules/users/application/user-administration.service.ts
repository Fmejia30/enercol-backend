import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import {
  cognitoGroupForRole,
  mapCognitoGroupsToRoles,
  sortRecognizedRoles,
} from '../../identity-access/domain/cognito-group-mapping.js';
import {
  isUserRole,
  type UserRole,
} from '../../identity-access/domain/user-role.js';
import { CognitoAdminError } from '../domain/cognito-admin-error.js';
import {
  FUNCTIONAL_COGNITO_GROUPS,
  isFunctionalCognitoGroup,
  type FunctionalCognitoGroup,
} from '../domain/functional-cognito-group.js';
import {
  USER_DISABLED_AUDIT_ACTION,
  USER_ENABLED_AUDIT_ACTION,
  USER_NAME_PATTERN,
  USER_PHONE_PATTERN,
  USER_PROFILE_UPDATED_AUDIT_ACTION,
  USER_ROLES_UPDATED_AUDIT_ACTION,
  UserAdministrationFailedError,
  UserAdministrationForbiddenError,
  UserAdministrationNotFoundError,
  UserAdministrationQueryError,
  type CognitoGlobalSignOutResult,
} from '../domain/user-administration.js';
import {
  COGNITO_USER_ADMIN,
  type CognitoManagedUser,
  type CognitoUserAdmin,
} from './cognito-user-admin.js';
import type { DirectoryUserDetail } from './user-directory.service.js';
import { UserDirectoryService } from './user-directory.service.js';
import {
  USER_DIRECTORY_REPOSITORY,
  type DirectoryProfile,
  type UserDirectoryRepository,
} from './user-directory.repository.js';
import {
  USER_ADMINISTRATION_REPOSITORY,
  type AdministrationAudit,
  type ProfileSnapshot,
  type ProfileWrite,
  type UserAdministrationRepository,
} from './user-administration.repository.js';

export interface UpdateUserCommand {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  roles?: readonly string[];
}

interface PersonalInput {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
}

interface RoleChange {
  before: UserRole[];
  after: UserRole[];
  added: FunctionalCognitoGroup[];
  removed: FunctionalCognitoGroup[];
}

@Injectable()
export class UserAdministrationService {
  private readonly logger = new Logger(UserAdministrationService.name);

  constructor(
    @Inject(COGNITO_USER_ADMIN)
    private readonly cognito: CognitoUserAdmin,
    @Inject(USER_DIRECTORY_REPOSITORY)
    private readonly profiles: UserDirectoryRepository,
    @Inject(USER_ADMINISTRATION_REPOSITORY)
    private readonly administration: UserAdministrationRepository,
    private readonly directory: UserDirectoryService,
  ) {}

  async update(
    actor: AuthenticatedUser,
    id: string,
    command: UpdateUserCommand,
  ): Promise<DirectoryUserDetail> {
    const actorSub = requireActor(actor);
    const targetSub = requireTarget(id);
    const personal = personalFields(command);
    const roles =
      command.roles === undefined ? undefined : normalizeRoles(command.roles);
    if (!personal && roles === undefined) {
      throw new UserAdministrationQueryError();
    }

    const user = await this.loadUser(targetSub);
    const existing = await this.loadProfile(user.sub);
    const profile = profileWrite(existing, personal);
    const roleChange =
      roles === undefined ? null : await this.applyRoles(actorSub, user, roles);

    try {
      await this.administration.saveChanges({
        targetSub: user.sub,
        profile,
        audits: updateAudits(
          actorSub,
          user.sub,
          existing,
          profile,
          roleChange,
        ),
      });
    } catch (error) {
      if (roleChange && roleChange.added.length + roleChange.removed.length > 0) {
        await this.revertGroups(
          actorSub,
          user,
          roleChange.added,
          roleChange.removed,
        );
      }
      throw this.failed(error);
    }

    return this.directory.getBySub(user.sub);
  }

  async setStatus(
    actor: AuthenticatedUser,
    id: string,
    enabled: boolean,
  ): Promise<DirectoryUserDetail> {
    const actorSub = requireActor(actor);
    const targetSub = requireTarget(id);
    if (typeof enabled !== 'boolean') {
      throw new UserAdministrationQueryError();
    }
    if (!enabled && actorSub === targetSub) {
      throw new UserAdministrationForbiddenError();
    }

    const user = await this.loadUser(targetSub);
    const cognitoGlobalSignOut = await this.applyStatus(user, enabled);
    try {
      await this.administration.saveChanges({
        targetSub: user.sub,
        profile: null,
        audits: [
          {
            action: enabled
              ? USER_ENABLED_AUDIT_ACTION
              : USER_DISABLED_AUDIT_ACTION,
            actorSub,
            targetSub: user.sub,
            metadata: { enabled, cognitoGlobalSignOut },
          },
        ],
      });
    } catch (error) {
      this.logger.error(
        'User status change was applied but the audit record failed',
      );
      throw this.failed(error);
    }

    return this.directory.getBySub(user.sub);
  }

  private async loadUser(sub: string): Promise<CognitoManagedUser> {
    try {
      return await this.cognito.getUserBySub(sub);
    } catch (error) {
      if (error instanceof CognitoAdminError && error.code === 'user_not_found') {
        throw new UserAdministrationNotFoundError();
      }
      if (error instanceof CognitoAdminError && error.code === 'configuration') {
        throw new UserAdministrationQueryError();
      }
      throw this.failed(error);
    }
  }

  private async loadProfile(sub: string): Promise<DirectoryProfile | null> {
    try {
      const profiles = await this.profiles.findProfiles([sub]);
      return profiles.find((profile) => profile.cognitoSub === sub) ?? null;
    } catch (error) {
      throw this.failed(error);
    }
  }

  private async applyRoles(
    actorSub: string,
    user: CognitoManagedUser,
    roles: readonly UserRole[],
  ): Promise<RoleChange> {
    let current: FunctionalCognitoGroup[];
    try {
      current = (await this.cognito.listGroups(user.username)).filter((group) =>
        isFunctionalCognitoGroup(group),
      );
    } catch (error) {
      throw this.failed(error);
    }

    const desired = new Set(roles.map((role) => cognitoGroupForRole(role)));
    const present = new Set(current);
    const toAdd = FUNCTIONAL_COGNITO_GROUPS.filter(
      (group) => desired.has(group) && !present.has(group),
    );
    const toRemove = FUNCTIONAL_COGNITO_GROUPS.filter(
      (group) => present.has(group) && !desired.has(group),
    );
    const added: FunctionalCognitoGroup[] = [];
    const removed: FunctionalCognitoGroup[] = [];
    try {
      for (const group of toAdd) {
        await this.cognito.addToGroup(user.username, group);
        added.push(group);
      }
      for (const group of toRemove) {
        await this.cognito.removeFromGroup(user.username, group);
        removed.push(group);
      }
    } catch (error) {
      await this.revertGroups(actorSub, user, added, removed);
      throw this.failed(error);
    }

    return {
      before: mapCognitoGroupsToRoles(current),
      after: [...roles],
      added,
      removed,
    };
  }

  private async applyStatus(
    user: CognitoManagedUser,
    enabled: boolean,
  ): Promise<CognitoGlobalSignOutResult> {
    try {
      if (enabled) {
        await this.cognito.enableUser(user.username);
        return 'not_requested';
      }
      await this.cognito.disableUser(user.username);
    } catch (error) {
      throw this.failed(error);
    }

    try {
      await this.cognito.signOutUser(user.username);
      return 'completed';
    } catch (error) {
      this.logger.error(
        `Cognito global sign-out failed (${safeFailureName(error)})`,
      );
      return 'failed';
    }
  }

  private async revertGroups(
    actorSub: string,
    user: CognitoManagedUser,
    added: readonly FunctionalCognitoGroup[],
    removed: readonly FunctionalCognitoGroup[],
  ): Promise<void> {
    if (added.length === 0 && removed.length === 0) {
      return;
    }
    try {
      for (const group of [...removed].reverse()) {
        await this.cognito.addToGroup(user.username, group);
      }
      for (const group of [...added].reverse()) {
        await this.cognito.removeFromGroup(user.username, group);
      }
    } catch {
      this.logger.error(
        'User role compensation failed; administrative intervention required',
      );
      try {
        await this.administration.recordIntervention({
          actorSub,
          targetSub: user.sub,
          added,
          removed,
        });
      } catch {
        this.logger.error(
          'Could not record that the role change requires administrative intervention',
        );
      }
    }
  }

  private failed(error: unknown): UserAdministrationFailedError {
    if (error instanceof UserAdministrationFailedError) {
      return error;
    }
    this.logger.error(`User administration failed (${safeFailureName(error)})`);
    return new UserAdministrationFailedError();
  }
}

function personalFields(command: UpdateUserCommand): PersonalInput | null {
  const firstName = text(command.firstName, USER_NAME_PATTERN);
  const lastName = text(command.lastName, USER_NAME_PATTERN);
  const phoneNumber = text(command.phoneNumber, USER_PHONE_PATTERN);
  if (
    firstName === undefined &&
    lastName === undefined &&
    phoneNumber === undefined
  ) {
    return null;
  }
  return { firstName, lastName, phoneNumber };
}

function text(value: string | undefined, pattern: RegExp): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new UserAdministrationQueryError();
  }
  const normalized = value.trim();
  if (!pattern.test(normalized)) {
    throw new UserAdministrationQueryError();
  }
  return normalized;
}

function normalizeRoles(values: readonly string[]): UserRole[] {
  if (!Array.isArray(values)) {
    throw new UserAdministrationQueryError();
  }
  if (values.some((role) => typeof role !== 'string' || !isUserRole(role))) {
    throw new UserAdministrationQueryError();
  }
  return sortRecognizedRoles(values);
}

function profileWrite(
  existing: DirectoryProfile | null,
  personal: PersonalInput | null,
): ProfileWrite | null {
  if (!personal) {
    return null;
  }
  if (!existing) {
    if (!personal.firstName || !personal.lastName || !personal.phoneNumber) {
      throw new UserAdministrationQueryError('profile_incomplete');
    }
    return {
      mode: 'create',
      firstName: personal.firstName,
      lastName: personal.lastName,
      phoneNumber: personal.phoneNumber,
    };
  }
  return {
    mode: 'update',
    firstName: personal.firstName,
    lastName: personal.lastName,
    phoneNumber: personal.phoneNumber,
  };
}

function updateAudits(
  actorSub: string,
  targetSub: string,
  existing: DirectoryProfile | null,
  profile: ProfileWrite | null,
  roleChange: RoleChange | null,
): AdministrationAudit[] {
  const audits: AdministrationAudit[] = [];
  if (profile) {
    audits.push({
      action: USER_PROFILE_UPDATED_AUDIT_ACTION,
      actorSub,
      targetSub,
      metadata: {
        before: existing ? snapshot(existing) : null,
        after: nextSnapshot(existing, profile),
      },
    });
  }
  if (roleChange) {
    audits.push({
      action: USER_ROLES_UPDATED_AUDIT_ACTION,
      actorSub,
      targetSub,
      metadata: {
        before: roleChange.before,
        after: roleChange.after,
      },
    });
  }
  return audits;
}

function snapshot(profile: DirectoryProfile): ProfileSnapshot {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phoneNumber: profile.phoneNumber,
  };
}

function nextSnapshot(
  existing: DirectoryProfile | null,
  profile: ProfileWrite,
): ProfileSnapshot {
  if (profile.mode === 'create') {
    return {
      firstName: profile.firstName,
      lastName: profile.lastName,
      phoneNumber: profile.phoneNumber,
    };
  }
  return {
    firstName: profile.firstName ?? existing?.firstName ?? '',
    lastName: profile.lastName ?? existing?.lastName ?? '',
    phoneNumber: profile.phoneNumber ?? existing?.phoneNumber ?? '',
  };
}

function requireActor(actor: AuthenticatedUser): string {
  return requireTarget(actor.userId);
}

function requireTarget(id: string): string {
  const value = id.trim();
  if (value.length < 1 || value.length > 128 || /[\u0000-\u001f"\\]/.test(value)) {
    throw new UserAdministrationQueryError();
  }
  return value;
}

function safeFailureName(error: unknown): string {
  if (error instanceof CognitoAdminError) {
    return error.code;
  }
  if (
    error instanceof Error &&
    /^[A-Za-z]+(?:Error|Exception)$/.test(error.name)
  ) {
    return error.name;
  }
  return 'unknown';
}
