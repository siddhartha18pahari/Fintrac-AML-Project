import { api } from '../api.js';
import {
  badge, card, el, field, fmtCad, fmtDateTime, loading, modal, mount, notice,
  pill, severityTone, table, toast,
} from '../ui.js';

export async function alertsView(root, { navigate }) {
  const state = { status: '', rule_id: '', unlinked_only: false };

  const body = el('div', {});
  const controls = el('div', { class: 'row', style: { marginBottom: '1rem' } });

  async function refresh() {
    mount(body, loading('Loading alerts'));
    const data = await api.alerts({ ...state, limit: 200 });
    mount(body,
      el('p', { class: 'small faint', style: { marginTop: 0 } },
        `${data.total} alert${data.total === 1 ? '' : 's'} matching. Each one carries the rule version that produced it and the evidence it was produced from.`),
      table(
        [
          { label: 'Raised', nowrap: true, render: (a) => fmtDateTime(a.occurred_at) },
          { label: 'Rule', render: (a) => el('div', {}, pill(`${a.rule_id} v${a.rule_version}`), ' ', badge(a.severity, severityTone(a.severity))) },
          { label: 'Finding', render: (a) => el('div', {}, el('div', {}, a.title), el('div', { class: 'small faint' }, a.explanation?.detail || '')) },
          { label: 'Customer', render: (a) => a.customer_name || `#${a.customer_id}` },
          { label: 'Points', align: 'right', render: (a) => `+${a.score_contribution}` },
          { label: 'Evidence', align: 'right', render: (a) => (a.evidence_txn_ids || []).length },
          { label: 'Status', render: (a) => badge(a.status.replace(/_/g, ' '), a.status === 'DISMISSED' ? 'neutral' : 'ok') },
        ],
        data.alerts,
        { onRowClick: (a) => showAlert(a, refresh, navigate), empty: 'No alerts match these filters.' },
      ),
    );
  }

  const statusSelect = el('select', {
    onchange: (e) => { state.status = e.target.value; refresh(); },
  }, ['', 'NEW', 'ASSIGNED', 'LINKED_TO_CASE', 'ESCALATED', 'DISMISSED']
    .map((v) => el('option', { value: v }, v ? v.replace(/_/g, ' ') : 'Any status')));

  const ruleInput = el('input', {
    placeholder: 'Rule id, e.g. AML-VC-012',
    onchange: (e) => { state.rule_id = e.target.value.trim().toUpperCase(); refresh(); },
  });

  const unlinked = el('input', {
    type: 'checkbox',
    style: { width: 'auto' },
    onchange: (e) => { state.unlinked_only = e.target.checked; refresh(); },
  });

  mount(controls,
    el('div', { style: { minWidth: '180px' } }, field('Status', statusSelect)),
    el('div', { style: { minWidth: '220px' } }, field('Rule', ruleInput)),
    el('label', { class: 'row tight', style: { marginTop: '0.9rem' } }, unlinked, ' Not yet linked to a case'),
  );

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Alert queue'),
        el('p', {}, 'Indicators that fired. An indicator is a red flag that can contribute to a suspicion — it is not proof that money laundering occurred.'),
      ),
    ),
    controls,
    body,
  );
  await refresh();
}

export function explanationBlock(explanation) {
  const observed = explanation.observed || {};
  const threshold = explanation.threshold || {};
  const keys = [...new Set([...Object.keys(observed), ...Object.keys(threshold)])];
  return table(
    [
      { label: 'Feature', render: (k) => el('span', { class: 'mono' }, k) },
      { label: 'Observed', render: (k) => renderValue(observed[k]) },
      { label: 'Threshold', render: (k) => renderValue(threshold[k]) },
    ],
    keys,
    { empty: 'This rule recorded no numeric observations.' },
  );
}

function renderValue(value) {
  if (value === undefined || value === null) return el('span', { class: 'faint' }, '—');
  if (Array.isArray(value)) return el('span', { class: 'small' }, value.slice(0, 6).join(', ') + (value.length > 6 ? ` +${value.length - 6}` : ''));
  if (typeof value === 'object') return el('span', { class: 'small mono' }, JSON.stringify(value).slice(0, 90));
  return el('span', { class: 'mono' }, String(value));
}

async function showAlert(alert, refresh, navigate) {
  const explanation = alert.explanation || {};
  const body = el('div', { class: 'stack' },
    el('div', { class: 'row' },
      pill(`${alert.rule_id} v${alert.rule_version}`),
      badge(alert.severity, severityTone(alert.severity)),
      badge(`+${alert.score_contribution} points`, 'neutral'),
      alert.case_id ? el('button', { class: 'sm', onclick: () => { document.querySelector('.modal-backdrop')?.remove(); navigate(`#/cases/${alert.case_id}`); } }, `Open case #${alert.case_id}`) : null,
    ),
    el('p', { class: 'muted', style: { margin: 0 } }, explanation.detail || alert.title),
    el('h3', {}, 'Observed versus threshold'),
    explanationBlock(explanation),
    el('h3', {}, 'Evidence'),
    el('p', { class: 'small faint', style: { margin: 0 } },
      `${(alert.evidence_txn_ids || []).length} transaction(s): ${(alert.evidence_txn_ids || []).join(', ') || 'none recorded'}`),
  );

  const reasonInput = el('textarea', { placeholder: 'Why is this alert not indicative of a concern?' });

  await modal({
    title: alert.title,
    body: el('div', {}, body,
      alert.status === 'DISMISSED'
        ? notice('This alert has already been dismissed.', 'warn')
        : el('div', { style: { marginTop: '1rem' } },
          field('Dismiss with reason', reasonInput,
            'Dismissals are attributable and permanent in the audit trail. The alert is not deleted.')),
    ),
    confirmLabel: alert.status === 'DISMISSED' ? 'Close' : 'Dismiss alert',
    destructive: alert.status !== 'DISMISSED',
    onConfirm: async () => {
      if (alert.status === 'DISMISSED') return true;
      const reason = reasonInput.value.trim();
      if (!reason) throw new Error('A dismissal reason is required.');
      await api.post(`/api/alerts/${alert.id}/dismiss`, { reason });
      toast('Alert dismissed and recorded in the audit trail.', 'ok');
      await refresh();
      return true;
    },
  });
}

