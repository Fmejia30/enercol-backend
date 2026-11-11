import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../identity-access/domain/user-role.js';

export class OwnProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ enum: UserRole, isArray: true })
  roles!: UserRole[];

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phoneNumber!: string | null;

  @ApiProperty()
  profileCompleted!: boolean;
}
