import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  MaxLength,
} from 'class-validator';
import {
  RECOGNIZED_ROLES,
  UserRole,
} from '../../../identity-access/domain/user-role.js';

export class InviteUserDto {
  @ApiProperty({ example: 'ana@enercol.test' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({
    enum: UserRole,
    isArray: true,
    example: [UserRole.SPECIALIST],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(RECOGNIZED_ROLES, { each: true })
  roles!: UserRole[];
}
