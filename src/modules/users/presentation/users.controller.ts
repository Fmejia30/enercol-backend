import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
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
import { InviteUserService } from '../application/invite-user.service.js';
import { UserAdministrationService } from '../application/user-administration.service.js';
import { UserDirectoryService } from '../application/user-directory.service.js';
import {
  InvalidInvitationError,
  InvitationFailedError,
  InvitationForbiddenError,
  UserAlreadyExistsError,
} from '../domain/invitation-failure.js';
import {
  UserDirectoryFailedError,
  UserDirectoryNotFoundError,
  UserDirectoryQueryError,
} from '../domain/user-directory-error.js';
import {
  UserAdministrationFailedError,
  UserAdministrationForbiddenError,
  UserAdministrationNotFoundError,
  UserAdministrationQueryError,
} from '../domain/user-administration.js';
import {
  DirectoryUserDetailResponseDto,
  DirectoryUserPageResponseDto,
} from './dto/directory-user-response.dto.js';
import { InviteUserDto } from './dto/invite-user.dto.js';
import { InvitedUserResponseDto } from './dto/invited-user-response.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

const DUPLICATE_USER_MESSAGE = 'Ya existe un usuario con ese correo';
const INVALID_INVITATION_MESSAGE = 'La solicitud de invitación no es válida';
const INVITATION_FAILED_MESSAGE = 'No fue posible crear la invitación';
const INVALID_DIRECTORY_QUERY_MESSAGE = 'La consulta de usuarios no es válida';
const USER_NOT_FOUND_MESSAGE = 'No existe un usuario con ese identificador';
const DIRECTORY_FAILED_MESSAGE = 'No fue posible consultar los usuarios';
const INVALID_USER_CHANGE_MESSAGE = 'La solicitud de actualización no es válida';
const PROFILE_INCOMPLETE_MESSAGE =
  'Para crear el perfil se requieren nombre, apellido y teléfono';
const SELF_DISABLE_MESSAGE = 'No puede deshabilitar su propia cuenta';
const USER_UPDATE_FAILED_MESSAGE = 'No fue posible actualizar el usuario';

@ApiTags('users')
@ApiBearerAuth()
@Roles(UserRole.ADMINISTRATOR)
@Controller('users')
export class UsersController {
  constructor(
    private readonly inviteUser: InviteUserService,
    private readonly directory: UserDirectoryService,
    private readonly administration: UserAdministrationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista las cuentas de Cognito con perfil e invitación',
  })
  @ApiOkResponse({ type: DirectoryUserPageResponseDto })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  async list(
    @Query() query: ListUsersQueryDto,
  ): Promise<DirectoryUserPageResponseDto> {
    try {
      return await this.directory.list({
        pageSize: query.pageSize,
        nextToken: query.nextToken,
        search: query.search,
        accountStatus: query.status,
        role: query.role,
      });
    } catch (error) {
      throw this.directoryError(error);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consulta una cuenta por su sub de Cognito' })
  @ApiOkResponse({ type: DirectoryUserDetailResponseDto })
  @ApiNotFoundResponse({ description: USER_NOT_FOUND_MESSAGE })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  async getOne(
    @Param('id') id: string,
  ): Promise<DirectoryUserDetailResponseDto> {
    try {
      return await this.directory.getBySub(id);
    } catch (error) {
      throw this.directoryError(error);
    }
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Habilita o deshabilita una cuenta de Cognito' })
  @ApiOkResponse({ type: DirectoryUserDetailResponseDto })
  @ApiNotFoundResponse({ description: USER_NOT_FOUND_MESSAGE })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  @ApiServiceUnavailableResponse({ description: USER_UPDATE_FAILED_MESSAGE })
  async setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateUserStatusDto,
  ): Promise<DirectoryUserDetailResponseDto> {
    try {
      return await this.administration.setStatus(actor, id, body.enabled);
    } catch (error) {
      throw this.administrationError(error);
    }
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualiza el perfil administrativo y los roles de una cuenta',
  })
  @ApiOkResponse({ type: DirectoryUserDetailResponseDto })
  @ApiNotFoundResponse({ description: USER_NOT_FOUND_MESSAGE })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  @ApiServiceUnavailableResponse({ description: USER_UPDATE_FAILED_MESSAGE })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ): Promise<DirectoryUserDetailResponseDto> {
    try {
      return await this.administration.update(actor, id, {
        firstName: body.firstName,
        lastName: body.lastName,
        phoneNumber: body.phoneNumber,
        roles: body.roles,
      });
    } catch (error) {
      throw this.administrationError(error);
    }
  }

  @Post()
  @Roles(UserRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea un usuario en Cognito y registra su invitación',
  })
  @ApiCreatedResponse({ type: InvitedUserResponseDto })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: ACCESS_DENIED_MESSAGE })
  @ApiConflictResponse({ description: DUPLICATE_USER_MESSAGE })
  @ApiServiceUnavailableResponse({ description: INVITATION_FAILED_MESSAGE })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: InviteUserDto,
  ): Promise<InvitedUserResponseDto> {
    try {
      const invited = await this.inviteUser.execute(actor, {
        email: body.email,
        roles: body.roles,
      });
      return {
        id: invited.id,
        email: invited.email,
        roles: [...invited.roles],
        status: invited.status,
        expiresAt: invited.expiresAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) {
        throw new ConflictException(DUPLICATE_USER_MESSAGE);
      }
      if (error instanceof InvitationForbiddenError) {
        throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
      }
      if (error instanceof InvalidInvitationError) {
        throw new BadRequestException(INVALID_INVITATION_MESSAGE);
      }
      if (error instanceof InvitationFailedError) {
        throw new ServiceUnavailableException(INVITATION_FAILED_MESSAGE);
      }
      throw error;
    }
  }

  private administrationError(error: unknown): Error {
    if (error instanceof UserAdministrationForbiddenError) {
      return new ForbiddenException(SELF_DISABLE_MESSAGE);
    }
    if (error instanceof UserAdministrationQueryError) {
      return new BadRequestException(
        error.reason === 'profile_incomplete'
          ? PROFILE_INCOMPLETE_MESSAGE
          : INVALID_USER_CHANGE_MESSAGE,
      );
    }
    if (error instanceof UserAdministrationNotFoundError) {
      return new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }
    if (error instanceof UserAdministrationFailedError) {
      return new ServiceUnavailableException(USER_UPDATE_FAILED_MESSAGE);
    }
    return this.directoryError(error);
  }

  private directoryError(error: unknown): Error {
    if (error instanceof UserDirectoryQueryError) {
      return new BadRequestException(INVALID_DIRECTORY_QUERY_MESSAGE);
    }
    if (error instanceof UserDirectoryNotFoundError) {
      return new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }
    if (error instanceof UserDirectoryFailedError) {
      return new ServiceUnavailableException(DIRECTORY_FAILED_MESSAGE);
    }
    return error instanceof Error
      ? error
      : new ServiceUnavailableException(DIRECTORY_FAILED_MESSAGE);
  }
}
