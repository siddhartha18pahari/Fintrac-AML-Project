import Link from "next/link";

export function Pager({
  page,
  pages,
  total,
  hrefFor,
}: {
  page: number;
  pages: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pages">
      <p className="text-muted">
        <span className="num">{total}</span> matching · page <span className="num">{page}</span> of <span className="num">{pages}</span>
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="btn btn-secondary" href={hrefFor(page - 1)} rel="prev">Previous</Link>
        ) : (
          <span className="btn btn-secondary" aria-disabled="true">Previous</span>
        )}
        {page < pages ? (
          <Link className="btn btn-secondary" href={hrefFor(page + 1)} rel="next">Next</Link>
        ) : (
          <span className="btn btn-secondary" aria-disabled="true">Next</span>
        )}
      </div>
    </nav>
  );
}

export function listHref(path: string, query: Record<string, string | undefined>, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}
