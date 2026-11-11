import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COGNITO_USER_STATUSES } from '../../application/cognito-user-admin.js';
import type { CognitoUserStatus } from '../../application/cognito-user-admin.js';
import {
  RECOGNIZED_ROLES,
  type UserRole,
} from '../../../identity-access/domain/user-role.js';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    description: 'Token opaco devuelto por la página anterior.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  nextToken?: string;

  @ApiPropertyOptional({
    description: 'Prefijo del correo electrónico.',
    example: 'ana@',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0 ? undefined : normalized;
  })
  @IsString()
  @MaxLength(320)
  search?: string;

  @ApiPropertyOptional({ enum: COGNITO_USER_STATUSES })
  @IsOptional()
  @IsIn(COGNITO_USER_STATUSES)
  status?: CognitoUserStatus;

  @ApiPropertyOptional({ enum: RECOGNIZED_ROLES })
  @IsOptional()
  @IsIn(RECOGNIZED_ROLES)
  role?: UserRole;
}
