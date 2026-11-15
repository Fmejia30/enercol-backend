import type { RequestActivityEvent } from '../domain/request-activity.js';
import type {
  PostSaleRequest,
  PostSaleRequestStatus,
  RequestVisibility,
} from '../domain/post-sale-request.js';

export interface ListPostSaleRequestsCriteria {
  readonly visibility: RequestVisibility;
  readonly status?: PostSaleRequestStatus;
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface PostSaleRequestPage {
  readonly items: readonly PostSaleRequest[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface AppendRequestActivity {
  readonly id: string;
  readonly requestId: string;
  readonly eventType: RequestActivityEvent;
  readonly description: string;
  readonly actorSub: string | null;
  readonly actorRole: string | null;
  readonly technicalAnalysisId: string | null;
  readonly technicalReportId: string | null;
  readonly reportVersion: number | null;
  readonly metadata: Readonly<Record<string, string>> | null;
  readonly dedupeKey: string;
  readonly createdAt: Date;
}

export interface RequestActivityRecord {
  readonly id: string;
  readonly requestId: string;
  readonly eventType: RequestActivityEvent;
  readonly previousStatus: PostSaleRequestStatus | null;
  readonly newStatus: PostSaleRequestStatus | null;
  readonly description: string;
  readonly actorSub: string | null;
  readonly actorRole: string | null;
  readonly technicalAnalysisId: string | null;
  readonly technicalReportId: string | null;
  readonly reportVersion: number | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly createdAt: Date;
}

export interface PostSaleRequestRepository {
  list(criteria: ListPostSaleRequestsCriteria): Promise<PostSaleRequestPage>;
  findById(id: string): Promise<PostSaleRequest | null>;
  allocateTicketCode(): Promise<string>;
  insert(request: PostSaleRequest): Promise<PostSaleRequest>;
  appendActivity(activity: AppendRequestActivity): Promise<void>;
  listActivity(requestId: string): Promise<readonly RequestActivityRecord[]>;
}

export const POST_SALE_REQUEST_REPOSITORY = Symbol(
  'POST_SALE_REQUEST_REPOSITORY',
);
