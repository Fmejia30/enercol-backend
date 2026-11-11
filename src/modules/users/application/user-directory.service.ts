import { Inject, Injectable, Logger } from '@nestjs/common';
import { mapCognitoGroupsToRoles } from '../../identity-access/domain/cognito-group-mapping.js';
import type { UserRole } from '../../identity-access/domain/user-role.js';
import { CognitoAdminError } from '../domain/cognito-admin-error.js';
import type { FunctionalCognitoGroup } from '../domain/functional-cognito-group.js';
import {
  UserDirectoryFailedError,
  UserDirectoryNotFoundError,
  UserDirectoryQueryError,
} from '../domain/user-directory-error.js';
import {
  COGNITO_USER_ADMIN,
  type CognitoManagedUser,
  type CognitoUserAdmin,
  type CognitoUserStatus,
} from './cognito-user-admin.js';
import {
  USER_DIRECTORY_REPOSITORY,
  type DirectoryInvitationStatus,
  type UserDirectoryRepository,
} from './user-directory.repository.js';
import {
  UserListCursorCodec,
  type UserListPosition,
} from './user-list-cursor.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const COGNITO_PAGE_SIZE = 60;
const MAX_COGNITO_PAGES = 20;
const GROUP_LOOKUP_CONCURRENCY = 5;

export interface ListDirectoryUsersQuery {
  pageSize?: number;
  nextToken?: string;
  search?: string;
  accountStatus?: CognitoUserStatus;
  role?: UserRole;
}

export interface DirectoryUserSummary {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  roles: UserRole[];
  accountStatus: CognitoUserStatus | null;
  enabled: boolean;
  profileCompleted: boolean;
  invitationStatus: DirectoryInvitationStatus | null;
  createdAt: string | null;
  lastModifiedAt: string | null;
}

export interface DirectoryUserDetail extends DirectoryUserSummary {
  groups: FunctionalCognitoGroup[];
}

export interface DirectoryUserPage {
  users: DirectoryUserSummary[];
  nextToken: string | null;
}

interface SelectedUser {
  user: CognitoManagedUser;
  roles: UserRole[];
  groups: FunctionalCognitoGroup[];
}

@Injectable()
export class UserDirectoryService {
  private readonly logger = new Logger(UserDirectoryService.name);

  constructor(
    @Inject(COGNITO_USER_ADMIN)
    private readonly cognito: CognitoUserAdmin,
    @Inject(USER_DIRECTORY_REPOSITORY)
    private readonly directory: UserDirectoryRepository,
    private readonly cursors: UserListCursorCodec,
  ) {}

  async list(query: ListDirectoryUsersQuery): Promise<DirectoryUserPage> {
    const pageSize = normalizePageSize(query.pageSize);
    const search = normalizeSearch(query.search);
    const normalized = { ...query, search };
    const position = query.nextToken
      ? this.readCursor(query.nextToken, normalized)
      : { token: undefined, skip: 0 };
    try {
      const selected = await this.collectPage(normalized, pageSize, position);
      return {
        users: await this.enrich(selected.users),
        nextToken: selected.resume
          ? this.cursors.encode(selected.resume, normalized)
          : null,
      };
    } catch (error) {
      this.rethrow(error);
    }
  }

  async getBySub(id: string): Promise<DirectoryUserDetail> {
    const cognitoSub = requireUserId(id);
    try {
      const user = await this.cognito.getUserBySub(cognitoSub);
      const groups = await this.cognito.listGroups(user.username);
      const [summary] = await this.enrich([
        {
          user,
          roles: mapCognitoGroupsToRoles(groups),
          groups,
        },
      ]);
      if (!summary) {
        throw new UserDirectoryFailedError();
      }
      return { ...summary, groups };
    } catch (error) {
      if (
        error instanceof CognitoAdminError &&
        error.code === 'user_not_found'
      ) {
        throw new UserDirectoryNotFoundError();
      }
      this.rethrow(error);
    }
  }

  private async collectPage(
    query: ListDirectoryUsersQuery,
    pageSize: number,
    start: UserListPosition,
  ): Promise<{ users: SelectedUser[]; resume: UserListPosition | null }> {
    const selected: SelectedUser[] = [];
    let fetchToken = start.token;
    let skip = start.skip;
    for (
      let page = 0;
      page < MAX_COGNITO_PAGES && selected.length < pageSize;
      page += 1
    ) {
      const requestedToken = fetchToken;
      const listed = await this.cognito.listUsers({
        limit: COGNITO_PAGE_SIZE,
        paginationToken: fetchToken,
        emailPrefix: query.search,
        accountStatus: query.search ? undefined : query.accountStatus,
      });
      const outcome = await this.takeMatches(
        listed.users,
        skip,
        pageSize - selected.length,
        query,
      );
      selected.push(...outcome.matches);
      if (selected.length >= pageSize) {
        return {
          users: selected,
          resume: resumeAfter(requestedToken, outcome.nextIndex, listed),
        };
      }
      if (!listed.paginationToken) {
        return { users: selected, resume: null };
      }
      fetchToken = listed.paginationToken;
      skip = 0;
    }
    return {
      users: selected,
      resume: fetchToken ? { token: fetchToken, skip: 0 } : null,
    };
  }

