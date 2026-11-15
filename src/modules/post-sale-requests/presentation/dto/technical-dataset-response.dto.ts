import { ApiProperty } from '@nestjs/swagger';

export class TelemetryReadingResponseDto {
  @ApiProperty({
    description: 'Instante de la medición en UTC.',
    example: '2026-09-03T15:30:00.000Z',
  })
  measuredAt!: string;

  @ApiProperty({
    description:
      'Demanda medida, con tres decimales, en la unidad del conjunto.',
    example: '267.250',
  })
  measuredDemand!: string;
}

export class HistoricalConsumptionResponseDto {
  @ApiProperty({ example: '2026-08-01' })
  periodStart!: string;

  @ApiProperty({ example: '2026-08-31' })
  periodEnd!: string;

  @ApiProperty({
    description: 'Consumo resumido del mes, con tres decimales.',
    example: '148750.500',
  })
  consumption!: string;
}

export class TechnicalDatasetResponseDto {
  @ApiProperty()
  requestId!: string;

  @ApiProperty({ example: '2026-09-01' })
  periodStart!: string;

  @ApiProperty({ example: '2026-09-07' })
  periodEnd!: string;

  @ApiProperty({
    description:
      'Umbral contractual de demanda, con tres decimales, en demandUnit. Nulo cuando el caso no compara demanda.',
    example: '250.000',
    nullable: true,
  })
  demandThreshold!: string | null;

  @ApiProperty({ example: 'kW' })
  demandUnit!: string;

  @ApiProperty({
    description:
      'Consumo del periodo de evaluación, con tres decimales, en consumptionUnit. Nulo cuando el caso no compara consumo.',
    example: '124800.000',
    nullable: true,
  })
  evaluationConsumption!: string | null;

  @ApiProperty({ example: 'kWh' })
  consumptionUnit!: string;

  @ApiProperty({ example: 'Conjunto técnico controlado Act-05' })
  sourceName!: string;

  @ApiProperty({
    description:
      'Origen del conjunto. local-controlled-dataset indica una medición de prueba local.',
    example: 'local-controlled-dataset',
  })
  sourceKind!: string;

  @ApiProperty({ type: [TelemetryReadingResponseDto] })
  telemetry!: TelemetryReadingResponseDto[];

  @ApiProperty({ type: [HistoricalConsumptionResponseDto] })
  historicalConsumption!: HistoricalConsumptionResponseDto[];
}
