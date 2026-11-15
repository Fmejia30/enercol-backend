import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  POST_SALE_REQUEST_TYPES,
  type PostSaleRequestType,
} from '../../domain/post-sale-request.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePostSaleRequestDto {
  @ApiProperty({ example: 'CLI-10421' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  customerId!: string;

  @ApiProperty({ example: 'Textiles del Altiplano S.A.S.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName!: string;

  @ApiProperty({ example: 'Planta Fontibón' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  facilityName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'MED-FTB-014' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
  })
  @IsString()
  @MaxLength(64)
  assetId?: string | null;

  @ApiProperty({ enum: POST_SALE_REQUEST_TYPES })
  @IsIn(POST_SALE_REQUEST_TYPES)
  type!: PostSaleRequestType;

  @ApiProperty({
    example:
      'El cliente reporta superaciones del límite de demanda en el periodo evaluado.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ example: '2026-09-01' })
  @Matches(DATE_ONLY)
  periodStart!: string;

  @ApiProperty({ example: '2026-09-30' })
  @Matches(DATE_ONLY)
  periodEnd!: string;
}
