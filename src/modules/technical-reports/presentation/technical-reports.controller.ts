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
  MalformedPrivacyTokenError,
  PrivacyAuthorizationError,
  PrivacyProtectionError,
  UnknownPrivacyTokenError,
} from '../../privacy/domain/privacy-error.js';
import {
  PostSaleRequestForbiddenError,
  PostSaleRequestNotFoundError,
  PostSaleRequestPersistenceError,
  TechnicalDatasetNotFoundError,
} from '../../post-sale-requests/domain/post-sale-request-error.js';
import { TechnicalReportService } from '../application/technical-report.service.js';
import {
  ReportContentInvalidError,
  ReportGenerationConflictError,
  ReportNotFoundError,
  ReportPrerequisiteError,
  ReportProviderUnavailableError,
  ReportRevisionConflictError,
  ReportSaveUnavailableError,
  ReportWorkflowError,
} from '../domain/report-error.js';
import {
  ApprovedTechnicalReportResponseDto,
  GenerateTechnicalReportDto,
  ListPendingTechnicalReportsQueryDto,
  PendingTechnicalReportPageResponseDto,
  ReviewCommentDto,
  SaveTechnicalReportRevisionDto,
  TechnicalReportCatalogResponseDto,
  TechnicalReportListResponseDto,
  TechnicalReportResponseDto,
  TechnicalReportReviewListResponseDto,
  TechnicalReportReviewPacketResponseDto,
} from './dto/technical-report-response.dto.js';

const REQUEST_NOT_FOUND_MESSAGE =
  'No existe una solicitud con ese identificador';
const TECHNICAL_DATA_NOT_FOUND_MESSAGE =
  'No hay datos técnicos para esta solicitud';
const REPORT_UNAVAILABLE_MESSAGE = 'No fue posible generar el informe';

@ApiTags('post-sale-requests')
@ApiBearerAuth()
@Roles(UserRole.SPECIALIST, UserRole.VALIDATOR, UserRole.ADMINISTRATOR)
@Controller('post-sale-requests')
export class TechnicalReportsController {
  constructor(private readonly reports: TechnicalReportService) {}

