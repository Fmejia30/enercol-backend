import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UserRole } from '../../../identity-access/domain/user-role.js';
import { UpdateUserDto } from './update-user.dto.js';
import { UpdateUserStatusDto } from './update-user-status.dto.js';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('user administration DTOs', () => {
  it('accepts a partial profile and several roles', async () => {
    await expect(
      pipe.transform(
        {
          firstName: '  Ana  ',
          roles: [UserRole.VALIDATOR, UserRole.ADMINISTRATOR],
        },
        { type: 'body', metatype: UpdateUserDto },
      ),
    ).resolves.toMatchObject({
      firstName: 'Ana',
      roles: [UserRole.VALIDATOR, UserRole.ADMINISTRATOR],
    });
  });

  it('rejects an empty body, unknown fields, and invalid roles', async () => {
    await expect(transform({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform({ email: 'ana@enercol.test', firstName: 'Fernando' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform({ actorSub: 'intruder', firstName: 'Fernando' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(transform({ roles: ['AUDITOR'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(transform({ roles: [UserRole.SPECIALIST, UserRole.SPECIALIST] }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(transform({ phoneNumber: 'abc' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('requires a boolean enabled flag and rejects extra fields', async () => {
    await expect(
      pipe.transform({ enabled: false }, { type: 'body', metatype: UpdateUserStatusDto }),
    ).resolves.toEqual({ enabled: false });
    await expect(
      pipe.transform(
        { enabled: 'false' },
        { type: 'body', metatype: UpdateUserStatusDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { enabled: true, actorSub: 'intruder' },
        { type: 'body', metatype: UpdateUserStatusDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function transform(body: unknown): Promise<unknown> {
  return pipe.transform(body, { type: 'body', metatype: UpdateUserDto });
}
