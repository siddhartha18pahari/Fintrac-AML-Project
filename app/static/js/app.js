// Router, shell and session handling.

import { api, auth } from './api.js';
import { clear, el, mount, notice, toast } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { alertsView, candidateDetailView, candidatesView } from './views/alerts.js';
import { caseDetailView, casesView } from './views/cases.js';
import { auditView, reportView, rulesView, transactionsView, validationLabView } from './views/misc.js';

const appRoot = document.getElementById('app');

const ROUTES = [
  { pattern: /^#\/?$/, view: dashboardView, nav: '#/' },
  { pattern: /^#\/alerts$/, view: alertsView, nav: '#/alerts' },
  { pattern: /^#\/candidates$/, view: candidatesView, nav: '#/candidates' },
  { pattern: /^#\/candidates\/(?<id>\d+)$/, view: candidateDetailView, nav: '#/candidates' },
  { pattern: /^#\/cases$/, view: casesView, nav: '#/cases' },
  { pattern: /^#\/cases\/(?<id>\d+)$/, view: caseDetailView, nav: '#/cases' },
  { pattern: /^#\/transactions$/, view: transactionsView, nav: '#/transactions' },
  { pattern: /^#\/rules$/, view: rulesView, nav: '#/rules' },
  { pattern: /^#\/validation$/, view: validationLabView, nav: '#/validation' },
  { pattern: /^#\/reports\/(?<id>\d+)$/, view: reportView, nav: '#/cases' },
  { pattern: /^#\/audit$/, view: auditView, nav: '#/audit' },
];

const NAV = [
  { group: 'Monitor', items: [
    { href: '#/', icon: '\u{1F4CA}', label: 'Dashboard' },
    { href: '#/alerts', icon: '\u{1F6A9}', label: 'Alerts', badge: 'alerts' },
    { href: '#/candidates', icon: '\u{1F4CB}', label: 'LVCTR candidates', badge: 'candidates' },
  ] },
  { group: 'Investigate', items: [
    { href: '#/cases', icon: '\u{1F5C2}', label: 'Cases', badge: 'cases' },
    { href: '#/transactions', icon: '\u{1F4B1}', label: 'Transactions' },
  ] },
  { group: 'Govern', items: [
    { href: '#/rules', icon: '\u{2699}', label: 'Rule book' },
    { href: '#/validation', icon: '\u{1F9EA}', label: 'Validation lab' },
    { href: '#/audit', icon: '\u{1F512}', label: 'Audit trail', permission: 'audit:view' },
  ] },
];

const session = { user: null, permissions: [], counts: {} };

function navigate(hash) {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

// ---------------------------------------------------------------------- login

function loginView() {
  const username = el('input', { autocomplete: 'username', value: 'l.chen' });
  const password = el('input', { type: 'password', autocomplete: 'current-password', value: '' });
  const error = el('div', {});

  async function submit(event) {
    event?.preventDefault();
    try {
      const result = await api.login(username.value.trim(), password.value);
      auth.set(result.access_token, result.user);
      await boot();
      navigate('#/');
    } catch (err) {
      mount(error, notice(err.message, 'danger'));
    }
  }

  const quick = (user, role) => el('button', {
    type: 'button',
    onclick: () => { username.value = user; password.value = 'sentinel1234'; submit(); },
  }, el('span', {}, user), ' ', el('span', { class: 'role' }, role));

  mount(appRoot,
    el('div', { class: 'login-wrap' },
      el('form', { class: 'login-card', onsubmit: submit },
        el('h1', {}, '\u{1F6E1} FINTRAC Sentinel'),
        el('p', { class: 'tagline' }, 'Explainable AML monitoring and regulatory reporting for virtual-currency transactions.'),
        error,
        el('div', { class: 'field' }, el('label', { for: 'u' }, 'Username'), username),
        el('div', { class: 'field' }, el('label', { for: 'p' }, 'Password'), password),
        el('button', { class: 'primary', type: 'submit', style: { width: '100%' } }, 'Sign in'),
        el('div', { class: 'demo-users' },
          el('h2', {}, 'Demo accounts — password sentinel1234'),
          quick('l.chen', 'compliance officer'),
          quick('s.rahman', 'senior analyst'),
          quick('j.okafor', 'analyst'),
          quick('d.vasquez', 'approver'),
          quick('a.petrov', 'auditor'),
          el('p', { class: 'small faint', style: { marginBottom: 0 } },
            'Roles differ in what they can do: only a senior analyst or compliance officer can record a filing '
            + 'decision, and only a separate approver can sign it off.'),
        ),
      ),
    ),
  );
  username.focus();
}

// ---------------------------------------------------------------------- shell

function sidebar(activeNav) {
  const items = [];
  for (const group of NAV) {
    const visible = group.items.filter((i) => !i.permission || session.permissions.includes(i.permission));
    if (!visible.length) continue;
    items.push(el('div', { class: 'nav-group' }, group.group));
    for (const item of visible) {
      items.push(el('a', {
        class: `nav-item${item.href === activeNav ? ' active' : ''}`,
        href: item.href,
      },
      el('span', {}, item.icon),
      el('span', {}, item.label),
      item.badge && session.counts[item.badge] !== undefined
        ? el('span', { class: 'count' }, session.counts[item.badge])
        : null));
    }
  }

  return el('nav', { class: 'sidebar' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand-mark' }, '\u{1F6E1}'),
      el('div', {},
        el('div', { class: 'brand-name' }, 'Sentinel'),
        el('div', { class: 'brand-sub' }, 'FINTRAC AML'),
      ),
    ),
    ...items,
    el('div', { class: 'nav-spacer' }),
    el('div', { class: 'nav-user' },
      el('div', { class: 'who' }, session.user?.full_name || ''),
      el('div', { class: 'role' }, (session.user?.role || '').replace(/_/g, ' ').toLowerCase()),
      el('button', {
        class: 'ghost sm',
        style: { marginTop: '0.5rem' },
        onclick: () => { auth.clear(); session.user = null; render(); },
      }, 'Sign out'),
    ),
  );
}

// --------------------------------------------------------------------- render

async function render() {
  if (!auth.token || !session.user) { loginView(); return; }

  const hash = window.location.hash || '#/';
  const route = ROUTES.find((r) => r.pattern.test(hash)) || ROUTES[0];
  const params = route.pattern.exec(hash)?.groups || {};

  const main = el('main', { class: 'main' });
  mount(appRoot, el('div', { class: 'shell' }, sidebar(route.nav), main));

  const ctx = { navigate, params, permissions: session.permissions, user: session.user };
  try {
    await route.view(main, ctx);
  } catch (error) {
    mount(main,
      el('div', { class: 'page-head' }, el('h1', {}, 'Something went wrong')),
      notice(error.message, 'danger'),
      el('button', { onclick: () => render() }, 'Retry'),
    );
  }
  refreshCounts();
}

async function refreshCounts() {
  try {
    const data = await api.dashboard();
    session.counts = {
      alerts: data.volumes.alerts,
      candidates: data.widgets.lvctr_candidates,
      cases: data.widgets.open_cases,
    };
    for (const node of document.querySelectorAll('.nav-item .count')) node.remove();
    for (const group of NAV) {
      for (const item of group.items) {
        if (!item.badge) continue;
        const link = document.querySelector(`.nav-item[href="${item.href}"]`);
        if (link && session.counts[item.badge] !== undefined) {
          link.append(el('span', { class: 'count' }, session.counts[item.badge]));
        }
      }
    }
  } catch { /* counts are decoration; never block the page on them */ }
}

async function boot() {
  if (!auth.token) return;
  try {
    const me = await api.me();
    session.user = me.user;
    session.permissions = me.permissions;
  } catch {
    auth.clear();
    session.user = null;
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('sentinel:signed-out', () => {
  session.user = null;
  toast('Signed out.', 'info');
  render();
});

(async function start() {
  clear(appRoot);
  await boot();
  await render();
  // Only ask once signed in: probing an authenticated endpoint from the login
  // screen returns 401 and would fire a spurious "signed out" toast.
  if (session.user) {
    try {
      const config = await api.config();
      if (!config.synthetic_data_only) {
        document.getElementById('synthetic-banner').style.display = 'none';
      }
    } catch { /* the banner stays up if we cannot confirm; failing loud is correct here */ }
  }
})();
