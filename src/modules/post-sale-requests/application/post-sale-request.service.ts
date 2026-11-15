import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import {
  PostSaleRequestConflictError,
  PostSaleRequestForbiddenError,
  PostSaleRequestNotFoundError,
  PostSaleRequestPersistenceError,
  PostSaleRequestQueryError,
  TechnicalDatasetNotFoundError,
} from '../domain/post-sale-request-error.js';
import {
  createPostSaleRequest,
  isRequestVisible,
  requestVisibility,
  type PostSaleRequest,
  type PostSaleRequestStatus,
  type PostSaleRequestType,
} from '../domain/post-sale-request.js';
import {
  activityDescription,
  type RequestActivityEvent,
} from '../domain/request-activity.js';
import {
  presentTechnicalDataset,
  type TechnicalDataset,
} from '../domain/technical-dataset.js';
import {
  POST_SALE_REQUEST_REPOSITORY,
  type PostSaleRequestPage,
  type PostSaleRequestRepository,
} from './post-sale-request.repository.js';
import {
  TECHNICAL_DATASET_REPOSITORY,
  type TechnicalDatasetRepository,
} from './technical-dataset.repository.js';
import {
  USER_DIRECTORY_REPOSITORY,
  type UserDirectoryRepository,
} from '../../users/application/user-directory.repository.js';

export interface AssignedSpecialist {
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface PostSaleRequestDetail {
  readonly request: PostSaleRequest;
  readonly assignedSpecialist: AssignedSpecialist | null;
}

export interface RequestActivityView {
  readonly id: string;
  readonly eventType: RequestActivityEvent;
  readonly previousStatus: PostSaleRequestStatus | null;
  readonly newStatus: PostSaleRequestStatus | null;
  readonly description: string;
  readonly actor: {
    readonly displayName: string;
    readonly role: string | null;
  } | null;
  readonly technicalAnalysisId: string | null;
  readonly technicalReportId: string | null;
  readonly reportVersion: number | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly createdAt: string;
}

export interface RecordRequestActivity {
  readonly actor: AuthenticatedUser;
  readonly requestId: string;
  readonly eventType: RequestActivityEvent;
  readonly dedupeKey: string;
  readonly preferredRole: UserRole;
  readonly technicalAnalysisId?: string | null;
  readonly technicalReportId?: string | null;
  readonly reportVersion?: number | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
  readonly occurredAt?: Date;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface ListPostSaleRequestsQuery {
  page?: number;
  pageSize?: number;
  status?: PostSaleRequestStatus;
  search?: string;
}

export interface CreatePostSaleRequestInput {
  customerId: string;
  customerName: string;
  facilityName: string;
  assetId?: string | null;
  type: PostSaleRequestType;
  description: string;
  periodStart: string;
  periodEnd: string;
}

const TICKET_ATTEMPTS = 3;

@Injectable()
export class PostSaleRequestService {
  constructor(
    @Inject(POST_SALE_REQUEST_REPOSITORY)
    private readonly requests: PostSaleRequestRepository,
    @Inject(TECHNICAL_DATASET_REPOSITORY)
    private readonly technicalData: TechnicalDatasetRepository,
    @Inject(USER_DIRECTORY_REPOSITORY)
    private readonly profiles: Pick<UserDirectoryRepository, 'findProfiles'>,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListPostSaleRequestsQuery,
  ): Promise<PostSaleRequestPage> {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new PostSaleRequestQueryError();
    }

    return this.requests.list({
      visibility: requestVisibility(actor),
      page,
      pageSize,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { search: query.search } : {}),
    });
  }

  async get(actor: AuthenticatedUser, id: string): Promise<PostSaleRequest> {
    const request = await this.requests.findById(id);
    if (!request || !isRequestVisible(requestVisibility(actor), request)) {
      throw new PostSaleRequestNotFoundError();
    }
    return request;
  }

