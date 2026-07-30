import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function toPrismaPage(query: PaginationQuery) {
  const skip = (query.page - 1) * query.limit;
  return {
    skip,
    take: query.limit,
    order: query.order,
    sort: query.sort,
  };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  query: PaginationQuery,
) {
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  return {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      sort: query.sort ?? null,
      order: query.order,
    },
  };
}
