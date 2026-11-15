import { ApiProperty } from '@nestjs/swagger';
import {
  ANALYSIS_INTERPRETATIONS,
  ANALYSIS_STATUSES,
  type AnalysisInterpretation,
  type AnalysisStatus,
} from '../../domain/technical-analysis.js';
import { POST_SALE_REQUEST_TYPES } from '../../domain/post-sale-request.js';

export class AnalysisEvidenceResponseDto {
  @ApiProperty({ example: 'Lectura de demanda' })
  label!: string;

  @ApiProperty({ example: '267.250' })
  value!: string;

  @ApiProperty({ example: 'kW' })
  unit!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Instante UTC de la medición, cuando la evidencia es una lectura.',
    example: '2026-09-03T15:30:00.000Z',
  })
  measuredAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-01' })
  periodStart!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-30' })
  periodEnd!: string | null;
}

export class AnalysisFindingResponseDto {
  @ApiProperty({ example: 'DEMAND_EXCEEDANCE' })
  findingType!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ example: '267.250' })
  measuredValue!: string;

  @ApiProperty({ example: '250.000' })
  referenceValue!: string;

  @ApiProperty({ example: '17.250' })
  difference!: string;

  @ApiProperty({
    description:
      'Variación porcentual respecto del valor de referencia, con tres decimales.',
    example: '6.900',
  })
  percentage!: string;

  @ApiProperty({ example: 'kW' })
  unit!: string;

  @ApiProperty({ enum: ANALYSIS_INTERPRETATIONS })
  interpretation!: AnalysisInterpretation;

  @ApiProperty({ example: '2026-09-01' })
  periodStart!: string;

  @ApiProperty({ example: '2026-09-07' })
  periodEnd!: string;

  @ApiProperty({ type: [AnalysisEvidenceResponseDto] })
  evidence!: AnalysisEvidenceResponseDto[];
}

export class AnalysisInputSnapshotResponseDto {
  @ApiProperty({ enum: POST_SALE_REQUEST_TYPES })
  requestType!: string;

  @ApiProperty({ example: '2026-09-01' })
  periodStart!: string;

  @ApiProperty({ example: '2026-09-07' })
  periodEnd!: string;

  @ApiProperty({ type: String, nullable: true, example: '250.000' })
  demandThreshold!: string | null;

  @ApiProperty({ example: 'kW' })
  demandUnit!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  evaluationConsumption!: string | null;

  @ApiProperty({ example: 'kWh' })
  consumptionUnit!: string;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  telemetry!: ReadonlyArray<{ measuredAt: string; measuredDemand: string }>;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  historicalConsumption!: ReadonlyArray<{
    periodStart: string;
    periodEnd: string;
    consumption: string;
  }>;
}

export class TechnicalAnalysisResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  requestId!: string;

  @ApiProperty({ enum: ANALYSIS_STATUSES })
  status!: AnalysisStatus;

  @ApiProperty({
    description: 'Instante de ejecución en UTC.',
    example: '2026-11-15T02:10:00.000Z',
  })
  executedAt!: string;

  @ApiProperty({ type: String, nullable: true })
  failureMessage!: string | null;

  @ApiProperty({ type: [AnalysisFindingResponseDto] })
  findings!: AnalysisFindingResponseDto[];

  @ApiProperty({ type: AnalysisInputSnapshotResponseDto })
  inputSnapshot!: AnalysisInputSnapshotResponseDto;
}

export class TechnicalAnalysisListResponseDto {
  @ApiProperty({ type: [TechnicalAnalysisResponseDto] })
  items!: TechnicalAnalysisResponseDto[];
}

export class ExecuteTechnicalAnalysisDto {}
