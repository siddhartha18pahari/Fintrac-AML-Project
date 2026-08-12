// DOM helpers. `el` builds nodes without innerHTML so that server-supplied
// strings (customer names, rule detail text, validation messages) can never be
// interpreted as markup.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') node.innerHTML = value; // only ever used with literals
    else node.setAttribute(key, value === true ? '' : value);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

// ---------------------------------------------------------------- formatting

export const fmtCad = (value) =>
  value === null || value === undefined
    ? '—'
    : Number(value).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 });

export const fmtNum = (value, digits = 0) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString('en-CA', { maximumFractionDigits: digits });

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-CA', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function relativeHours(iso) {
  if (!iso) return null;
  return (new Date(iso).getTime() - Date.now()) / 3600000;
}

export function shortAddr(address) {
  if (!address) return '—';
  return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export const titleCase = (value) =>
  String(value || '').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ widgets

export function badge(text, tone) {
  return el('span', { class: `badge ${tone || 'neutral'}` }, text);
}

export function pill(text, title) {
  return el('span', { class: 'pill', title: title || '' }, text);
}

export function stat({ value, label, hint, tone }) {
  return el('div', { class: `card stat${tone ? ` tone-${tone}` : ''}` },
    el('div', { class: 'value' }, value),
    el('div', { class: 'label' }, label),
    hint ? el('div', { class: 'hint' }, hint) : null,
  );
}

export function meter(fraction, tone) {
  const pct = Math.max(0, Math.min(1, Number(fraction) || 0)) * 100;
  return el('div', { class: `meter ${tone || ''}` }, el('span', { style: { width: `${pct}%` } }));
}

export function table(columns, rows, { onRowClick, empty = 'Nothing to show.' } = {}) {
  if (!rows.length) return el('div', { class: 'card' }, el('div', { class: 'empty' }, empty));
  return el('div', { class: 'table-wrap' },
    el('table', {},
      el('thead', {}, el('tr', {}, columns.map((c) => el('th', { class: c.align === 'right' ? 'num' : '' }, c.label)))),
      el('tbody', {}, rows.map((row) => {
        const tr = el('tr', { class: onRowClick ? 'clickable' : '' },
          columns.map((c) => el('td', { class: c.align === 'right' ? 'num' : (c.nowrap ? 'nowrap' : '') }, c.render(row))));
        if (onRowClick) {
          tr.addEventListener('click', () => onRowClick(row));
          tr.tabIndex = 0;
          tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRowClick(row); });
        }
        return tr;
      })),
    ),
  );
}

export function card(title, ...children) {
  return el('div', { class: 'card' }, title ? el('h2', {}, title) : null, ...children);
}

export function notice(text, tone = '') {
  return el('div', { class: `notice ${tone}` }, text);
}

export function loading(label = 'Loading') {
  return el('div', { class: 'empty' }, el('span', { class: 'spinner' }), ' ', label, '…');
}

export function tierTone(tier) {
  return { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical', URGENT: 'critical' }[tier] || 'neutral';
}

export function severityTone(severity) {
  return { low: 'low', medium: 'medium', high: 'high', critical: 'critical', reporting: 'reporting' }[severity] || 'neutral';
}

// ------------------------------------------------------------------- toasts

export function toast(message, tone = 'info', ms = 5200) {
  const stack = document.getElementById('toast-stack');
  const node = el('div', { class: `toast ${tone}` }, message);
  stack.append(node);
  setTimeout(() => node.remove(), ms);
}

// -------------------------------------------------------------------- modal

export function modal({ title, body, confirmLabel = 'Confirm', onConfirm, destructive = false }) {
  return new Promise((resolve) => {
    const close = (result) => { backdrop.remove(); resolve(result); };
    const confirm = el('button', {
      class: destructive ? 'danger' : 'primary',
      onclick: async () => {
        confirm.disabled = true;
        try {
          const result = onConfirm ? await onConfirm() : true;
          close(result);
        } catch (error) {
          toast(error.message, 'err', 8000);
          confirm.disabled = false;
        }
      },
    }, confirmLabel);

    const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(null); } },
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        el('h2', {}, title),
        body,
        el('div', { class: 'modal-actions' },
          el('button', { class: 'ghost', onclick: () => close(null) }, 'Cancel'),
          confirm,
        ),
      ),
    );
    document.body.append(backdrop);
    backdrop.querySelector('input, textarea, select, button')?.focus();
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', esc); }
    });
  });
}

export function field(label, control, hint) {
  return el('div', { style: { marginBottom: '0.85rem' } },
    el('label', {}, label),
    control,
    hint ? el('div', { class: 'small faint', style: { marginTop: '0.2rem' } }, hint) : null,
  );
}

export function json(value) {
  return el('pre', {}, JSON.stringify(value, null, 2));
}