export async function candidatesView(root, { navigate }) {
  mount(root, loading('Loading LVCTR candidates'));
  const [events, dueSoon] = await Promise.all([
    api.aggregationEvents({ open_only: true, limit: 300 }),
    api.get('/api/cases/queues/due-soon', { hours: 48 }),
  ]);

  const dueIds = new Set(dueSoon.events.map((e) => e.id));

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'LVCTR candidates'),
        el('p', {},
          'Groupings that reached CAD 10,000 or more — a single receipt, or receipts aggregated over 24 hours '
          + 'against the same conductor, beneficiary or third party. Each grouping is one candidate, not one per receipt.'),
      ),
    ),
    dueSoon.events.length
      ? notice(`${dueSoon.events.length} candidate(s) fall due within 48 hours.`, 'warn')
      : notice('No candidates fall due in the next 48 hours.', 'ok'),
    el('div', { style: { marginTop: '1rem' } },
      table(
        [
          { label: 'Grouping', render: (e) => el('div', {},
            badge(e.group_type.replace(/_/g, ' '), e.group_type === 'CONDUCTOR' ? 'neutral' : 'reporting'),
            el('div', { class: 'small faint' }, e.single_transaction ? 'single receipt' : `${e.receipt_count} receipts aggregated`)) },
          { label: 'Customer', render: (e) => e.customer_name || `#${e.customer_id}` },
          { label: 'Aggregated', align: 'right', render: (e) => fmtCad(e.total_cad) },
          { label: 'Window', render: (e) => el('div', { class: 'small mono' }, `${fmtDateTime(e.window_start)} → ${fmtDateTime(e.window_end)}`) },
          { label: 'Due', nowrap: true, render: (e) => el('span', { class: dueIds.has(e.id) ? 'badge critical' : '' }, fmtDateTime(e.due_at)) },
          { label: '', render: (e) => el('button', { class: 'sm', onclick: (ev) => { ev.stopPropagation(); navigate(`#/candidates/${e.id}`); } }, 'Inspect') },
        ],
        events.events,
        { onRowClick: (e) => navigate(`#/candidates/${e.id}`), empty: 'No unreported candidates. Everything at or above the threshold has been filed.' },
      ),
    ),
  );
}

export async function candidateDetailView(root, { params, navigate }) {
  mount(root, loading('Loading candidate'));
  const data = await api.aggregationEvent(params.id);
  const e = data.event;

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, `Candidate #${e.id}`),
        el('p', {}, `Grouped on ${e.group_type.replace(/_/g, ' ').toLowerCase()} · FINTRAC aggregation type code ${data.aggregation_type_code}`),
      ),
      el('div', { class: 'actions' }, el('button', { onclick: () => navigate('#/candidates') }, 'Back to candidates')),
    ),
    el('div', { class: 'grid cols-4', style: { marginBottom: '1rem' } },
      card('Aggregated', el('div', { class: 'value', style: { fontSize: '1.6rem', fontWeight: 700 } }, fmtCad(e.total_cad))),
      card('Threshold', el('div', { class: 'value', style: { fontSize: '1.6rem', fontWeight: 700 } }, fmtCad(e.threshold_cad))),
      card('Receipts covered', el('div', { class: 'value', style: { fontSize: '1.6rem', fontWeight: 700 } }, e.receipt_count)),
      card('Filing due', el('div', { style: { fontWeight: 600 } }, fmtDateTime(e.due_at))),
    ),
    card('Receipts in this grouping',
      table(
        [
          { label: 'When', nowrap: true, render: (t) => fmtDateTime(t.occurred_at) },
          { label: 'Reference', render: (t) => el('span', { class: 'mono small' }, t.transaction_id) },
          { label: 'Asset', render: (t) => `${t.asset_amount} ${t.asset}` },
          { label: 'CAD', align: 'right', render: (t) => fmtCad(t.cad_value) },
          { label: 'From', render: (t) => el('span', { class: 'mono small', title: t.wallet_from || '' }, t.wallet_from ? `${t.wallet_from.slice(0, 10)}…` : '—') },
          { label: 'Rate', align: 'right', render: (t) => el('span', { class: 'small', title: `methodology ${t.valuation_methodology}` }, t.exchange_rate) },
        ],
        data.transactions,
      ),
      el('p', { class: 'small faint' },
        'Each CAD figure is derived from a stored rate snapshot, so an auditor can re-derive why this grouping '
        + 'landed above or below the threshold years from now.'),
    ),
  );
}
