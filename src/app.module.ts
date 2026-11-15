import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './infrastructure/database/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { IdentityAccessModule } from './modules/identity-access/identity-access.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PostSaleRequestsModule } from './modules/post-sale-requests/post-sale-requests.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { TechnicalReportsModule } from './modules/technical-reports/technical-reports.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    IdentityAccessModule,
    AuthModule,
    UsersModule,
    PostSaleRequestsModule,
    PrivacyModule,
    TechnicalReportsModule,
    HealthModule,
  ],
})
export class AppModule {}
