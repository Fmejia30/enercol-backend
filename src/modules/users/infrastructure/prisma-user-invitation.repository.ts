import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { InvitationStatus } from '../../../generated/prisma/client.js';
import {
  USER_INVITE_AUDIT_ACTION,
  USER_INVITE_INTERVENTION_ACTION,
} from '../domain/invitation-request.js';
import type {
  InvitationIntervention,
  NewUserInvitation,
  StoredUserInvitation,
  UserInvitationRepository,
} from '../application/user-invitation.repository.js';

@Injectable()
export class PrismaUserInvitationRepository implements UserInvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(invitation: NewUserInvitation): Promise<StoredUserInvitation> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userInvitation.create({
        data: {
          email: invitation.email,
          cognitoSub: invitation.cognitoSub,
          status: InvitationStatus.PENDING,
          expiresAt: invitation.expiresAt,
          createdBy: invitation.createdBy,
        },
      });
      await tx.auditLog.create({
        data: {
          actorSub: invitation.createdBy,
          action: USER_INVITE_AUDIT_ACTION,
          targetSub: invitation.cognitoSub,
          metadata: {
            email: invitation.email,
            roles: [...invitation.roles],
          },
        },
      });
      return created;
    });

    return {
      id: row.id,
      email: row.email,
      roles: [...invitation.roles],
      status: 'PENDING',
      expiresAt: row.expiresAt,
    };
  }

  async recordIntervention(
    intervention: InvitationIntervention,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorSub: intervention.actorSub,
        action: USER_INVITE_INTERVENTION_ACTION,
        targetSub: intervention.targetSub,
        metadata: { compensation: 'disable_failed' },
      },
    });
  }
}
