import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../identity-access/domain/user-role.js';

export class InvitedUserResponseDto {
  @ApiProperty({ example: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
  id!: string;

  @ApiProperty({ example: 'ana@enercol.test' })
  email!: string;

  @ApiProperty({
    enum: UserRole,
    isArray: true,
    example: [UserRole.SPECIALIST],
  })
  roles!: UserRole[];

  @ApiProperty({ example: 'PENDING' })
  status!: 'PENDING';

  @ApiProperty({ example: '2026-11-18T00:00:00.000Z' })
  expiresAt!: string;
}
