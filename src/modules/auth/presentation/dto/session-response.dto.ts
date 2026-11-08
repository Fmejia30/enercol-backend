import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../../identity-access/domain/user-role.js';

export class SessionUserResponseDto {
  @ApiProperty({ example: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'usuario@empresa.com',
  })
  email!: string | null;

  @ApiProperty({
    enum: UserRole,
    isArray: true,
    example: [UserRole.SPECIALIST],
  })
  roles!: UserRole[];
}

export class ChallengeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    example: 'SOFTWARE_TOKEN_MFA',
  })
  name!: string;

  @ApiProperty({ type: [String] })
  requiredAttributes!: string[];

  @ApiPropertyOptional({
    description: 'Secreto TOTP de un MFA_SETUP. Se entrega una sola vez.',
  })
  secretCode?: string;
}

export class AuthContinuationDto {
  @ApiProperty({ example: true })
  authenticated!: boolean;

  @ApiPropertyOptional()
  csrfToken?: string;

  @ApiPropertyOptional({ type: SessionUserResponseDto })
  user?: SessionUserResponseDto;

  @ApiPropertyOptional({ type: ChallengeResponseDto })
  challenge?: ChallengeResponseDto;
}

export class SessionResponseDto {
  @ApiProperty({ example: true })
  authenticated!: boolean;

  @ApiPropertyOptional({
    description:
      'Token CSRF de esta sesión. El frontend lo envía en el encabezado X-CSRF-Token al cerrar sesión.',
  })
  csrfToken?: string;

  @ApiPropertyOptional({ type: SessionUserResponseDto })
  user?: SessionUserResponseDto;
}
