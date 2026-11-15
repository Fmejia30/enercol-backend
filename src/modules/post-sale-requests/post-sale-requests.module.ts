import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { POST_SALE_REQUEST_REPOSITORY } from './application/post-sale-request.repository.js';
import { PostSaleRequestService } from './application/post-sale-request.service.js';
import { TECHNICAL_ANALYSIS_REPOSITORY } from './application/technical-analysis.repository.js';
import { TechnicalAnalysisService } from './application/technical-analysis.service.js';
import { TECHNICAL_DATASET_REPOSITORY } from './application/technical-dataset.repository.js';
import { PrismaPostSaleRequestRepository } from './infrastructure/prisma-post-sale-request.repository.js';
import { PrismaTechnicalAnalysisRepository } from './infrastructure/prisma-technical-analysis.repository.js';
import { PrismaTechnicalDatasetRepository } from './infrastructure/prisma-technical-dataset.repository.js';
import { PostSaleRequestsController } from './presentation/post-sale-requests.controller.js';
import { TechnicalAnalysisCatalogController } from './presentation/technical-analysis-catalog.controller.js';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [PostSaleRequestsController, TechnicalAnalysisCatalogController],
  providers: [
    PostSaleRequestService,
    TechnicalAnalysisService,
    {
      provide: POST_SALE_REQUEST_REPOSITORY,
      useClass: PrismaPostSaleRequestRepository,
    },
    {
      provide: TECHNICAL_DATASET_REPOSITORY,
      useClass: PrismaTechnicalDatasetRepository,
    },
    {
      provide: TECHNICAL_ANALYSIS_REPOSITORY,
      useClass: PrismaTechnicalAnalysisRepository,
    },
  ],
  exports: [PostSaleRequestService, TechnicalAnalysisService],
})
export class PostSaleRequestsModule {}
