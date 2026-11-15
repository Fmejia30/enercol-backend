import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  POST_SALE_REQUEST_STATUSES,
  type PostSaleRequestStatus,
} from '../../domain/post-sale-request.js';

export class ListPostSaleRequestsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Página, empezando en 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    enum: POST_SALE_REQUEST_STATUSES,
    description: 'Filtra por el estado de la solicitud.',
  })
  @IsOptional()
  @IsIn(POST_SALE_REQUEST_STATUSES)
  status?: PostSaleRequestStatus;

  @ApiPropertyOptional({
    description:
      'Busca por código de ticket, identificador de cliente, nombre de cliente o instalación. La comparación ignora mayúsculas y distingue tildes.',
    example: 'Fontibón',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const normalized = value.trim();
    return normalized.length === 0 ? undefined : normalized;
  })
  @IsString()
  @MaxLength(200)
  search?: string;
}