  private async takeMatches(
    users: readonly CognitoManagedUser[],
    start: number,
    needed: number,
    query: ListDirectoryUsersQuery,
  ): Promise<{ matches: SelectedUser[]; nextIndex: number }> {
    const matches: SelectedUser[] = [];
    let index = start;
    while (index < users.length && matches.length < needed) {
      const batch: Array<{ user: CognitoManagedUser; index: number }> = [];
      while (index < users.length && batch.length < GROUP_LOOKUP_CONCURRENCY) {
        const user = users[index];
        const current = index;
        index += 1;
        if (!user || !matchesAttributes(user, query)) {
          continue;
        }
        batch.push({ user, index: current });
        if (matches.length + batch.length >= needed) {
          break;
        }
      }
      if (batch.length === 0) {
        continue;
      }
      const groups = await Promise.all(
        batch.map((item) => this.cognito.listGroups(item.user.username)),
      );
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
        const item = batch[batchIndex];
        const groupNames = groups[batchIndex] ?? [];
        if (!item) {
          continue;
        }
        const roles = mapCognitoGroupsToRoles(groupNames);
        if (query.role && !roles.includes(query.role)) {
          continue;
        }
        matches.push({ user: item.user, roles, groups: groupNames });
        if (matches.length === needed) {
          return { matches, nextIndex: item.index + 1 };
        }
      }
    }
    return { matches, nextIndex: users.length };
  }

  private async enrich(
    selected: readonly SelectedUser[],
  ): Promise<DirectoryUserSummary[]> {
    const profiles = await this.directory.findProfiles(
      selected.map((item) => item.user.sub),
    );
    const emails = selected.flatMap((item) =>
      item.user.email ? [item.user.email] : [],
    );
    const invitations = await this.directory.findLatestInvitations(emails);
    const profileBySub = new Map(
      profiles.map((profile) => [profile.cognitoSub, profile]),
    );
    const invitationByEmail = new Map(
      invitations.map((invitation) => [invitation.email, invitation.status]),
    );
    return selected.map((item) => {
      const profile = profileBySub.get(item.user.sub);
      return {
        id: item.user.sub,
        email: item.user.email,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        phoneNumber: profile?.phoneNumber ?? null,
        roles: item.roles,
        accountStatus: item.user.accountStatus,
        enabled: item.user.enabled,
        profileCompleted: profile !== undefined,
        invitationStatus: item.user.email
          ? (invitationByEmail.get(item.user.email) ?? null)
          : null,
        createdAt: iso(item.user.createdAt),
        lastModifiedAt: iso(item.user.lastModifiedAt),
      };
    });
  }

  private readCursor(
    token: string,
    query: ListDirectoryUsersQuery,
  ): UserListPosition {
    try {
      return this.cursors.read(token, query);
    } catch (error) {
      if (error instanceof UserDirectoryQueryError) {
        throw error;
      }
      throw new UserDirectoryQueryError();
    }
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof UserDirectoryQueryError ||
      error instanceof UserDirectoryNotFoundError ||
      error instanceof UserDirectoryFailedError
    ) {
      throw error;
    }
    const detail =
      error instanceof CognitoAdminError
        ? error.code
        : error instanceof Error &&
            /^[A-Za-z]+(?:Error|Exception)$/.test(error.name)
          ? error.name
          : 'unknown';
    this.logger.error(`User directory failed (${detail})`);
    throw new UserDirectoryFailedError();
  }
}

function resumeAfter(
  requestedToken: string | undefined,
  nextIndex: number,
  listed: {
    users: readonly CognitoManagedUser[];
    paginationToken: string | null;
  },
): UserListPosition | null {
  if (nextIndex < listed.users.length) {
    return { token: requestedToken, skip: nextIndex };
  }
  if (listed.paginationToken) {
    return { token: listed.paginationToken, skip: 0 };
  }
  return null;
}

function matchesAttributes(
  user: CognitoManagedUser,
  query: ListDirectoryUsersQuery,
): boolean {
  if (query.search) {
    if (!user.email?.toLowerCase().startsWith(query.search)) {
      return false;
    }
  }
  if (query.accountStatus && user.accountStatus !== query.accountStatus) {
    return false;
  }
  return true;
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new UserDirectoryQueryError();
  }
  return pageSize;
}

function normalizeSearch(search: string | undefined): string | undefined {
  if (search === undefined) {
    return undefined;
  }
  const value = search.trim().toLowerCase();
  if (
    value.length < 1 ||
    value.length > 320 ||
    /[\u0000-\u001f"\\]/.test(value)
  ) {
    throw new UserDirectoryQueryError();
  }
  return value;
}

function requireUserId(id: string): string {
  const value = id.trim();
  if (
    value.length < 1 ||
    value.length > 128 ||
    /[\u0000-\u001f"\\]/.test(value)
  ) {
    throw new UserDirectoryQueryError();
  }
  return value;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
