import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
  type UserStatusType,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CognitoManagedUser,
  CognitoUserAdmin,
  CognitoUserPage,
  CognitoUserStatus,
  ListCognitoUsersInput,
} from '../application/cognito-user-admin.js';
import { COGNITO_USER_STATUSES } from '../application/cognito-user-admin.js';
import { CognitoAdminError } from '../domain/cognito-admin-error.js';
import {
  FUNCTIONAL_COGNITO_GROUPS,
  isFunctionalCognitoGroup,
  type FunctionalCognitoGroup,
} from '../domain/functional-cognito-group.js';
import { COGNITO_IDENTITY_PROVIDER_CLIENT } from './cognito-identity-provider.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 60;
const MAX_GROUP_PAGES = 5;

type FailureScope = 'user' | 'group';

type CognitoAdminOperation =
  | 'AdminCreateUser'
  | 'AdminGetUser'
  | 'ListUsers'
  | 'AdminListGroupsForUser'
  | 'AdminAddUserToGroup'
  | 'AdminRemoveUserFromGroup'
  | 'AdminDisableUser'
  | 'AdminEnableUser'
  | 'AdminUserGlobalSignOut';

type CognitoFailureKind = 'aws' | 'credentials' | 'connectivity';

@Injectable()
export class CognitoUserAdminClient implements CognitoUserAdmin {
  private readonly logger = new Logger(CognitoUserAdminClient.name);
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;

  constructor(
    configService: ConfigService,
    @Inject(COGNITO_IDENTITY_PROVIDER_CLIENT)
    client: CognitoIdentityProviderClient,
  ) {
    this.userPoolId = configService.getOrThrow<string>('cognitoUserPoolId');
    this.client = client;
  }

  async createUser(email: string): Promise<CognitoManagedUser> {
    const username = requireIdentifier(email);
    const created = await this.dispatch(
      () =>
        this.client.send(
          new AdminCreateUserCommand({
            UserPoolId: this.userPoolId,
            Username: username,
            DesiredDeliveryMediums: ['EMAIL'],
            UserAttributes: [{ Name: 'email', Value: username }],
          }),
        ),
      'user',
      'AdminCreateUser',
    );
    return this.userFromCreateResponse(created.User, username);
  }

  async getUserByUsername(username: string): Promise<CognitoManagedUser> {
    const identifier = requireIdentifier(username);
    const response = await this.dispatch(
      () =>
        this.client.send(
          new AdminGetUserCommand({
            UserPoolId: this.userPoolId,
            Username: identifier,
          }),
        ),
      'user',
      'AdminGetUser',
    );
    return this.requireUser({
      Username: response.Username,
      Attributes: response.UserAttributes,
      Enabled: response.Enabled,
      UserStatus: response.UserStatus,
      UserCreateDate: response.UserCreateDate,
      UserLastModifiedDate: response.UserLastModifiedDate,
    });
  }

  async getUserBySub(sub: string): Promise<CognitoManagedUser> {
    const users = await this.findUsers(`sub = "${requireFilterValue(sub)}"`, 1);
    const user = users[0];
    if (!user) {
      throw new CognitoAdminError('user_not_found');
    }
    return user;
  }

  async findUsersByEmail(email: string): Promise<CognitoManagedUser[]> {
    return this.findUsers(
      `email = "${requireFilterValue(email)}"`,
      DEFAULT_PAGE_SIZE,
    );
  }

  async listGroups(username: string): Promise<FunctionalCognitoGroup[]> {
    const identifier = requireIdentifier(username);
    const names = new Set<string>();
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_GROUP_PAGES; page += 1) {
      const response = await this.dispatch(
        () =>
          this.client.send(
            new AdminListGroupsForUserCommand({
              UserPoolId: this.userPoolId,
              Username: identifier,
              Limit: MAX_PAGE_SIZE,
              NextToken: nextToken,
            }),
          ),
        'group',
        'AdminListGroupsForUser',
      );
      for (const group of response.Groups ?? []) {
        if (group.GroupName) {
          names.add(group.GroupName);
        }
      }
      if (!response.NextToken) {
        break;
      }
      nextToken = response.NextToken;
    }

