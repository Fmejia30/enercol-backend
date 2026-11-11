import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  type ServiceInputTypes,
  type ServiceOutputTypes,
} from '@aws-sdk/client-cognito-identity-provider';
import { jest } from '@jest/globals';
import { CognitoAdminError } from '../domain/cognito-admin-error.js';
import { CognitoUserAdminClient } from './cognito-user-admin.client.js';

const POOL_ID = 'us-east-2_6rwk6IAdH';
const EMAIL = 'ana@enercol.test';
const SUB = '11111111-2222-4333-8444-555555555555';

describe('CognitoUserAdminClient', () => {
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  const send =
    jest.fn<(command: ServiceInputTypes) => Promise<ServiceOutputTypes>>();

  const client = new CognitoUserAdminClient(
    {
      getOrThrow: (key: string) => {
        if (key === 'cognitoRegion') return 'us-east-2';
        if (key === 'cognitoUserPoolId') return POOL_ID;
        throw new Error(key);
      },
    } as ConfigService,
    { send } as unknown as CognitoIdentityProviderClient,
  );

  beforeEach(() => {
    send.mockReset();
    warn.mockClear();
  });

  afterAll(() => {
    warn.mockRestore();
  });

  it('creates a user with the native invitation and reads the sub', async () => {
    send.mockResolvedValue({
      User: {
        Username: EMAIL,
        Enabled: true,
        UserStatus: 'FORCE_CHANGE_PASSWORD',
        Attributes: [
          { Name: 'sub', Value: SUB },
          { Name: 'email', Value: EMAIL },
        ],
      },
    });

    await expect(client.createUser(EMAIL)).resolves.toEqual({
      sub: SUB,
      username: EMAIL,
      email: EMAIL,
      enabled: true,
      status: 'FORCE_CHANGE_PASSWORD',
      accountStatus: 'FORCE_CHANGE_PASSWORD',
      createdAt: null,
      lastModifiedAt: null,
    });

    const command = sent(AdminCreateUserCommand);
    expect(command.input).toMatchObject({
      UserPoolId: POOL_ID,
      Username: EMAIL,
      DesiredDeliveryMediums: ['EMAIL'],
      UserAttributes: [{ Name: 'email', Value: EMAIL }],
    });
    expect(command.input.TemporaryPassword).toBeUndefined();
    expect(command.input.MessageAction).toBeUndefined();
    expect(command.input.UserAttributes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Name: 'email_verified' }),
      ]),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('loads the sub with AdminGetUser when creation omits it', async () => {
    send
      .mockResolvedValueOnce({
        User: {
          Username: EMAIL,
          Enabled: true,
          UserStatus: 'FORCE_CHANGE_PASSWORD',
          Attributes: [{ Name: 'email', Value: EMAIL }],
        },
      })
      .mockResolvedValueOnce({
        Username: EMAIL,
        Enabled: true,
        UserStatus: 'FORCE_CHANGE_PASSWORD',
        UserAttributes: [
          { Name: 'sub', Value: SUB },
          { Name: 'email', Value: EMAIL },
        ],
      });

    await expect(client.createUser(EMAIL)).resolves.toMatchObject({ sub: SUB });

    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(AdminGetUserCommand);
    expect(sent(AdminGetUserCommand).input).toMatchObject({
      UserPoolId: POOL_ID,
      Username: EMAIL,
    });
  });

  it('returns a normalized user', async () => {
    send.mockResolvedValue({
      Username: EMAIL,
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [
        { Name: 'sub', Value: SUB },
        { Name: 'email', Value: EMAIL },
        { Name: 'phone_number', Value: '+573000000000' },
      ],
    });

    await expect(client.getUserByUsername(EMAIL)).resolves.toEqual({
      sub: SUB,
      username: EMAIL,
      email: EMAIL,
      enabled: true,
      status: 'CONFIRMED',
      accountStatus: 'CONFIRMED',
      createdAt: null,
      lastModifiedAt: null,
    });
    expect(sent(AdminGetUserCommand).input.Username).toBe(EMAIL);
  });

  it('reports a missing user without the provider message', async () => {
    send.mockRejectedValue(
      cognitoFailure('UserNotFoundException', 'pool secret'),
    );

    await expect(client.getUserByUsername(EMAIL)).rejects.toEqual(
      expect.objectContaining({
        code: 'user_not_found',
        message: 'Cognito user was not found',
      }),
    );
    expect(loggedFailure()).toMatchObject({
      operation: 'AdminGetUser',
      exception: 'UserNotFoundException',
      failure: 'aws',
    });
    expect(loggedText()).not.toContain('secret');
  });

  it('returns the functional groups assigned to the user', async () => {
    send.mockResolvedValue({
      Groups: [
        { GroupName: 'OTRO_GRUPO' },
        { GroupName: 'ADMINISTRADOR' },
        { GroupName: 'ESPECIALISTA_TECNICO' },
      ],
    });

    await expect(client.listGroups(EMAIL)).resolves.toEqual([
      'ESPECIALISTA_TECNICO',
      'ADMINISTRADOR',
    ]);
    expect(sent(AdminListGroupsForUserCommand).input.Username).toBe(EMAIL);
  });

  it('adds the user to an allowed group', async () => {
    send.mockResolvedValue({});

    await expect(
      client.addToGroup(EMAIL, 'ESPECIALISTA_VALIDADOR'),
    ).resolves.toBeUndefined();
    expect(sent(AdminAddUserToGroupCommand).input).toMatchObject({
      UserPoolId: POOL_ID,
      Username: EMAIL,
      GroupName: 'ESPECIALISTA_VALIDADOR',
    });
  });

  it('rejects a group outside the functional set before calling Cognito', async () => {
    await expect(client.addToGroup(EMAIL, 'OTRO_GRUPO')).rejects.toEqual(
      expect.objectContaining({ code: 'group_not_allowed' }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('removes the user from an allowed group', async () => {
    send.mockResolvedValue({});

    await expect(
      client.removeFromGroup(EMAIL, 'ADMINISTRADOR'),
    ).resolves.toBeUndefined();
    expect(sent(AdminRemoveUserFromGroupCommand).input.GroupName).toBe(
      'ADMINISTRADOR',
    );
  });

  it('disables a user', async () => {
    send.mockResolvedValue({});

    await expect(client.disableUser(EMAIL)).resolves.toBeUndefined();
    expect(sent(AdminDisableUserCommand).input).toMatchObject({
      UserPoolId: POOL_ID,
      Username: EMAIL,
    });
  });

  it('signs the user out of Cognito without returning tokens', async () => {
    send.mockResolvedValue({});

    await expect(client.signOutUser(EMAIL)).resolves.toBeUndefined();
    expect(sent(AdminUserGlobalSignOutCommand).input).toEqual({
      UserPoolId: POOL_ID,
      Username: EMAIL,
    });
  });

  it('enables a user', async () => {
    send.mockResolvedValue({});

    await expect(client.enableUser(EMAIL)).resolves.toBeUndefined();
    expect(sent(AdminEnableUserCommand).input.Username).toBe(EMAIL);
  });

  it('resends the invitation without a password or verified email', async () => {
    send.mockResolvedValue({});

    await expect(client.resendInvitation(EMAIL)).resolves.toBeUndefined();
    const command = sent(AdminCreateUserCommand);
    expect(command.input).toEqual({
      UserPoolId: POOL_ID,
      Username: EMAIL,
      MessageAction: 'RESEND',
    });
  });

  it('returns one page and the continuation token', async () => {
    send.mockResolvedValue({
      Users: [
        {
          Username: EMAIL,
          Enabled: true,
          UserStatus: 'CONFIRMED',
          Attributes: [
            { Name: 'sub', Value: SUB },
            { Name: 'email', Value: EMAIL },
          ],
        },
        {
          Username: 'sin-sub@enercol.test',
          Enabled: true,
          Attributes: [{ Name: 'email', Value: 'sin-sub@enercol.test' }],
        },
      ],
      PaginationToken: 'next-page',
    });

    await expect(
      client.listUsers({ limit: 10, paginationToken: 'current-page' }),
    ).resolves.toEqual({
      users: [
        {
          sub: SUB,
          username: EMAIL,
          email: EMAIL,
          enabled: true,
          status: 'CONFIRMED',
          accountStatus: 'CONFIRMED',
          createdAt: null,
          lastModifiedAt: null,
        },
      ],
      paginationToken: 'next-page',
    });
    expect(sent(ListUsersCommand).input).toMatchObject({
      UserPoolId: POOL_ID,
      Limit: 10,
      PaginationToken: 'current-page',
    });
    expect(sent(ListUsersCommand).input.Filter).toBeUndefined();
  });

  it('filters a page by email prefix or account status and keeps Cognito dates', async () => {
    const createdAt = new Date('2026-11-01T00:00:00.000Z');
    const lastModifiedAt = new Date('2026-11-02T00:00:00.000Z');
    send.mockResolvedValue({
      Users: [
        {
          Username: EMAIL,
          Enabled: true,
          UserStatus: 'CONFIRMED',
          UserCreateDate: createdAt,
          UserLastModifiedDate: lastModifiedAt,
          Attributes: [
            { Name: 'sub', Value: SUB },
            { Name: 'email', Value: EMAIL },
          ],
        },
      ],
    });

    await expect(
      client.listUsers({ emailPrefix: 'Ana@Enercol.test' }),
    ).resolves.toMatchObject({
      users: [{ createdAt, lastModifiedAt, accountStatus: 'CONFIRMED' }],
    });
    expect(sent(ListUsersCommand).input.Filter).toBe(`email ^= "${EMAIL}"`);

    send.mockClear();
    send.mockResolvedValue({ Users: [] });
    await client.listUsers({ accountStatus: 'FORCE_CHANGE_PASSWORD' });
    expect(sent(ListUsersCommand).input.Filter).toBe(
      'cognito:user_status = "FORCE_CHANGE_PASSWORD"',
    );
  });

  it.each(['CONFIRMED', 'FORCE_CHANGE_PASSWORD', 'UNCONFIRMED'] as const)(
    'filters %s through cognito:user_status',
    async (accountStatus) => {
      send.mockResolvedValue({ Users: [] });

      await client.listUsers({ accountStatus });

      const filter = sent(ListUsersCommand).input.Filter;
      expect(filter).toBe(`cognito:user_status = "${accountStatus}"`);
      expect(filter?.startsWith('status ')).toBe(false);
    },
  );

  it('maps duplicate users, missing groups, and configuration failures', async () => {
    send.mockRejectedValueOnce(cognitoFailure('UsernameExistsException'));
    await expect(client.createUser(EMAIL)).rejects.toBeInstanceOf(
      CognitoAdminError,
    );
    send.mockRejectedValueOnce(cognitoFailure('UsernameExistsException'));
    await expect(client.createUser(EMAIL)).rejects.toMatchObject({
      code: 'user_already_exists',
    });

    send.mockRejectedValueOnce(cognitoFailure('ResourceNotFoundException'));
    await expect(
      client.addToGroup(EMAIL, 'ESPECIALISTA_TECNICO'),
    ).rejects.toMatchObject({ code: 'group_not_found' });

    send.mockRejectedValueOnce(
      cognitoFailure('NotAuthorizedException', 'arn:aws:iam::123:role/admin'),
    );
    await expect(client.disableUser(EMAIL)).rejects.toMatchObject({
      code: 'configuration',
      message: 'Cognito administration is not configured',
    });
    expect(loggedText()).not.toContain('arn:aws');
    expect(loggedFailure()).toMatchObject({
      operation: 'AdminDisableUser',
      exception: 'NotAuthorizedException',
      failure: 'aws',
    });
  });

  it('logs AWS metadata without the provider message or response body', async () => {
    const error = cognitoFailure(
      'ServiceUnavailableException',
      'token=Secret123 password=hunter2 cookie=session',
    );
    Object.assign(error, {
      Code: 'ServiceUnavailableException',
      $metadata: {
        httpStatusCode: 503,
        requestId: '11111111-2222-4333-8444-555555555555',
      },
      $response: { body: 'access token Secret123' },
    });
    send.mockRejectedValue(error);

    await expect(client.listUsers()).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Cognito administration is unavailable',
    });
    expect(loggedFailure()).toEqual({
      source: 'enercol.cognito',
      event: 'COGNITO_ADMIN_FAILED',
      operation: 'ListUsers',
      exception: 'ServiceUnavailableException',
      awsErrorCode: 'ServiceUnavailableException',
      httpStatusCode: 503,
      requestId: '11111111-2222-4333-8444-555555555555',
      failure: 'aws',
    });
    expect(loggedText()).not.toContain('Secret123');
    expect(loggedText()).not.toContain('hunter2');
    expect(loggedText()).not.toContain('cookie');
  });

  it('logs a credential failure by type and keeps it unavailable', async () => {
    const error = new Error(
      'Could not load credentials AWS_SECRET_ACCESS_KEY=Secret123',
    );
    error.name = 'CredentialsProviderError';
    send.mockRejectedValue(error);

    await expect(client.enableUser(EMAIL)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(loggedFailure()).toMatchObject({
      operation: 'AdminEnableUser',
      exception: 'CredentialsProviderError',
      awsErrorCode: null,
      failure: 'credentials',
    });
    expect(loggedText()).not.toContain('Secret123');
    expect(loggedText()).not.toContain('AWS_SECRET_ACCESS_KEY');
  });

  it('logs a connectivity failure by type and drops unsafe identifiers', async () => {
    const error = Object.assign(
      new Error('connect ECONNREFUSED https://user:password@169.254.169.254'),
      {
        code: 'ECONNREFUSED',
        $metadata: {
          httpStatusCode: 0,
          requestId: 'eyJhbGciOi.payload.signature',
        },
      },
    );
    send.mockRejectedValue(error);

    await expect(client.signOutUser(EMAIL)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(loggedFailure()).toMatchObject({
      operation: 'AdminUserGlobalSignOut',
      exception: 'Error',
      awsErrorCode: 'ECONNREFUSED',
      httpStatusCode: null,
      requestId: null,
      failure: 'connectivity',
    });
    expect(loggedText()).not.toContain('password');
    expect(loggedText()).not.toContain('eyJhbGciOi');
  });

  function sent<
    Command extends new (...args: never[]) => InstanceType<Command>,
  >(commandType: Command): InstanceType<Command> {
    const command = send.mock.calls
      .map(([value]) => value)
      .find((value) => value instanceof commandType);
    if (!(command instanceof commandType)) {
      throw new Error(`Missing ${commandType.name}`);
    }
    return command;
  }

  function loggedText(): string {
    return warn.mock.calls.map(([message]) => String(message)).join('\n');
  }

  function loggedFailure(): unknown {
    const message = warn.mock.calls.at(-1)?.[0];
    return JSON.parse(String(message));
  }
});

function cognitoFailure(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
