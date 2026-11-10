import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HealthChecksDto {
  @ApiPropertyOptional({
    enum: ['up', 'down'],
    example: 'up',
    description: 'Estado de la conexión con PostgreSQL.',
  })
  database?: 'up' | 'down';
}

export class HealthResponseDto {
  @ApiProperty({
    enum: ['ok', 'error'],
    example: 'ok',
  })
  status!: 'ok' | 'error';

  @ApiProperty({
    example: 'enercol-backend',
  })
  service!: string;

  @ApiProperty({
    example: '2026-11-10T21:29:15.812Z',
  })
  timestamp!: string;

  @ApiProperty({
    type: HealthChecksDto,
  })
  checks!: HealthChecksDto;
}
