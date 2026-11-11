import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
  USER_NAME_PATTERN,
  USER_PHONE_PATTERN,
} from '../../domain/user-administration.js';

@ValidatorConstraint({ name: 'atLeastOneOwnProfileField', async: false })
export class AtLeastOneOwnProfileFieldConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as UpdateOwnProfileDto;
    return (
      dto.firstName !== undefined ||
      dto.lastName !== undefined ||
      dto.phoneNumber !== undefined
    );
  }

  defaultMessage(): string {
    return 'At least one field is required';
  }
}

export class UpdateOwnProfileDto {
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

  @ApiHideProperty()
  @Validate(AtLeastOneOwnProfileFieldConstraint)
  change?: unknown;
}
