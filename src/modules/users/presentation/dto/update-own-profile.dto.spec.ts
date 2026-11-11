import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateOwnProfileDto } from './update-own-profile.dto.js';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('UpdateOwnProfileDto', () => {
  it('accepts a trimmed partial profile', async () => {
    await expect(
      pipe.transform(
        { lastName: '  Rojas  ' },
        { type: 'body', metatype: UpdateOwnProfileDto },
      ),
    ).resolves.toMatchObject({ lastName: 'Rojas' });
  });

  it('rejects an empty body and fields the user cannot change', async () => {
    await expect(transform({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform({ email: 'ana@enercol.test', firstName: 'Fernando' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform({ roles: ['ADMINISTRATOR'], firstName: 'Fernando' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform({ cognitoSub: 'other-user', firstName: 'Fernando' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform({ enabled: false, phoneNumber: '+573000000000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function transform(body: unknown): Promise<unknown> {
  return pipe.transform(body, { type: 'body', metatype: UpdateOwnProfileDto });
}