  async getDetail(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<PostSaleRequestDetail> {
    const request = await this.get(actor, id);
    return {
      request,
      assignedSpecialist: await this.specialistName(
        request.assignedSpecialistSub,
      ),
    };
  }

  async getTechnicalDataset(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<TechnicalDataset> {
    const request = await this.get(actor, id);
    const stored = await this.technicalData.findByRequestId(request.id);
    if (!stored) {
      throw new TechnicalDatasetNotFoundError();
    }
    return presentTechnicalDataset(request, stored);
  }

  async create(
    actor: AuthenticatedUser,
    input: CreatePostSaleRequestInput,
  ): Promise<PostSaleRequest> {
    if (!canCreate(actor)) {
      throw new PostSaleRequestForbiddenError();
    }
    const createdAt = new Date();
    createPostSaleRequest({
      id: randomUUID(),
      ticketCode: 'PV-000000',
      customerId: input.customerId,
      customerName: input.customerName,
      facilityName: input.facilityName,
      assetId: input.assetId,
      assignedSpecialistSub: null,
      type: input.type,
      description: input.description,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'RECEIVED',
      createdAt,
    });

    let conflict: PostSaleRequestConflictError | undefined;
    for (let attempt = 0; attempt < TICKET_ATTEMPTS; attempt += 1) {
      const request = createPostSaleRequest({
        id: randomUUID(),
        ticketCode: await this.requests.allocateTicketCode(),
        customerId: input.customerId,
        customerName: input.customerName,
        facilityName: input.facilityName,
        assetId: input.assetId,
        assignedSpecialistSub: null,
        type: input.type,
        description: input.description,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: 'RECEIVED',
        createdAt,
      });
      try {
        const stored = await this.requests.insert(request);
        await this.recordActivity({
          actor,
          requestId: stored.id,
          eventType: 'REQUEST_REGISTERED',
          dedupeKey: `request:${stored.id}:registered`,
          preferredRole: UserRole.SPECIALIST,
          occurredAt: createdAt,
        });
        return stored;
      } catch (error) {
        if (error instanceof PostSaleRequestConflictError) {
          conflict = error;
          continue;
        }
        throw error;
      }
    }
    throw conflict ?? new PostSaleRequestConflictError();
  }

  async activity(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<readonly RequestActivityView[]> {
    const request = await this.get(actor, id);
    const events = await this.requests.listActivity(request.id);
    const names = await this.creatorNames(events.map((event) => event.actorSub));
    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      description: event.description,
      actor: event.actorSub
        ? {
            displayName: names.get(event.actorSub) ?? 'Nombre no disponible',
            role: knownRole(event.actorRole),
          }
        : null,
      technicalAnalysisId: event.technicalAnalysisId,
      technicalReportId: event.technicalReportId,
      reportVersion: event.reportVersion,
      metadata: publicMetadata(event.metadata),
      createdAt: event.createdAt.toISOString(),
    }));
  }

  async recordActivity(input: RecordRequestActivity): Promise<void> {
    const metadata = publicMetadata(input.metadata ?? {});
    await this.requests.appendActivity({
      id: randomUUID(),
      requestId: input.requestId,
      eventType: input.eventType,
      description: activityDescription(input.eventType, {
        version: input.reportVersion,
        failureMessage: metadata.failureMessage ?? null,
      }),
      actorSub: input.actor.userId,
      actorRole: actingRole(input.actor, input.preferredRole),
      technicalAnalysisId: input.technicalAnalysisId ?? null,
      technicalReportId: input.technicalReportId ?? null,
      reportVersion: input.reportVersion ?? null,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      dedupeKey: input.dedupeKey,
      createdAt: input.occurredAt ?? new Date(),
    });
  }

  private async creatorNames(
    subs: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(subs.filter((sub): sub is string => Boolean(sub?.trim())))];
    if (unique.length === 0) {
      return names;
    }
    let profiles: Awaited<ReturnType<UserDirectoryRepository['findProfiles']>>;
    try {
      profiles = await this.profiles.findProfiles(unique);
    } catch {
      return names;
    }
    for (const profile of profiles) {
      const name = [profile.firstName, profile.lastName]
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .join(' ');
      if (name) {
        names.set(profile.cognitoSub, name);
      }
    }
    return names;
  }

  private async specialistName(
    cognitoSub: string | null,
  ): Promise<AssignedSpecialist | null> {
    if (!cognitoSub) {
      return null;
    }
    let profiles: Awaited<ReturnType<UserDirectoryRepository['findProfiles']>>;
    try {
      profiles = await this.profiles.findProfiles([cognitoSub]);
    } catch {
      throw new PostSaleRequestPersistenceError();
    }
    const profile = profiles.find((item) => item.cognitoSub === cognitoSub);
    return {
      firstName: displayName(profile?.firstName),
      lastName: displayName(profile?.lastName),
    };
  }
}

function displayName(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
}

function actingRole(actor: AuthenticatedUser, preferred: UserRole): string | null {
  if (actor.roles.includes(preferred)) {
    return preferred;
  }
  if (actor.roles.includes(UserRole.ADMINISTRATOR)) {
    return UserRole.ADMINISTRATOR;
  }
  return actor.roles[0] ?? null;
}

function knownRole(value: string | null): string | null {
  if (
    value === UserRole.SPECIALIST ||
    value === UserRole.VALIDATOR ||
    value === UserRole.ADMINISTRATOR
  ) {
    return value;
  }
  return null;
}

function publicMetadata(
  metadata: Readonly<Record<string, string>>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of ['comments', 'origin', 'failureMessage'] as const) {
    const value = metadata[key]?.trim() ?? '';
    if (value.length > 0 && value.length <= 2000 && !/[\r\n]/.test(value)) {
      safe[key] = value;
    }
  }
  return safe;
}

function canCreate(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.includes(UserRole.ADMINISTRATOR) ||
    actor.roles.includes(UserRole.SPECIALIST)
  );
}
