// Thin API client. Owns the bearer token and turns HTTP failures into Errors
// carrying the server's own message, so the UI never invents an explanation
// for something the backend already explained.

const TOKEN_KEY = 'sentinel.token';
const USER_KEY = 'sentinel.user';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  },
  set(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body, options = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && !options.allowAnonymous) {
    auth.clear();
    window.dispatchEvent(new CustomEvent('sentinel:signed-out'));
    throw new ApiError('Your session has expired. Sign in again.', 401, null);
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { detail: text }; }
  }

  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((d) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('; ')
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }
  return payload;
}

export const api = {
  get: (path, params) => request('GET', params ? `${path}?${new URLSearchParams(clean(params))}` : path),
  post: (path, body, options) => request('POST', path, body ?? {}, options),

  login: (username, password) =>
    request('POST', '/api/auth/login', { username, password }, { allowAnonymous: true }),

  me: () => request('GET', '/api/auth/me'),
  config: () => request('GET', '/api/config'),
  dashboard: () => request('GET', '/api/dashboard'),
  users: () => request('GET', '/api/auth/users'),

  alerts: (params) => api.get('/api/alerts', params),
  aggregationEvents: (params) => api.get('/api/aggregation-events', params),
  aggregationEvent: (id) => api.get(`/api/aggregation-events/${id}`),
  rules: () => api.get('/api/rules'),
  anomalyScores: () => api.get('/api/anomaly-scores'),

  cases: (params) => api.get('/api/cases', params),
  caseDetail: (id) => api.get(`/api/cases/${id}`),
  caseGraph: (id, hops = 2) => api.get(`/api/cases/${id}/graph`, { hops }),
  strDraft: (id) => api.get(`/api/cases/${id}/str-draft`),

  transactions: (params) => api.get('/api/transactions', params),
  customer: (id) => api.get(`/api/customers/${id}`),

  reports: (params) => api.get('/api/reports', params),
  report: (id) => api.get(`/api/reports/${id}`),
  buildReport: (caseId, body) => api.post(`/api/cases/${caseId}/reports`, body),
  validateReport: (id) => api.post(`/api/reports/${id}/validate`),
  submitReport: (id) => api.post(`/api/reports/${id}/submit`),
  validatePayload: (payload, levels) =>
    request('POST', `/api/reports/validate-payload?levels=${encodeURIComponent(levels)}`, payload),

  audit: (params) => api.get('/api/audit', params),
  verifyAudit: () => api.get('/api/audit/verify'),
};

function clean(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}
