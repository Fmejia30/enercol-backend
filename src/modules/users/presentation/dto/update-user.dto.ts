import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import {
  RECOGNIZED_ROLES,
  UserRole,
} from '../../../identity-access/domain/user-role.js';
import {
  USER_NAME_PATTERN,
  USER_PHONE_PATTERN,
} from '../../domain/user-administration.js';

@ValidatorConstraint({ name: 'atLeastOneUserChange', async: false })
export class AtLeastOneUserChangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as UpdateUserDto;
    return (
      dto.firstName !== undefined ||
      dto.lastName !== undefined ||
      dto.phoneNumber !== undefined ||
      dto.roles !== undefined
    );
  }

  defaultMessage(): string {
    return 'At least one field is required';
  }
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Fernando' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(USER_NAME_PATTERN)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Mejía' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(USER_NAME_PATTERN)
  lastName?: string;

  @ApiPropertyOptional({ example: '+573000000000' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Matches(USER_PHONE_PATTERN)
  phoneNumber?: string;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    example: [UserRole.SPECIALIST, UserRole.VALIDATOR],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(RECOGNIZED_ROLES, { each: true })
  roles?: UserRole[];

  @ApiHideProperty()
  @Validate(AtLeastOneUserChangeConstraint)
  change?: unknown;
}