  @Post(':id/reports')
  @Roles(UserRole.SPECIALIST, UserRole.ADMINISTRATOR)
  @ApiOperation({
    summary: 'Genera un borrador de informe técnico para una solicitud visible',
    description:
      'Usa el análisis determinista exitoso más reciente. El cliente no envía el texto del informe. El resultado queda en estado DRAFT y no sustituye versiones anteriores. SPECIALIST y ADMINISTRATOR pueden generarlo. VALIDATOR no puede.',
  })
  @ApiCreatedResponse({ type: TechnicalReportResponseDto })
  @ApiBadRequestResponse({
    description:
      'No hay un análisis exitoso, o el informe no cumple las reglas del análisis.',
  })
  @ApiConflictResponse({
    description: 'Ya hay una generación en curso para esta solicitud.',
  })
  @ApiNotFoundResponse({ description: REQUEST_NOT_FOUND_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiServiceUnavailableResponse({ description: REPORT_UNAVAILABLE_MESSAGE })
  async generate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: GenerateTechnicalReportDto,
  ): Promise<TechnicalReportResponseDto> {
    void body;
    try {
      return await this.reports.generate(actor, id);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Post(':id/reports/:reportId/submit')
  @Roles(UserRole.SPECIALIST)
  @ApiOperation({
    summary: 'Envía la versión guardada más reciente a validación humana',
  })
  @ApiCreatedResponse({ type: TechnicalReportResponseDto })
  @ApiConflictResponse({ description: 'El informe no está en borrador o ya cambió.' })
  async submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<TechnicalReportResponseDto> {
    try {
      return await this.reports.submit(actor, id, reportId);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Post(':id/reports/:reportId/review/start')
  @Roles(UserRole.VALIDATOR)
  @ApiOperation({ summary: 'Inicia la revisión de la versión enviada' })
  @ApiCreatedResponse({ type: TechnicalReportResponseDto })
  async startReview(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<TechnicalReportResponseDto> {
    try {
      return await this.reports.startReview(actor, id, reportId);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Post(':id/reports/:reportId/review/approve')
  @Roles(UserRole.VALIDATOR)
  @ApiOperation({ summary: 'Aprueba exactamente la versión que está en revisión' })
  @ApiCreatedResponse({ type: TechnicalReportResponseDto })
  async approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<TechnicalReportResponseDto> {
    try {
      return await this.reports.approve(actor, id, reportId);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Post(':id/reports/:reportId/review/request-changes')
  @Roles(UserRole.VALIDATOR)
  @ApiOperation({ summary: 'Solicita correcciones con un comentario obligatorio' })
  @ApiCreatedResponse({ type: TechnicalReportResponseDto })
  async requestChanges(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() body: ReviewCommentDto,
  ): Promise<TechnicalReportResponseDto> {
    try {
      return await this.reports.requestChanges(actor, id, reportId, body.comments);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Post(':id/reports/:reportId/review/require-reanalysis')
  @Roles(UserRole.VALIDATOR)
  @ApiOperation({ summary: 'Pide repetir el análisis técnico con un comentario obligatorio' })
  @ApiCreatedResponse({ type: TechnicalReportResponseDto })
  async requireReanalysis(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() body: ReviewCommentDto,
  ): Promise<TechnicalReportResponseDto> {
    try {
      return await this.reports.requireReanalysis(actor, id, reportId, body.comments);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get(':id/reports/:reportId/reviews')
  @ApiOperation({ summary: 'Consulta el historial de validación del informe' })
  @ApiOkResponse({ type: TechnicalReportReviewListResponseDto })
  async reviews(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<TechnicalReportReviewListResponseDto> {
    try {
      return { items: await this.reports.reviews(actor, id, reportId) };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get(':id/reports/:reportId/review')
  @Roles(UserRole.VALIDATOR)
  @ApiOperation({
    summary: 'Consulta la versión enviada y su historial, sin permitir edición',
  })
  @ApiOkResponse({ type: TechnicalReportReviewPacketResponseDto })
  async reviewPacket(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<TechnicalReportReviewPacketResponseDto> {
    try {
      return await this.reports.reviewPacket(actor, id, reportId);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get(':id/reports/:reportId/approved')
  @ApiOperation({
    summary: 'Devuelve la versión aprobada para el PDF final',
    description:
      'Rechaza la solicitud si esa versión no tiene un registro de aprobación.',
  })
  @ApiOkResponse({ type: ApprovedTechnicalReportResponseDto })
  @ApiConflictResponse({ description: 'La versión no está aprobada.' })
  async approved(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<ApprovedTechnicalReportResponseDto> {
    try {
      return await this.reports.approvedDocument(actor, id, reportId);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Post(':id/reports/:reportId/revisions')
  @Roles(UserRole.SPECIALIST, UserRole.ADMINISTRATOR)
  @ApiOperation({
    summary: 'Guarda una edición como nueva versión del borrador',
    description:
      'No llama al modelo. Conserva la versión anterior y rechaza la edición si el informe ya cambió o si los valores deterministas no coinciden con el análisis. SPECIALIST y ADMINISTRATOR pueden guardar. VALIDATOR no puede.',
  })
  @ApiCreatedResponse({ type: TechnicalReportResponseDto })
  @ApiConflictResponse({
    description: 'El informe cambió. Vuelva a abrir la versión más reciente.',
  })
  async saveRevision(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() body: SaveTechnicalReportRevisionDto,
  ): Promise<TechnicalReportResponseDto> {
    try {
      return await this.reports.saveRevision(
        actor,
        id,
        reportId,
        body.baseVersion,
        body.content,
      );
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get(':id/reports/:reportId/versions')
  @ApiOperation({
    summary: 'Consulta el historial de versiones de un informe',
    description:
      'Devuelve las versiones de la solicitud, de la más reciente a la más antigua, cuando el informe pertenece a esa solicitud visible.',
  })
  @ApiOkResponse({ type: TechnicalReportListResponseDto })
  @ApiNotFoundResponse({ description: REQUEST_NOT_FOUND_MESSAGE })
  async versions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<TechnicalReportListResponseDto> {
    try {
      return { items: await this.reports.versions(actor, id, reportId) };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get(':id/reports/:reportId')
  @ApiOperation({
    summary: 'Consulta un borrador de informe por identificador',
  })
  @ApiOkResponse({ type: TechnicalReportResponseDto })
  @ApiNotFoundResponse({ description: REQUEST_NOT_FOUND_MESSAGE })
  async getOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
  ): Promise<TechnicalReportResponseDto> {
    try {
      return await this.reports.get(actor, id, reportId);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get(':id/reports')
  @ApiOperation({
    summary: 'Lista los borradores de informe de una solicitud visible',
    description:
      'Incluye el historial de versiones. No incluye el sub de quien generó el informe.',
  })
  @ApiOkResponse({ type: TechnicalReportListResponseDto })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TechnicalReportListResponseDto> {
    try {
      return { items: await this.reports.list(actor, id) };
    } catch (error) {
      throw toHttp(error);
    }
  }
}

function toHttp(error: unknown): Error {
  if (
    error instanceof PostSaleRequestNotFoundError ||
    error instanceof PrivacyAuthorizationError
  ) {
    return new NotFoundException(REQUEST_NOT_FOUND_MESSAGE);
  }
  if (error instanceof TechnicalDatasetNotFoundError) {
    return new NotFoundException(TECHNICAL_DATA_NOT_FOUND_MESSAGE);
  }
  if (error instanceof ReportNotFoundError) {
    return new NotFoundException(error.message);
  }
  if (error instanceof PostSaleRequestForbiddenError) {
    return new ForbiddenException(ACCESS_DENIED_MESSAGE);
  }
  if (
    error instanceof ReportPrerequisiteError ||
    error instanceof ReportContentInvalidError
  ) {
    return new BadRequestException(error.message);
  }
  if (
    error instanceof ReportGenerationConflictError ||
    error instanceof ReportRevisionConflictError
  ) {
    return new ConflictException(error.message);
  }
  if (error instanceof ReportWorkflowError) {
    if (error.kind === 'forbidden') return new ForbiddenException(error.message);
    if (error.kind === 'invalid') return new BadRequestException(error.message);
    return new ConflictException(error.message);
  }
  if (error instanceof ReportSaveUnavailableError) {
    return new ServiceUnavailableException(error.message);
  }
  if (
    error instanceof ReportProviderUnavailableError ||
    error instanceof PrivacyProtectionError ||
    error instanceof UnknownPrivacyTokenError ||
    error instanceof MalformedPrivacyTokenError ||
    error instanceof PostSaleRequestPersistenceError
  ) {
    return new ServiceUnavailableException(REPORT_UNAVAILABLE_MESSAGE);
  }
  return new ServiceUnavailableException(REPORT_UNAVAILABLE_MESSAGE);
}

@ApiTags('technical-reports')
@ApiBearerAuth()
@Roles(UserRole.SPECIALIST, UserRole.VALIDATOR, UserRole.ADMINISTRATOR)
@Controller('technical-reports')
export class TechnicalReportCatalogController {
  constructor(private readonly reports: TechnicalReportService) {}

  @Get('pending-review')
  @Roles(UserRole.VALIDATOR)
  @ApiOperation({
    summary: 'Lista los informes enviados que esperan validación humana',
  })
  @ApiOkResponse({ type: PendingTechnicalReportPageResponseDto })
  async pendingReview(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListPendingTechnicalReportsQueryDto,
  ): Promise<PendingTechnicalReportPageResponseDto> {
    try {
      return await this.reports.pendingReview(actor, query.page ?? 1, query.pageSize ?? 20);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Lista los informes visibles para el usuario',
    description:
      'Respeta la visibilidad de las solicitudes. No incluye el sub de quien creó el informe.',
  })
  @ApiOkResponse({ type: TechnicalReportCatalogResponseDto })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  async catalog(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TechnicalReportCatalogResponseDto> {
    try {
      return { items: await this.reports.catalog(actor) };
    } catch {
      throw new ServiceUnavailableException('No fue posible consultar los informes');
    }
  }
}
