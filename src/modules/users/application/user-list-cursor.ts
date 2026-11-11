import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserRole } from '../../identity-access/domain/user-role.js';
import type { CognitoUserStatus } from './cognito-user-admin.js';
import { UserDirectoryQueryError } from '../domain/user-directory-error.js';

export interface DirectoryQueryKey {
  search?: string;
  accountStatus?: CognitoUserStatus;
  role?: UserRole;
}

export interface UserListPosition {
  token: string | undefined;
  skip: number;
}

interface CursorPayload {
  t: string;
  s: number;
  q: string;
}

const MAX_SKIP = 60;

@Injectable()
export class UserListCursorCodec {
  constructor(private readonly configService: ConfigService) {}

  encode(position: UserListPosition, query: DirectoryQueryKey): string {
    const payload: CursorPayload = {
      t: position.token ?? '',
      s: position.skip,
      q: queryFingerprint(query),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${sign(body, this.key())}`;
  }

  read(token: string, query: DirectoryQueryKey): UserListPosition {
    const separator = token.lastIndexOf('.');
    const body = separator > 0 ? token.slice(0, separator) : '';
    const signature = separator > 0 ? token.slice(separator + 1) : '';
    if (
      !body ||
      !signature ||
      !signaturesMatch(signature, sign(body, this.key()))
    ) {
      throw new UserDirectoryQueryError();
    }

    let payload: CursorPayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as CursorPayload;
    } catch {
      throw new UserDirectoryQueryError();
    }
    if (
      !payload ||
      typeof payload.t !== 'string' ||
      !Number.isInteger(payload.s) ||
      payload.s < 0 ||
      payload.s > MAX_SKIP ||
      payload.q !== queryFingerprint(query)
    ) {
      throw new UserDirectoryQueryError();
    }
    return {
      token: payload.t.length > 0 ? payload.t : undefined,
      skip: payload.s,
    };
  }

  private key(): string {
    return this.configService.getOrThrow<string>('sessionEncryptionKey');
  }
}

export function queryFingerprint(query: DirectoryQueryKey): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        search: query.search ?? null,
        accountStatus: query.accountStatus ?? null,
        role: query.role ?? null,
      }),
    )
    .digest('base64url')
    .slice(0, 22);
}

function sign(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

function signaturesMatch(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
