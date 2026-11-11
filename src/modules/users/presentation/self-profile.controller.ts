import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { AUTHENTICATION_FAILED_MESSAGE } from '../../identity-access/presentation/jwt-auth.guard.js';
import { CurrentUser } from '../../identity-access/presentation/current-user.decorator.js';
import { Authenticated } from '../../identity-access/presentation/roles.decorator.js';
import { SelfProfileService } from '../application/self-profile.service.js';
import {
  UserAdministrationFailedError,
  UserAdministrationQueryError,
} from '../domain/user-administration.js';
import { OwnProfileResponseDto } from './dto/own-profile-response.dto.js';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto.js';

const INVALID_PROFILE_MESSAGE = 'La solicitud de actualización no es válida';
const PROFILE_INCOMPLETE_MESSAGE =
  'Para crear el perfil se requieren nombre, apellido y teléfono';
const PROFILE_FAILED_MESSAGE = 'No fue posible actualizar el perfil';

@ApiTags('users')
@ApiBearerAuth()
@Authenticated()
@Controller('users')
export class SelfProfileController {
  constructor(private readonly profiles: SelfProfileService) {}

  @Get('me')
  @ApiOperation({ summary: 'Consulta el perfil del usuario autenticado' })
  @ApiOkResponse({ type: OwnProfileResponseDto })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  async getMe(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OwnProfileResponseDto> {
    try {
      return await this.profiles.get(actor);
    } catch (error) {
      throw this.profileError(error);
    }
  }

  @Patch('me')
  @ApiOperation({ summary: 'Actualiza el perfil del usuario autenticado' })
  @ApiOkResponse({ type: OwnProfileResponseDto })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiServiceUnavailableResponse({ description: PROFILE_FAILED_MESSAGE })
  async updateMe(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdateOwnProfileDto,
  ): Promise<OwnProfileResponseDto> {
    try {
      return await this.profiles.update(actor, {
        firstName: body.firstName,
        lastName: body.lastName,
        phoneNumber: body.phoneNumber,
      });
    } catch (error) {
      throw this.profileError(error);
    }
  }

  private profileError(error: unknown): Error {
    if (error instanceof UserAdministrationQueryError) {
      return new BadRequestException(
        error.reason === 'profile_incomplete'
          ? PROFILE_INCOMPLETE_MESSAGE
          : INVALID_PROFILE_MESSAGE,
      );
    }
    if (error instanceof UserAdministrationFailedError) {
      return new ServiceUnavailableException(PROFILE_FAILED_MESSAGE);
    }
    return error instanceof Error
      ? error
      : new ServiceUnavailableException(PROFILE_FAILED_MESSAGE);
  }
}
