const ALLOWED = ["/alerts", "/cases", "/dashboard", "/customers", "/triage", "/rules", "/graph", "/geography", "/statistics"];

export function safeReturn(value: string | undefined | null, fallback: string) {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) return fallback;
  const path = value.split("?")[0].split("#")[0];
  const allowed = ALLOWED.some((root) => path === root || path.startsWith(`${root}/`));
  return allowed ? value : fallback;
}

export function withReturn(href: string, returnTo: string) {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("return", returnTo);
  return `${path}?${params.toString()}`;
}

function isAlertQueue(value: string) {
  return value.split("?")[0] === "/alerts";
}

export function preservedQueue(returnTo: string | undefined | null) {
  let current = safeReturn(returnTo, "");
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (isAlertQueue(current)) return current;
    const query = current.split("?")[1] ?? "";
    current = safeReturn(new URLSearchParams(query).get("return"), "");
  }
  return "/alerts";
}

export function queuePath(filters: { q?: string; severity?: string; rule?: string }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.rule) params.set("rule", filters.rule);
  const query = params.toString();
  return query ? `/alerts?${query}` : "/alerts";
}
