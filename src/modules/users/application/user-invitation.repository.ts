import type { UserRole } from '../../identity-access/domain/user-role.js';

export interface NewUserInvitation {
  email: string;
  cognitoSub: string;
  roles: readonly UserRole[];
  expiresAt: Date;
  createdBy: string;
}

export interface StoredUserInvitation {
  id: string;
  email: string;
  roles: readonly UserRole[];
  status: 'PENDING';
  expiresAt: Date;
}

export interface InvitationIntervention {
  actorSub: string;
  targetSub: string;
}

export interface UserInvitationRepository {
  save(invitation: NewUserInvitation): Promise<StoredUserInvitation>;
  recordIntervention(intervention: InvitationIntervention): Promise<void>;
}

export const USER_INVITATION_REPOSITORY = Symbol('USER_INVITATION_REPOSITORY');

export const INVITATION_CLOCK = Symbol('INVITATION_CLOCK');

export type InvitationClock = () => Date;
