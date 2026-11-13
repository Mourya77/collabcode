export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

/** Parses ?page=&limit= with safe defaults and clamps (limit 1..100). */
export function parsePagination(query: Record<string, unknown>): Pagination {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(100, Math.floor(limitRaw)) : 20;
  return { page, limit, offset: (page - 1) * limit };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function paginate<T>(all: T[], p: Pagination): Paginated<T> {
  return { items: all.slice(p.offset, p.offset + p.limit), total: all.length, page: p.page, limit: p.limit };
}
