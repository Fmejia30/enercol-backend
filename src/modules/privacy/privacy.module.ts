import { Module } from '@nestjs/common';
import { PostSaleRequestsModule } from '../post-sale-requests/post-sale-requests.module.js';
import { PRIVACY_CIPHER } from './application/privacy-cipher.js';
import { PrivacyService } from './application/privacy.service.js';
import { TOKEN_VAULT_REPOSITORY } from './application/token-vault.repository.js';
import { AesGcmPrivacyCipher } from './infrastructure/aes-gcm-privacy-cipher.js';
import { MongoTokenVaultRepository } from './infrastructure/mongo-token-vault.repository.js';

@Module({
  imports: [PostSaleRequestsModule],
  providers: [
    PrivacyService,
    AesGcmPrivacyCipher,
    MongoTokenVaultRepository,
    { provide: PRIVACY_CIPHER, useExisting: AesGcmPrivacyCipher },
    {
      provide: TOKEN_VAULT_REPOSITORY,
      useExisting: MongoTokenVaultRepository,
    },
  ],
  exports: [PrivacyService],
})
export class PrivacyModule {}
