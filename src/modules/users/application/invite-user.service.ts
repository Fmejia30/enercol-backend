import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { CognitoAdminError } from '../domain/cognito-admin-error.js';
import {
  INVITATION_TTL_MS,
  invitationAssignment,
  normalizeInvitationEmail,
} from '../domain/invitation-request.js';
import {
  InvitationFailedError,
  InvitationForbiddenError,
  UserAlreadyExistsError,
} from '../domain/invitation-failure.js';
import {
  COGNITO_USER_ADMIN,
  type CognitoManagedUser,
  type CognitoUserAdmin,
} from './cognito-user-admin.js';
import {
  INVITATION_CLOCK,
  USER_INVITATION_REPOSITORY,
  type InvitationClock,
  type StoredUserInvitation,
  type UserInvitationRepository,
} from './user-invitation.repository.js';

export interface InviteUserCommand {
  email: string;
  roles: readonly string[];
}

@Injectable()
export class InviteUserService {
  private readonly logger = new Logger(InviteUserService.name);

  constructor(
    @Inject(COGNITO_USER_ADMIN)
    private readonly cognito: CognitoUserAdmin,
    @Inject(USER_INVITATION_REPOSITORY)
    private readonly invitations: UserInvitationRepository,
    @Inject(INVITATION_CLOCK)
    private readonly clock: InvitationClock,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    command: InviteUserCommand,
  ): Promise<StoredUserInvitation> {
    const actorSub = this.requireManager(actor);
    const email = normalizeInvitationEmail(command.email);
    const assignment = invitationAssignment(command.roles);
    await this.ensureEmailIsAvailable(email);

    const created = await this.createAccount(email);
    await this.assignGroups(actorSub, created, assignment.groups);

    const expiresAt = new Date(this.clock().getTime() + INVITATION_TTL_MS);
    try {
      return await this.invitations.save({
        email,
        cognitoSub: created.sub,
        roles: assignment.roles,
        expiresAt,
        createdBy: actorSub,
      });
    } catch (error) {
      await this.compensate(actorSub, created);
      throw this.failed(error);
    }
  }

  private requireManager(actor: AuthenticatedUser): string {
    const actorSub = actor.userId.trim();
    if (
      actorSub.length === 0 ||
      !actor.roles.includes(UserRole.ADMINISTRATOR)
    ) {
      throw new InvitationForbiddenError();
    }
    return actorSub;
  }

  private async ensureEmailIsAvailable(email: string): Promise<void> {
    let existing: CognitoManagedUser[];
    try {
      existing = await this.cognito.findUsersByEmail(email);
    } catch (error) {
      throw this.failed(error);
    }
    if (existing.length > 0) {
      throw new UserAlreadyExistsError();
    }
  }

  private async createAccount(email: string): Promise<CognitoManagedUser> {
    try {
      return await this.cognito.createUser(email);
    } catch (error) {
      if (
        error instanceof CognitoAdminError &&
        error.code === 'user_already_exists'
      ) {
        throw new UserAlreadyExistsError();
      }
      throw this.failed(error);
    }
  }

  private async assignGroups(
    actorSub: string,
    created: CognitoManagedUser,
    groups: readonly string[],
  ): Promise<void> {
    try {
      for (const group of groups) {
        await this.cognito.addToGroup(created.username, group);
      }
    } catch (error) {
      await this.compensate(actorSub, created);
      throw this.failed(error);
    }
  }

  private async compensate(
    actorSub: string,
    created: CognitoManagedUser,
  ): Promise<void> {
    try {
      await this.cognito.disableUser(created.username);
    } catch {
      this.logger.error(
        'User invitation compensation failed; administrative intervention required',
      );
      try {
        await this.invitations.recordIntervention({
          actorSub,
          targetSub: created.sub,
        });
      } catch {
        this.logger.error(
          'Could not record that the invitation requires administrative intervention',
        );
      }
    }
  }

  private failed(error: unknown): InvitationFailedError {
    if (error instanceof InvitationFailedError) {
      return error;
    }
    this.logger.error(`User invitation failed (${safeFailureName(error)})`);
    return new InvitationFailedError();
  }
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
