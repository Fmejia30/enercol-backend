import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { sortRecognizedRoles } from '../../identity-access/domain/cognito-group-mapping.js';
import type { UserRole } from '../../identity-access/domain/user-role.js';
import {
  USER_NAME_PATTERN,
  USER_PHONE_PATTERN,
  USER_PROFILE_SELF_UPDATED_AUDIT_ACTION,
  UserAdministrationFailedError,
  UserAdministrationQueryError,
} from '../domain/user-administration.js';
import type { ProfileField } from './user-administration.repository.js';
import {
  USER_ADMINISTRATION_REPOSITORY,
  type UserAdministrationRepository,
} from './user-administration.repository.js';
import {
  USER_DIRECTORY_REPOSITORY,
  type DirectoryProfile,
  type UserDirectoryRepository,
} from './user-directory.repository.js';

export interface OwnProfile {
  id: string;
  email: string | null;
  roles: UserRole[];
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  profileCompleted: boolean;
}

export interface UpdateOwnProfileCommand {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
}

interface PersonalInput {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
}

@Injectable()
export class SelfProfileService {
  private readonly logger = new Logger(SelfProfileService.name);

  constructor(
    @Inject(USER_DIRECTORY_REPOSITORY)
    private readonly profiles: UserDirectoryRepository,
    @Inject(USER_ADMINISTRATION_REPOSITORY)
    private readonly administration: UserAdministrationRepository,
  ) {}

  async get(actor: AuthenticatedUser): Promise<OwnProfile> {
    const sub = requireSubject(actor.userId);
    const profile = await this.loadProfile(sub);
    return present(actor, sub, profile);
  }

  async update(
    actor: AuthenticatedUser,
    command: UpdateOwnProfileCommand,
  ): Promise<OwnProfile> {
    const sub = requireSubject(actor.userId);
    const personal = personalFields(command);
    if (!personal) {
      throw new UserAdministrationQueryError();
    }
    const existing = await this.loadProfile(sub);
    const profile = profileWrite(existing, personal);
    const changedFields = changedFieldNames(personal);
    try {
      await this.administration.saveChanges({
        targetSub: sub,
        profile,
        audits: [
          {
            action: USER_PROFILE_SELF_UPDATED_AUDIT_ACTION,
            actorSub: sub,
            targetSub: sub,
            metadata: {
              changedFields,
              before: existing ? pick(existing, changedFields) : null,
              after: pick(nextValues(existing, personal), changedFields),
            },
          },
        ],
      });
    } catch (error) {
      throw this.failed(error);
    }
    return present(actor, sub, await this.loadProfile(sub));
  }

  private async loadProfile(sub: string): Promise<DirectoryProfile | null> {
    try {
      const profiles = await this.profiles.findProfiles([sub]);
      return profiles.find((profile) => profile.cognitoSub === sub) ?? null;
    } catch (error) {
      throw this.failed(error);
    }
  }

  private failed(error: unknown): UserAdministrationFailedError {
    if (error instanceof UserAdministrationFailedError) {
      return error;
    }
    const detail =
      error instanceof Error &&
      /^[A-Za-z]+(?:Error|Exception)$/.test(error.name)
        ? error.name
        : 'unknown';
    this.logger.error(`Own profile failed (${detail})`);
    return new UserAdministrationFailedError();
  }
}

function present(
  actor: AuthenticatedUser,
  sub: string,
  profile: DirectoryProfile | null,
): OwnProfile {
  return {
    id: sub,
    email: typeof actor.email === 'string' ? actor.email : null,
    roles: sortRecognizedRoles(actor.roles),
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    phoneNumber: profile?.phoneNumber ?? null,
    profileCompleted: profile !== null,
  };
}

function personalFields(command: UpdateOwnProfileCommand): PersonalInput | null {
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

function profileWrite(
  existing: DirectoryProfile | null,
  personal: PersonalInput,
): {
  mode: 'create';
  firstName: string;
  lastName: string;
  phoneNumber: string;
} | {
  mode: 'update';
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
} {
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

function changedFieldNames(personal: PersonalInput): ProfileField[] {
  const fields: ProfileField[] = [];
  if (personal.firstName !== undefined) {
    fields.push('firstName');
  }
  if (personal.lastName !== undefined) {
    fields.push('lastName');
  }
  if (personal.phoneNumber !== undefined) {
    fields.push('phoneNumber');
  }
  return fields;
}

function pick(
  source: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
  },
  fields: readonly ProfileField[],
): Partial<{ firstName: string; lastName: string; phoneNumber: string }> {
  const selected: Partial<{
    firstName: string;
    lastName: string;
    phoneNumber: string;
  }> = {};
  for (const field of fields) {
    selected[field] = source[field];
  }
  return selected;
}

function nextValues(
  existing: DirectoryProfile | null,
  personal: PersonalInput,
): { firstName: string; lastName: string; phoneNumber: string } {
  return {
    firstName: personal.firstName ?? existing?.firstName ?? '',
    lastName: personal.lastName ?? existing?.lastName ?? '',
    phoneNumber: personal.phoneNumber ?? existing?.phoneNumber ?? '',
  };
}

function requireSubject(id: string): string {
  const value = id.trim();
  if (value.length < 1 || value.length > 128 || /[\u0000-\u001f"\\]/.test(value)) {
    throw new UserAdministrationQueryError();
  }
  return value;
}
