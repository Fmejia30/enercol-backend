import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../domain/user-role.js';

export const ACCESS_REQUIREMENT_KEY = 'identity:access-requirement';

export type AccessRequirement =
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'roles'; readonly roles: readonly UserRole[] };

export const Roles = (...roles: readonly UserRole[]) =>
  SetMetadata(ACCESS_REQUIREMENT_KEY, {
    kind: 'roles',
    roles,
  } satisfies AccessRequirement);

export const Authenticated = () =>
  SetMetadata(ACCESS_REQUIREMENT_KEY, {
    kind: 'authenticated',
  } satisfies AccessRequirement);
