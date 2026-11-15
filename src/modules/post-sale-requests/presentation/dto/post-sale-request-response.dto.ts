import { ApiProperty } from '@nestjs/swagger';
import {
  POST_SALE_REQUEST_STATUSES,
  POST_SALE_REQUEST_TYPES,
  type PostSaleRequestStatus,
  type PostSaleRequestType,
} from '../../domain/post-sale-request.js';
import {
  REQUEST_ACTIVITY_EVENTS,
  type RequestActivityEvent,
} from '../../domain/request-activity.js';

export class PostSaleRequestResponseDto {
  @ApiProperty({ example: '6f1c2a10-4b7e-4a1d-9c31-000000000001' })
  id!: string;

  @ApiProperty({ example: 'PV-24018' })
  ticketCode!: string;

  @ApiProperty({ example: 'CLI-10421' })
  customerId!: string;

  @ApiProperty({ example: 'Textiles del Altiplano S.A.S.' })
  customerName!: string;

  @ApiProperty({ example: 'Planta Fontibón' })
  facilityName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'MED-FTB-014' })
  assetId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Sub de Cognito del especialista asignado. Es nulo mientras la solicitud no tiene asignación. No es un nombre de persona.',
    example: null,
  })
  assignedSpecialistSub!: string | null;

  @ApiProperty({ enum: POST_SALE_REQUEST_TYPES })
  type!: PostSaleRequestType;

  @ApiProperty()
  description!: string;

  @ApiProperty({
    description:
      'Inicio del periodo de evaluación, fecha UTC en formato YYYY-MM-DD.',
    example: '2026-09-01',
  })
  periodStart!: string;

  @ApiProperty({
    description:
      'Fin del periodo de evaluación, fecha UTC en formato YYYY-MM-DD.',
    example: '2026-09-30',
  })
  periodEnd!: string;

  @ApiProperty({ enum: POST_SALE_REQUEST_STATUSES })
  status!: PostSaleRequestStatus;

  @ApiProperty({
    description: 'Instante de creación en UTC.',
    example: '2026-10-02T15:00:00.000Z',
  })
  createdAt!: string;
}

export class AssignedSpecialistResponseDto {
  @ApiProperty({ nullable: true, example: 'Carlos' })
  firstName!: string | null;

  @ApiProperty({ nullable: true, example: 'Méndez' })
  lastName!: string | null;
}

export class PostSaleRequestDetailResponseDto {
  @ApiProperty({ example: '6f1c2a10-4b7e-4a1d-9c31-000000000001' })
  id!: string;

  @ApiProperty({ example: 'PV-24018' })
  ticketCode!: string;

  @ApiProperty({ example: 'CLI-10421' })
  customerId!: string;

  @ApiProperty({ example: 'Textiles del Altiplano S.A.S.' })
  customerName!: string;

  @ApiProperty({ example: 'Planta Fontibón' })
  facilityName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'MED-FTB-014' })
  assetId!: string | null;

  @ApiProperty({
    type: AssignedSpecialistResponseDto,
    nullable: true,
    description:
      'Nombre del especialista asignado. Es nulo cuando la solicitud no tiene asignación. No incluye el sub de Cognito.',
  })
  assignedSpecialist!: AssignedSpecialistResponseDto | null;

  @ApiProperty({ enum: POST_SALE_REQUEST_TYPES })
  type!: PostSaleRequestType;

  @ApiProperty()
  description!: string;

  @ApiProperty({
    description:
      'Inicio del periodo de evaluación, fecha calendario YYYY-MM-DD.',
    example: '2026-09-01',
  })
  periodStart!: string;

  @ApiProperty({
    description: 'Fin del periodo de evaluación, fecha calendario YYYY-MM-DD.',
    example: '2026-09-30',
  })
  periodEnd!: string;

  @ApiProperty({ enum: POST_SALE_REQUEST_STATUSES })
  status!: PostSaleRequestStatus;

  @ApiProperty({
    description: 'Instante de creación en UTC.',
    example: '2026-10-02T15:00:00.000Z',
  })
  createdAt!: string;
}

export class PostSaleRequestPageResponseDto {
  @ApiProperty({ type: [PostSaleRequestResponseDto] })
  items!: PostSaleRequestResponseDto[];

  @ApiProperty({ minimum: 1, example: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100, example: 20 })
  pageSize!: number;

  @ApiProperty({
    minimum: 0,
    description:
      'Cantidad de solicitudes visibles para el usuario después de aplicar asignación, estado y búsqueda. No incluye solicitudes de otros especialistas.',
    example: 3,
  })
  total!: number;
}

export class RequestActivityActorResponseDto {
  @ApiProperty({ example: 'Laura Pineda' })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'VALIDATOR' })
  role!: string | null;
}

export class RequestActivityResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: REQUEST_ACTIVITY_EVENTS })
  eventType!: RequestActivityEvent;

  @ApiProperty({ enum: POST_SALE_REQUEST_STATUSES, nullable: true })
  previousStatus!: PostSaleRequestStatus | null;

  @ApiProperty({ enum: POST_SALE_REQUEST_STATUSES, nullable: true })
  newStatus!: PostSaleRequestStatus | null;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: RequestActivityActorResponseDto, nullable: true })
  actor!: RequestActivityActorResponseDto | null;

  @ApiProperty({ type: String, nullable: true })
  technicalAnalysisId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  technicalReportId!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  reportVersion!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Contexto no sensible, como comentarios de validación u origen del informe.',
  })
  metadata!: Record<string, string>;

  @ApiProperty({ example: '2026-11-15T18:00:00.000Z' })
  createdAt!: string;
}

export class RequestActivityListResponseDto {
  @ApiProperty({ type: [RequestActivityResponseDto] })
  items!: RequestActivityResponseDto[];
}
