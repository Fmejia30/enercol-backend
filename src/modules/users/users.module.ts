import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/database/prisma.module.js';
import { COGNITO_USER_ADMIN } from './application/cognito-user-admin.js';
import { InviteUserService } from './application/invite-user.service.js';
import { SelfProfileService } from './application/self-profile.service.js';
import { UserAdministrationService } from './application/user-administration.service.js';
import { USER_ADMINISTRATION_REPOSITORY } from './application/user-administration.repository.js';
import { UserDirectoryService } from './application/user-directory.service.js';
import { UserListCursorCodec } from './application/user-list-cursor.js';
import {
  INVITATION_CLOCK,
  USER_INVITATION_REPOSITORY,
} from './application/user-invitation.repository.js';
import { USER_DIRECTORY_REPOSITORY } from './application/user-directory.repository.js';
import {
  COGNITO_IDENTITY_PROVIDER_CLIENT,
  createCognitoIdentityProviderClient,
} from './infrastructure/cognito-identity-provider.js';
import { CognitoUserAdminClient } from './infrastructure/cognito-user-admin.client.js';
import { PrismaUserAdministrationRepository } from './infrastructure/prisma-user-administration.repository.js';
import { PrismaUserDirectoryRepository } from './infrastructure/prisma-user-directory.repository.js';
import { PrismaUserInvitationRepository } from './infrastructure/prisma-user-invitation.repository.js';
import { SelfProfileController } from './presentation/self-profile.controller.js';
import { UsersController } from './presentation/users.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [SelfProfileController, UsersController],
  providers: [
    InviteUserService,
    SelfProfileService,
    UserAdministrationService,
    UserDirectoryService,
    UserListCursorCodec,
    {
      provide: USER_DIRECTORY_REPOSITORY,
      useClass: PrismaUserDirectoryRepository,
    },
    {
      provide: USER_ADMINISTRATION_REPOSITORY,
      useClass: PrismaUserAdministrationRepository,
    },
    {
      provide: INVITATION_CLOCK,
      useValue: () => new Date(),
    },
    {
      provide: USER_INVITATION_REPOSITORY,
      useClass: PrismaUserInvitationRepository,
    },
    {
      provide: COGNITO_IDENTITY_PROVIDER_CLIENT,
      inject: [ConfigService],
      useFactory: createCognitoIdentityProviderClient,
    },
    {
      provide: COGNITO_USER_ADMIN,
      useClass: CognitoUserAdminClient,
    },
  ],
  exports: [COGNITO_USER_ADMIN],
})
export class UsersModule {}
