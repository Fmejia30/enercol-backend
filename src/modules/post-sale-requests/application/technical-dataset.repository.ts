import type { StoredTechnicalDataset } from '../domain/technical-dataset.js';

export interface TechnicalDatasetRepository {
  findByRequestId(requestId: string): Promise<StoredTechnicalDataset | null>;
}

export const TECHNICAL_DATASET_REPOSITORY = Symbol(
  'TECHNICAL_DATASET_REPOSITORY',
);
