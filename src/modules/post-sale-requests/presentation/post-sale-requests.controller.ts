import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { AUTHENTICATION_FAILED_MESSAGE } from '../../identity-access/presentation/jwt-auth.guard.js';
import { CurrentUser } from '../../identity-access/presentation/current-user.decorator.js';
import { Roles } from '../../identity-access/presentation/roles.decorator.js';
import { ACCESS_DENIED_MESSAGE } from '../../identity-access/presentation/roles.guard.js';
import {
  PostSaleRequestService,
  type AssignedSpecialist,
} from '../application/post-sale-request.service.js';
import { TechnicalAnalysisService } from '../application/technical-analysis.service.js';
import type { TechnicalAnalysisRecord } from '../application/technical-analysis.repository.js';
import {
  InvalidEvaluationPeriodError,
  InvalidPostSaleRequestError,
  type PostSaleRequest,
} from '../domain/post-sale-request.js';
import {
  PostSaleRequestConflictError,
  PostSaleRequestForbiddenError,
  PostSaleRequestNotFoundError,
  PostSaleRequestPersistenceError,
  PostSaleRequestQueryError,
  TechnicalDatasetNotFoundError,
} from '../domain/post-sale-request-error.js';
import { CreatePostSaleRequestDto } from './dto/create-post-sale-request.dto.js';
import { ListPostSaleRequestsQueryDto } from './dto/list-post-sale-requests-query.dto.js';
import {
  PostSaleRequestDetailResponseDto,
  PostSaleRequestPageResponseDto,
  PostSaleRequestResponseDto,
  RequestActivityListResponseDto,
} from './dto/post-sale-request-response.dto.js';
import { TechnicalDatasetResponseDto } from './dto/technical-dataset-response.dto.js';
import {
  ExecuteTechnicalAnalysisDto,
  TechnicalAnalysisListResponseDto,
  TechnicalAnalysisResponseDto,
} from './dto/technical-analysis-response.dto.js';

const REQUEST_NOT_FOUND_MESSAGE =
  'No existe una solicitud con ese identificador';
const TECHNICAL_DATA_NOT_FOUND_MESSAGE =
  'No hay datos técnicos para esta solicitud';
const INVALID_QUERY_MESSAGE = 'La consulta de solicitudes no es válida';
const INVALID_REQUEST_MESSAGE = 'La solicitud postventa no es válida';
const CONFLICT_MESSAGE = 'Ya existe una solicitud con ese identificador';
const PERSISTENCE_MESSAGE = 'No fue posible registrar la solicitud';

const ASSIGNMENT_DESCRIPTION =
  'Autenticación por cookie de sesión BFF o access token Bearer de Cognito. SPECIALIST y VALIDATOR solo acceden a solicitudes cuyo especialista asignado es su propio sub. Una solicitud sin especialista asignado solo es visible para ADMINISTRATOR. ADMINISTRATOR accede a todas las solicitudes. El servicio ignora cualquier identificador de usuario, estado o fecha enviados por el cliente. Una solicitud inexistente y una solicitud no visible responden 404 con el mismo mensaje.';

