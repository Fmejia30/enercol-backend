import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListPostSaleRequestsQueryDto } from './list-post-sale-requests-query.dto.js';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function transform(value: unknown) {
  return pipe.transform(value, {
    type: 'query',
    metatype: ListPostSaleRequestsQueryDto,
  });
}

describe('list post-sale requests query', () => {
  it('accepts page, page size, status and search', async () => {
    await expect(
      transform({
        page: '2',
        pageSize: '10',
        status: 'EN_ANALISIS',
        search: '  Fontibón  ',
      }),
    ).resolves.toEqual({
      page: 2,
      pageSize: 10,
      status: 'EN_ANALISIS',
      search: 'Fontibón',
    });
  });

  it('drops a blank search and rejects an unknown specialist parameter', async () => {
    await expect(transform({ search: '   ' })).resolves.toEqual({});
    await expect(
      transform({ assignedSpecialistSub: 'demo-specialist-sur' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(transform({ status: 'CERRADA' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(transform({ page: '0' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(transform({ pageSize: '101' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
