import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COGNITO_USER_STATUSES } from '../../application/cognito-user-admin.js';
import type { CognitoUserStatus } from '../../application/cognito-user-admin.js';
import { DIRECTORY_INVITATION_STATUSES } from '../../application/user-directory.repository.js';
import type { DirectoryInvitationStatus } from '../../application/user-directory.repository.js';
import { FUNCTIONAL_COGNITO_GROUPS } from '../../domain/functional-cognito-group.js';
import type { FunctionalCognitoGroup } from '../../domain/functional-cognito-group.js';
import { UserRole } from '../../../identity-access/domain/user-role.js';

export class DirectoryUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phoneNumber!: string | null;

  @ApiProperty({ enum: UserRole, isArray: true })
  roles!: UserRole[];

  @ApiPropertyOptional({ enum: COGNITO_USER_STATUSES, nullable: true })
  accountStatus!: CognitoUserStatus | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  profileCompleted!: boolean;

  @ApiPropertyOptional({ enum: DIRECTORY_INVITATION_STATUSES, nullable: true })
  invitationStatus!: DirectoryInvitationStatus | null;

  @ApiProperty({ type: String, nullable: true })
  createdAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastModifiedAt!: string | null;
}

export class DirectoryUserPageResponseDto {
  @ApiProperty({ type: [DirectoryUserResponseDto] })
  users!: DirectoryUserResponseDto[];

  @ApiProperty({ type: String, nullable: true })
  nextToken!: string | null;
}

export class DirectoryUserDetailResponseDto extends DirectoryUserResponseDto {
  @ApiProperty({ enum: FUNCTIONAL_COGNITO_GROUPS, isArray: true })
  groups!: FunctionalCognitoGroup[];
}