@ApiTags('post-sale-requests')
@ApiBearerAuth()
@Roles(UserRole.SPECIALIST, UserRole.VALIDATOR, UserRole.ADMINISTRATOR)
@Controller('post-sale-requests')
export class PostSaleRequestsController {
  constructor(
    private readonly requests: PostSaleRequestService,
    private readonly analyses: TechnicalAnalysisService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista las solicitudes postventa visibles para el usuario',
    description: ASSIGNMENT_DESCRIPTION,
  })
  @ApiOkResponse({ type: PostSaleRequestPageResponseDto })
  @ApiBadRequestResponse({ description: INVALID_QUERY_MESSAGE })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListPostSaleRequestsQueryDto,
  ): Promise<PostSaleRequestPageResponseDto> {
    try {
      const page = await this.requests.list(actor, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        search: query.search,
      });
      return {
        items: page.items.map((request) => toResponse(request)),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Get(':id/technical-data')
  @ApiOperation({
    summary: 'Consulta el conjunto técnico controlado de una solicitud visible',
    description:
      'Devuelve el umbral contractual, la telemetría del periodo de evaluación y el consumo histórico asociado. Usa la misma visibilidad que el detalle: un especialista solo consulta los casos asignados a su sub. No ejecuta análisis ni genera un informe.',
  })
  @ApiOkResponse({ type: TechnicalDatasetResponseDto })
  @ApiNotFoundResponse({
    description: `${REQUEST_NOT_FOUND_MESSAGE}. ${TECHNICAL_DATA_NOT_FOUND_MESSAGE}.`,
  })
  async technicalData(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TechnicalDatasetResponseDto> {
    try {
      return await this.requests.getTechnicalDataset(actor, id);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Get(':id/analyses')
  @ApiOperation({
    summary: 'Consulta las ejecuciones de análisis de una solicitud visible',
    description:
      'Devuelve las ejecuciones más recientes primero. Usa la misma visibilidad que el detalle. No incluye el sub de quien ejecutó el análisis.',
  })
  @ApiOkResponse({ type: TechnicalAnalysisListResponseDto })
  @ApiNotFoundResponse({ description: REQUEST_NOT_FOUND_MESSAGE })
  async analysesForRequest(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TechnicalAnalysisListResponseDto> {
    try {
      const items = await this.analyses.list(actor, id);
      return { items: items.map((analysis) => toAnalysisResponse(analysis)) };
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Post(':id/analyses')
  @Roles(UserRole.SPECIALIST, UserRole.ADMINISTRATOR)
  @ApiOperation({
    summary:
      'Ejecuta el análisis técnico determinista de una solicitud visible',
    description:
      'El servidor lee el conjunto técnico, calcula los hallazgos y los persiste. El cliente no puede enviar resultados. Cada ejecución se conserva. SPECIALIST y ADMINISTRATOR pueden ejecutarla cuando la solicitud les es visible. VALIDATOR no puede ejecutarla.',
  })
  @ApiCreatedResponse({ type: TechnicalAnalysisResponseDto })
  @ApiBadRequestResponse({
    description: 'El cuerpo no puede incluir hallazgos ni valores calculados.',
  })
  @ApiNotFoundResponse({
    description: `${REQUEST_NOT_FOUND_MESSAGE}. ${TECHNICAL_DATA_NOT_FOUND_MESSAGE}.`,
  })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  async executeAnalysis(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ExecuteTechnicalAnalysisDto,
  ): Promise<TechnicalAnalysisResponseDto> {
    void body;
    try {
      return toAnalysisResponse(await this.analyses.execute(actor, id));
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Get(':id/activity')
  @ApiOperation({
    summary: 'Consulta el historial de actividad de una solicitud',
    description:
      'Devuelve los eventos más recientes primero. Usa la misma visibilidad que el detalle de la solicitud y no incluye sujetos de Cognito.',
  })
  @ApiOkResponse({ type: RequestActivityListResponseDto })
  @ApiNotFoundResponse({ description: REQUEST_NOT_FOUND_MESSAGE })
  async activity(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RequestActivityListResponseDto> {
    try {
      return { items: [...(await this.requests.activity(actor, id))] };
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulta el contexto de una solicitud postventa',
    description: `${ASSIGNMENT_DESCRIPTION} El especialista asignado se devuelve con nombre y apellido, sin el sub de Cognito.`,
  })
  @ApiOkResponse({ type: PostSaleRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: REQUEST_NOT_FOUND_MESSAGE })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  async getOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PostSaleRequestDetailResponseDto> {
    try {
      const detail = await this.requests.getDetail(actor, id);
      return toDetailResponse(detail.request, detail.assignedSpecialist);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Post()
  @Roles(UserRole.SPECIALIST, UserRole.ADMINISTRATOR)
  @ApiOperation({
    summary: 'Registra una solicitud postventa',
    description:
      'El identificador, el código de ticket, el estado inicial RECEIVED y las fechas de auditoría los genera el servidor. La solicitud queda sin especialista asignado. El cliente no puede elegir el especialista, el estado ni el ticket. SPECIALIST y ADMINISTRATOR pueden registrarla. VALIDATOR no puede.',
  })
  @ApiCreatedResponse({ type: PostSaleRequestResponseDto })
  @ApiBadRequestResponse({ description: INVALID_REQUEST_MESSAGE })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  @ApiConflictResponse({ description: CONFLICT_MESSAGE })
  @ApiServiceUnavailableResponse({ description: PERSISTENCE_MESSAGE })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreatePostSaleRequestDto,
  ): Promise<PostSaleRequestResponseDto> {
    try {
      return toResponse(
        await this.requests.create(actor, {
          customerId: body.customerId,
          customerName: body.customerName,
          facilityName: body.facilityName,
          assetId: body.assetId,
          type: body.type,
          description: body.description,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
        }),
      );
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  private toHttp(error: unknown): Error {
    if (error instanceof PostSaleRequestNotFoundError) {
      return new NotFoundException(REQUEST_NOT_FOUND_MESSAGE);
    }
    if (error instanceof TechnicalDatasetNotFoundError) {
      return new NotFoundException(TECHNICAL_DATA_NOT_FOUND_MESSAGE);
    }
    if (error instanceof PostSaleRequestQueryError) {
      return new BadRequestException(INVALID_QUERY_MESSAGE);
    }
    if (
      error instanceof InvalidEvaluationPeriodError ||
      error instanceof InvalidPostSaleRequestError
    ) {
      return new BadRequestException(INVALID_REQUEST_MESSAGE);
    }
    if (error instanceof PostSaleRequestForbiddenError) {
      return new ForbiddenException(ACCESS_DENIED_MESSAGE);
    }
    if (error instanceof PostSaleRequestConflictError) {
      return new ConflictException(CONFLICT_MESSAGE);
    }
    if (error instanceof PostSaleRequestPersistenceError) {
      return new ServiceUnavailableException(PERSISTENCE_MESSAGE);
    }
    return error instanceof Error
      ? error
      : new BadRequestException(INVALID_QUERY_MESSAGE);
  }
}

function toDetailResponse(
  request: PostSaleRequest,
  assignedSpecialist: AssignedSpecialist | null,
): PostSaleRequestDetailResponseDto {
  return {
    id: request.id,
    ticketCode: request.ticketCode,
    customerId: request.customerId,
    customerName: request.customerName,
    facilityName: request.facilityName,
    assetId: request.assetId,
    assignedSpecialist,
    type: request.type,
    description: request.description,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  };
}

function toAnalysisResponse(
  analysis: TechnicalAnalysisRecord,
): TechnicalAnalysisResponseDto {
  return {
    id: analysis.id,
    requestId: analysis.requestId,
    status: analysis.status,
    executedAt: analysis.executedAt.toISOString(),
    failureMessage: analysis.failureMessage,
    findings: analysis.findings.map((finding) => ({
      ...finding,
      evidence: finding.evidence.map((item) => ({ ...item })),
    })),
    inputSnapshot: {
      ...analysis.inputSnapshot,
      telemetry: analysis.inputSnapshot.telemetry.map((reading) => ({
        ...reading,
      })),
      historicalConsumption: analysis.inputSnapshot.historicalConsumption.map(
        (row) => ({ ...row }),
      ),
    },
  };
}

function toResponse(request: PostSaleRequest): PostSaleRequestResponseDto {
  return {
    id: request.id,
    ticketCode: request.ticketCode,
    customerId: request.customerId,
    customerName: request.customerName,
    facilityName: request.facilityName,
    assetId: request.assetId,
    assignedSpecialistSub: request.assignedSpecialistSub,
    type: request.type,
    description: request.description,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  };
}
