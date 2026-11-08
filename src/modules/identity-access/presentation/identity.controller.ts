import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';
import { AUTHENTICATION_FAILED_MESSAGE } from './jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import { AuthenticatedUserResponseDto } from './dto/authenticated-user-response.dto.js';
import { Authenticated } from './roles.decorator.js';

@ApiTags('identity')
@ApiBearerAuth()
@Controller('identity')
export class IdentityController {
  @Get('me')
  @Authenticated()
  @ApiOperation({
    summary:
      'Devuelve la identidad autenticada y los roles reconocidos del access token',
  })
  @ApiOkResponse({ type: AuthenticatedUserResponseDto })
  @ApiUnauthorizedResponse({ description: AUTHENTICATION_FAILED_MESSAGE })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUserResponseDto {
    return {
      userId: user.userId,
      roles: [...user.roles],
    };
  }
}
