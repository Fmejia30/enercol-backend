import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma.module.js';
import { PrivacyModule } from '../privacy/privacy.module.js';
import { PostSaleRequestsModule } from '../post-sale-requests/post-sale-requests.module.js';
import { UsersModule } from '../users/users.module.js';
import { REPORT_LANGUAGE_MODEL } from './application/report-language-model.js';
import { TechnicalReportService } from './application/technical-report.service.js';
import { TECHNICAL_REPORT_REPOSITORY } from './application/technical-report.repository.js';
import { OpenAiReportModel } from './infrastructure/openai-report-model.js';
import { PrismaTechnicalReportRepository } from './infrastructure/prisma-technical-report.repository.js';
import {
  TechnicalReportCatalogController,
  TechnicalReportsController,
} from './presentation/technical-reports.controller.js';

@Module({
  imports: [PrismaModule, PostSaleRequestsModule, PrivacyModule, UsersModule],
  controllers: [TechnicalReportsController, TechnicalReportCatalogController],
  providers: [
    TechnicalReportService,
    {
      provide: REPORT_LANGUAGE_MODEL,
      useClass: OpenAiReportModel,
    },
    {
      provide: TECHNICAL_REPORT_REPOSITORY,
      useClass: PrismaTechnicalReportRepository,
    },
  ],
})
export class TechnicalReportsModule {}
