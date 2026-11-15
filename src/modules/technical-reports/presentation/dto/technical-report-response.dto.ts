import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type {
  TechnicalReportCatalogItem,
  TechnicalReportReviewPacket,
  TechnicalReportView,
} from '../../application/technical-report.service.js';
import { REPORT_STATUSES } from '../../domain/report-workflow.js';

export class GenerateTechnicalReportDto {}

export class ReviewCommentDto {
  @ApiProperty({ example: 'Corregir el alcance antes de volver a enviar.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comments!: string;
}

export class ListPendingTechnicalReportsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
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
}

export class SaveTechnicalReportRevisionDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  baseVersion!: number;

  @ApiProperty({ type: Object })
  @IsObject()
  content!: Record<string, unknown>;
}

export class TechnicalReportGenerationResponseDto {
  @ApiProperty({ example: 'gpt-6-luna' })
  model!: string;

  @ApiProperty({ example: 'low' })
  reasoningEffort!: string;

  @ApiProperty({ type: Number, nullable: true, example: 1200 })
  inputTokens!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 800 })
  outputTokens!: number | null;
}

export class TechnicalReportAuthorResponseDto {
  @ApiProperty({ example: 'Carlos' })
  firstName!: string;

  @ApiProperty({ example: 'Méndez' })
  lastName!: string;
}

export class TechnicalReportResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  analysisId!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ enum: REPORT_STATUSES })
  status!: TechnicalReportView['status'];

  @ApiProperty({ type: Object })
  review!: TechnicalReportView['review'];

  @ApiProperty({ enum: ['AI', 'MANUAL'], example: 'AI' })
  origin!: 'AI' | 'MANUAL';

  @ApiProperty({ example: 1 })
  schemaVersion!: number;

  @ApiProperty({ type: Object })
  content!: TechnicalReportView['content'];

  @ApiProperty({ type: TechnicalReportGenerationResponseDto })
  generation!: TechnicalReportGenerationResponseDto;

  @ApiProperty({ type: TechnicalReportAuthorResponseDto, nullable: true })
  createdBy!: TechnicalReportAuthorResponseDto | null;

  @ApiProperty({
    description: 'Instante UTC de creación.',
    example: '2026-11-14T18:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Instante UTC de la última actualización.',
    example: '2026-11-14T18:00:00.000Z',
  })
  updatedAt!: string;
}

export class TechnicalReportListResponseDto {
  @ApiProperty({ type: [TechnicalReportResponseDto] })
  items!: TechnicalReportResponseDto[];
}

export class TechnicalReportCatalogEntryResponseDto {
  @ApiProperty()
  ticketCode!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty()
  facilityName!: string;

  @ApiProperty()
  requestType!: string;

  @ApiProperty({ type: TechnicalReportResponseDto })
  report!: TechnicalReportCatalogItem['report'];
}

export class TechnicalReportCatalogResponseDto {
  @ApiProperty({ type: [TechnicalReportCatalogEntryResponseDto] })
  items!: TechnicalReportCatalogEntryResponseDto[];
}

export class TechnicalReportReviewItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  reportId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  type!: string;

  @ApiProperty({ nullable: true, type: String })
  comments!: string | null;

  @ApiProperty()
  at!: string;

  @ApiProperty({ type: TechnicalReportAuthorResponseDto, nullable: true })
  by!: TechnicalReportAuthorResponseDto | null;
}

export class TechnicalReportReviewListResponseDto {
  @ApiProperty({ type: [TechnicalReportReviewItemResponseDto] })
  items!: TechnicalReportReviewItemResponseDto[];
}

export class TechnicalReportReviewPacketResponseDto {
  @ApiProperty({ type: Object })
  request!: TechnicalReportReviewPacket['request'];

  @ApiProperty({ type: [TechnicalReportResponseDto] })
  reports!: TechnicalReportResponseDto[];

  @ApiProperty({ type: [TechnicalReportReviewItemResponseDto] })
  reviews!: TechnicalReportReviewItemResponseDto[];
}

export class PendingTechnicalReportItemResponseDto {
  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  reportId!: string;

  @ApiProperty()
  ticketCode!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty()
  facilityName!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ enum: REPORT_STATUSES })
  status!: TechnicalReportView['status'];

  @ApiProperty({ nullable: true, type: String })
  submittedAt!: string | null;

  @ApiProperty({ type: TechnicalReportAuthorResponseDto, nullable: true })
  submittedBy!: TechnicalReportAuthorResponseDto | null;
}

export class PendingTechnicalReportPageResponseDto {
  @ApiProperty({ type: [PendingTechnicalReportItemResponseDto] })
  items!: PendingTechnicalReportItemResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class TechnicalReportApprovalResponseDto {
  @ApiProperty()
  version!: number;

  @ApiProperty()
  approvedAt!: string;

  @ApiProperty({ type: TechnicalReportAuthorResponseDto, nullable: true })
  approver!: TechnicalReportAuthorResponseDto | null;
}

export class ApprovedTechnicalReportResponseDto {
  @ApiProperty({ type: TechnicalReportResponseDto })
  report!: TechnicalReportResponseDto;

  @ApiProperty({ type: TechnicalReportApprovalResponseDto })
  approval!: TechnicalReportApprovalResponseDto;
}