    return FUNCTIONAL_COGNITO_GROUPS.filter((group) => names.has(group));
  }

  async addToGroup(username: string, group: string): Promise<void> {
    const identifier = requireIdentifier(username);
    const groupName = requireFunctionalGroup(group);
    await this.dispatch(
      () =>
        this.client.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: this.userPoolId,
            Username: identifier,
            GroupName: groupName,
          }),
        ),
      'group',
      'AdminAddUserToGroup',
    );
  }

  async removeFromGroup(username: string, group: string): Promise<void> {
    const identifier = requireIdentifier(username);
    const groupName = requireFunctionalGroup(group);
    await this.dispatch(
      () =>
        this.client.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: this.userPoolId,
            Username: identifier,
            GroupName: groupName,
          }),
        ),
      'group',
      'AdminRemoveUserFromGroup',
    );
  }

  async disableUser(username: string): Promise<void> {
    const identifier = requireIdentifier(username);
    await this.dispatch(
      () =>
        this.client.send(
          new AdminDisableUserCommand({
            UserPoolId: this.userPoolId,
            Username: identifier,
          }),
        ),
      'user',
      'AdminDisableUser',
    );
  }

  async enableUser(username: string): Promise<void> {
    const identifier = requireIdentifier(username);
    await this.dispatch(
      () =>
        this.client.send(
          new AdminEnableUserCommand({
            UserPoolId: this.userPoolId,
            Username: identifier,
          }),
        ),
      'user',
      'AdminEnableUser',
    );
  }

  async signOutUser(username: string): Promise<void> {
    const identifier = requireIdentifier(username);
    await this.dispatch(
      () =>
        this.client.send(
          new AdminUserGlobalSignOutCommand({
            UserPoolId: this.userPoolId,
            Username: identifier,
          }),
        ),
      'user',
      'AdminUserGlobalSignOut',
    );
  }

  async resendInvitation(username: string): Promise<void> {
    const identifier = requireIdentifier(username);
    await this.dispatch(
      () =>
        this.client.send(
          new AdminCreateUserCommand({
            UserPoolId: this.userPoolId,
            Username: identifier,
            MessageAction: 'RESEND',
          }),
        ),
      'user',
      'AdminCreateUser',
    );
  }

  async listUsers(input: ListCognitoUsersInput = {}): Promise<CognitoUserPage> {
    const limit = pageSize(input.limit);
    const token = paginationToken(input.paginationToken);
    const filter = listFilter(input);
    const response = await this.dispatch(
      () =>
        this.client.send(
          new ListUsersCommand({
            UserPoolId: this.userPoolId,
            Limit: limit,
            PaginationToken: token,
            Filter: filter,
          }),
        ),
      'user',
      'ListUsers',
    );
    return {
      users: (response.Users ?? []).flatMap((user) => {
        const managed = this.optionalUser(user);
        return managed ? [managed] : [];
      }),
      paginationToken: response.PaginationToken ?? null,
    };
  }

  private async findUsers(
    filter: string,
    limit: number,
  ): Promise<CognitoManagedUser[]> {
    const response = await this.dispatch(
      () =>
        this.client.send(
          new ListUsersCommand({
            UserPoolId: this.userPoolId,
            Filter: filter,
            Limit: limit,
          }),
        ),
      'user',
      'ListUsers',
    );
    return (response.Users ?? []).flatMap((user) => {
      const managed = this.optionalUser(user);
      return managed ? [managed] : [];
    });
  }

  private async userFromCreateResponse(
    user: UserType | undefined,
    username: string,
  ): Promise<CognitoManagedUser> {
    const sub = attributeValue(user?.Attributes, 'sub');
    if (sub) {
      return this.requireUser(user);
    }

    const fetched = await this.dispatch(
      () =>
        this.client.send(
          new AdminGetUserCommand({
            UserPoolId: this.userPoolId,
            Username: user?.Username ?? username,
          }),
        ),
      'user',
      'AdminGetUser',
    );
    return this.requireUser({
      Username: fetched.Username ?? user?.Username ?? username,
      Attributes: fetched.UserAttributes,
      Enabled: fetched.Enabled ?? user?.Enabled,
      UserStatus: fetched.UserStatus ?? user?.UserStatus,
      UserCreateDate: fetched.UserCreateDate ?? user?.UserCreateDate,
      UserLastModifiedDate:
        fetched.UserLastModifiedDate ?? user?.UserLastModifiedDate,
    });
  }

  private requireUser(user: UserType | undefined): CognitoManagedUser {
    const managed = this.optionalUser(user);
    if (!managed) {
      throw new CognitoAdminError('unavailable');
    }
    return managed;
  }

  private optionalUser(user: UserType | undefined): CognitoManagedUser | null {
    const sub = attributeValue(user?.Attributes, 'sub');
    const username = user?.Username;
    if (!sub || !username) {
      return null;
    }
    return {
      sub,
      username,
      email: attributeValue(user.Attributes, 'email'),
      enabled: user.Enabled === true,
      status: normalizeStatus(user.UserStatus),
      accountStatus: reportedStatus(user.UserStatus),
      createdAt: timestamp(user.UserCreateDate),
      lastModifiedAt: timestamp(user.UserLastModifiedDate),
    };
  }

  private async dispatch<Output>(
    operation: () => Promise<Output>,
    scope: FailureScope,
    command: CognitoAdminOperation,
  ): Promise<Output> {
    try {
      return await operation();
    } catch (error) {
      throw this.translate(error, scope, command);
    }
  }

  private translate(
    error: unknown,
    scope: FailureScope,
    command: CognitoAdminOperation,
  ): CognitoAdminError {
    if (error instanceof CognitoAdminError) {
      return error;
    }
    this.logFailure(command, error);
    const name = error instanceof Error ? error.name : 'Unknown';

    if (name === 'UserNotFoundException') {
      return new CognitoAdminError('user_not_found');
    }
    if (name === 'UsernameExistsException' || name === 'AliasExistsException') {
      return new CognitoAdminError('user_already_exists');
    }
    if (name === 'ResourceNotFoundException') {
      return new CognitoAdminError(
        scope === 'group' ? 'group_not_found' : 'configuration',
      );
    }
    if (
      name === 'NotAuthorizedException' ||
      name === 'InvalidParameterException' ||
      name === 'UnrecognizedClientException' ||
      name === 'AccessDeniedException'
    ) {
      return new CognitoAdminError('configuration');
    }
    return new CognitoAdminError('unavailable');
  }

  private logFailure(command: CognitoAdminOperation, error: unknown): void {
    const failure = readAwsFailure(error);
    this.logger.warn(
      JSON.stringify({
        source: 'enercol.cognito',
        event: 'COGNITO_ADMIN_FAILED',
        operation: command,
        exception: failure.exception,
        awsErrorCode: failure.awsErrorCode,
        httpStatusCode: failure.httpStatusCode,
        requestId: failure.requestId,
        failure: failure.failure,
      }),
    );
  }
}

