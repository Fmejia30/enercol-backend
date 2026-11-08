import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'usuario@empresa.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class ChallengeDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  challengeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  newPassword?: string;

  @ApiPropertyOptional({
    description:
      'Atributos adicionales exigidos por Cognito en NEW_PASSWORD_REQUIRED. El resto se ignora.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}
