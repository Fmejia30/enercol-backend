export const DIRECTORY_INVITATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type DirectoryInvitationStatus =
  (typeof DIRECTORY_INVITATION_STATUSES)[number];

export interface DirectoryProfile {
  cognitoSub: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

export interface DirectoryInvitation {
  email: string;
  status: DirectoryInvitationStatus;
  createdAt: Date;
}

export interface UserDirectoryRepository {
  findProfiles(cognitoSubs: readonly string[]): Promise<DirectoryProfile[]>;
  findLatestInvitations(
    emails: readonly string[],
  ): Promise<DirectoryInvitation[]>;
}

export const USER_DIRECTORY_REPOSITORY = Symbol('USER_DIRECTORY_REPOSITORY');