const CREDENTIAL_EXCEPTIONS = new Set([
  'CredentialsProviderError',
  'CredentialsError',
]);

const CONNECTIVITY_EXCEPTIONS = new Set([
  'TimeoutError',
  'AbortError',
  'NetworkingError',
  'RequestTimeout',
]);

const CONNECTIVITY_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ECONNABORTED',
]);

function readAwsFailure(error: unknown): {
  exception: string;
  awsErrorCode: string | null;
  httpStatusCode: number | null;
  requestId: string | null;
  failure: CognitoFailureKind;
} {
  const record = isRecord(error) ? error : {};
  const metadata = isRecord(record.$metadata) ? record.$metadata : {};
  const exception = safeExceptionName(
    error instanceof Error ? error.name : 'Unknown',
  );
  const awsErrorCode = safeToken(firstString(record.Code, record.code));
  return {
    exception,
    awsErrorCode,
    httpStatusCode: httpStatus(metadata.httpStatusCode),
    requestId: safeRequestId(metadata.requestId),
    failure: failureKind(exception, awsErrorCode),
  };
}

function failureKind(
  exception: string,
  awsErrorCode: string | null,
): CognitoFailureKind {
  if (CREDENTIAL_EXCEPTIONS.has(exception)) {
    return 'credentials';
  }
  if (
    CONNECTIVITY_EXCEPTIONS.has(exception) ||
    (awsErrorCode !== null && CONNECTIVITY_CODES.has(awsErrorCode))
  ) {
    return 'connectivity';
  }
  return 'aws';
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function safeToken(value: string | null): string | null {
  if (value !== null && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) {
    return value;
  }
  return null;
}

function safeExceptionName(value: string): string {
  return safeToken(value) ?? 'Unknown';
}

function safeRequestId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(value)
    ? value
    : null;
}

function httpStatus(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireFunctionalGroup(group: string): FunctionalCognitoGroup {
  if (!isFunctionalCognitoGroup(group)) {
    throw new CognitoAdminError('group_not_allowed');
  }
  return group;
}

function requireIdentifier(value: string): string {
  const identifier = value.trim();
  if (
    identifier.length < 1 ||
    identifier.length > 128 ||
    /[\u0000-\u001f"\\]/.test(identifier)
  ) {
    throw new CognitoAdminError('configuration');
  }
  return identifier;
}

function requireFilterValue(value: string): string {
  return requireIdentifier(value);
}

function listFilter(input: ListCognitoUsersInput): string | undefined {
  if (input.emailPrefix !== undefined && input.accountStatus !== undefined) {
    throw new CognitoAdminError('configuration');
  }
  if (input.emailPrefix !== undefined) {
    return `email ^= "${requireFilterValue(input.emailPrefix.toLowerCase())}"`;
  }
  if (input.accountStatus !== undefined) {
    if (
      !(COGNITO_USER_STATUSES as readonly string[]).includes(
        input.accountStatus,
      )
    ) {
      throw new CognitoAdminError('configuration');
    }
    return `cognito:user_status = "${input.accountStatus}"`;
  }
  return undefined;
}

function pageSize(limit: number | undefined): number {
  if (!Number.isInteger(limit) || limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}

function paginationToken(token: string | undefined): string | undefined {
  if (token === undefined) {
    return undefined;
  }
  if (
    token.length < 1 ||
    token.length > 2048 ||
    /[\u0000-\u001f]/.test(token)
  ) {
    throw new CognitoAdminError('configuration');
  }
  return token;
}

function attributeValue(
  attributes: AttributeType[] | undefined,
  name: string,
): string | null {
  const value = attributes?.find((attribute) => attribute.Name === name)?.Value;
  return value && value.length > 0 ? value : null;
}

function reportedStatus(
  status: UserStatusType | undefined,
): CognitoUserStatus | null {
  if (status && (COGNITO_USER_STATUSES as readonly string[]).includes(status)) {
    return status;
  }
  return null;
}

function normalizeStatus(
  status: UserStatusType | undefined,
): CognitoUserStatus {
  return reportedStatus(status) ?? 'UNKNOWN';
}

function timestamp(value: Date | undefined): Date | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value;
}
