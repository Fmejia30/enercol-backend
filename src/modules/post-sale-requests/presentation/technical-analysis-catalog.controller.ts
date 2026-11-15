import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { AUTHENTICATION_FAILED_MESSAGE } from '../../identity-access/presentation/jwt-auth.guard.js';
import { CurrentUser } from '../../identity-access/presentation/current-user.decorator.js';
import { Roles } from '../../identity-access/presentation/roles.decorator.js';
import {
  TechnicalAnalysisService,
  type TechnicalAnalysisCatalogItem,
} from '../application/technical-analysis.service.js';

const CATALOG_UNAVAILABLE_MESSAGE = 'No fue posible consultar los análisis técnicos';

class TechnicalAnalysisCatalogResponseDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  items!: TechnicalAnalysisCatalogItem[];
}

@ApiTags('technical-analyses')
@ApiBearerAuth()
@Roles(UserRole.SPECIALIST, UserRole.VALIDATOR, UserRole.ADMINISTRATOR)
@Controller('technical-analyses')
export class TechnicalAnalysisCatalogController {
  constructor(private readonly analyses: TechnicalAnalysisService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista los análisis técnicos visibles para el usuario',
    description:
      'Reutiliza las ejecuciones ya guardadas. No calcula un análisis nuevo y no incluye el sub de quien lo ejecutó.',
  })
  @ApiOkResponse({ type: TechnicalAnalysisCatalogResponseDto })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  async catalog(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ items: TechnicalAnalysisCatalogItem[] }> {
    try {
      return { items: await this.analyses.catalog(actor) };
    } catch {
      throw new ServiceUnavailableException(CATALOG_UNAVAILABLE_MESSAGE);
    }
  }
}
