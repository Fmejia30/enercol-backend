import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type {
  RoleCompensationIntervention,
  UserAdministrationChange,
  UserAdministrationRepository,
} from '../application/user-administration.repository.js';
import {
  USER_PROFILE_SELF_UPDATED_AUDIT_ACTION,
  USER_PROFILE_UPDATED_AUDIT_ACTION,
  USER_ROLES_COMPENSATION_ACTION,
  USER_ROLES_UPDATED_AUDIT_ACTION,
} from '../domain/user-administration.js';

@Injectable()
export class PrismaUserAdministrationRepository implements UserAdministrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveChanges(change: UserAdministrationChange): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (change.profile?.mode === 'create') {
        await tx.userProfile.create({
          data: {
            cognitoSub: change.targetSub,
            firstName: change.profile.firstName,
            lastName: change.profile.lastName,
            phoneNumber: change.profile.phoneNumber,
          },
        });
      } else if (change.profile?.mode === 'update') {
        const data = {
          ...(change.profile.firstName === undefined
            ? {}
            : { firstName: change.profile.firstName }),
          ...(change.profile.lastName === undefined
            ? {}
            : { lastName: change.profile.lastName }),
          ...(change.profile.phoneNumber === undefined
            ? {}
            : { phoneNumber: change.profile.phoneNumber }),
        };
        if (Object.keys(data).length > 0) {
          await tx.userProfile.update({
            where: { cognitoSub: change.targetSub },
            data,
          });
        }
      }

      for (const audit of change.audits) {
        await tx.auditLog.create({
          data: {
            actorSub: audit.actorSub,
            action: audit.action,
            targetSub: audit.targetSub,
            metadata: metadataFor(audit),
          },
        });
      }
    });
  }

  async recordIntervention(
    intervention: RoleCompensationIntervention,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorSub: intervention.actorSub,
        action: USER_ROLES_COMPENSATION_ACTION,
        targetSub: intervention.targetSub,
        metadata: {
          compensation: 'group_restore_failed',
          added: [...intervention.added],
          removed: [...intervention.removed],
        },
      },
    });
  }
}

function metadataFor(
  audit: UserAdministrationChange['audits'][number],
): Prisma.InputJsonObject {
  if (audit.action === USER_PROFILE_UPDATED_AUDIT_ACTION) {
    return {
      before: jsonProfile(audit.metadata.before),
      after: jsonProfile(audit.metadata.after),
    };
  }
  if (audit.action === USER_ROLES_UPDATED_AUDIT_ACTION) {
    return {
      before: [...audit.metadata.before],
      after: [...audit.metadata.after],
    };
  }
  if (audit.action === USER_PROFILE_SELF_UPDATED_AUDIT_ACTION) {
    return {
      changedFields: [...audit.metadata.changedFields],
      before: jsonFields(audit.metadata.before),
      after: jsonFields(audit.metadata.after) ?? {},
    };
  }
  return {
    enabled: audit.metadata.enabled,
    cognitoGlobalSignOut: audit.metadata.cognitoGlobalSignOut,
  };
}

function jsonFields(
  fields: {
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
  } | null,
): Prisma.InputJsonObject | null {
  if (!fields) {
    return null;
  }
  return {
    ...(fields.firstName === undefined ? {} : { firstName: fields.firstName }),
    ...(fields.lastName === undefined ? {} : { lastName: fields.lastName }),
    ...(fields.phoneNumber === undefined
      ? {}
      : { phoneNumber: fields.phoneNumber }),
  };
}

function jsonProfile(
  profile: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
  } | null,
): Prisma.InputJsonObject | null {
  if (!profile) {
    return null;
  }
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phoneNumber: profile.phoneNumber,
  };
}
