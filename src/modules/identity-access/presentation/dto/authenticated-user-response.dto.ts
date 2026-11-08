import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../domain/user-role.js';

export class AuthenticatedUserResponseDto {
  @ApiProperty({ example: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
  userId!: string;

  @ApiProperty({
    enum: UserRole,
    isArray: true,
    example: [UserRole.SPECIALIST],
  })
  roles!: UserRole[];
}
