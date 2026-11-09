/** Bounded page windows. Callers keep the full filtered list; this only slices it. */

export function pageWindow(input: { page?: string | number | null; pageSize?: string | number | null }, maxSize = 50) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const requested = Math.floor(Number(input.pageSize) || 25);
  const pageSize = Math.min(maxSize, Math.max(1, Number.isFinite(requested) ? requested : 25));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

export function slicePage<T>(rows: T[], window: { page: number; pageSize: number; offset: number }) {
  return {
    total: rows.length,
    page: window.page,
    pageSize: window.pageSize,
    pages: Math.max(1, Math.ceil(rows.length / window.pageSize)),
    items: rows.slice(window.offset, window.offset + window.pageSize),
  };
}
