import { api } from '../api.js';
import {
  badge, card, el, field, fmtCad, fmtDateTime, json, loading, meter, mount,
  notice, pill, severityTone, shortAddr, table, toast,
} from '../ui.js';

// ---------------------------------------------------------------- transactions

export async function transactionsView(root) {
  const state = { q: '', direction: '', min_cad: '' };
  const body = el('div', {});

  async function refresh() {
    mount(body, loading('Loading transactions'));
    const data = await api.transactions({ ...state, limit: 150 });
    mount(body,
      el('p', { class: 'small faint', style: { marginTop: 0 } }, `${data.total} transaction(s) match.`),
      table(
        [
          { label: 'When', nowrap: true, render: (t) => fmtDateTime(t.occurred_at) },
          { label: 'Reference', render: (t) => el('span', { class: 'mono small' }, t.transaction_id) },
          { label: 'Customer', render: (t) => t.customer_name || `#${t.customer_id}` },
          { label: 'Direction', render: (t) => badge(t.direction === 'INCOMING' ? 'in' : 'out', t.direction === 'INCOMING' ? 'ok' : 'high') },
          { label: 'Amount', render: (t) => `${t.asset_amount} ${t.asset}` },
          { label: 'CAD', align: 'right', render: (t) => fmtCad(t.cad_value) },
          { label: 'From', render: (t) => el('span', { class: 'mono small', title: t.wallet_from || '' }, shortAddr(t.wallet_from)) },
          { label: 'To', render: (t) => el('span', { class: 'mono small', title: t.wallet_to || '' }, shortAddr(t.wallet_to)) },
          { label: 'Scenario', render: (t) => (t.scenario ? pill(t.scenario) : el('span', { class: 'faint' }, '—')) },
        ],
        data.transactions,
        { empty: 'No transactions match.' },
      ),
    );
  }

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Transaction ledger'),
        el('p', {}, 'Every CAD figure is derived from a stored rate snapshot with its own methodology version, so a threshold decision can be reproduced years later.'),
      ),
    ),
    el('div', { class: 'row', style: { marginBottom: '1rem' } },
      el('div', { style: { minWidth: '260px' } }, field('Search', el('input', {
        placeholder: 'Reference, wallet address or tx hash',
        onchange: (e) => { state.q = e.target.value.trim(); refresh(); },
      }))),
      el('div', { style: { minWidth: '150px' } }, field('Direction', el('select', {
        onchange: (e) => { state.direction = e.target.value; refresh(); },
      }, ['', 'INCOMING', 'OUTGOING'].map((v) => el('option', { value: v }, v || 'Both'))))),
      el('div', { style: { minWidth: '150px' } }, field('Minimum CAD', el('input', {
        type: 'number', placeholder: '0',
        onchange: (e) => { state.min_cad = e.target.value; refresh(); },
      }))),
    ),
    body,
  );
  await refresh();
}

// ----------------------------------------------------------------- rule book

export async function rulesView(root) {
  mount(root, loading('Loading rule catalogue'));
  const [data, anomaly] = await Promise.all([api.rules(), api.anomalyScores().catch(() => ({ scores: [] }))]);

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Rule book'),
        el('p', {},
          `Catalogue ${data.catalogue_version}. Rules are configuration, not code: a threshold change means a new `
          + 'version with its own effective date, so a historical case is always reproducible with the parameters that were in force.'),
      ),
    ),
    table(
      [
        { label: 'Rule', nowrap: true, render: (r) => el('div', {}, pill(`${r.rule_id} v${r.version}`), r.in_force ? null : el('div', {}, badge('superseded', 'neutral'))) },
        { label: 'Name', render: (r) => el('div', {}, el('div', {}, r.name), r.description ? el('div', { class: 'small faint' }, r.description) : null) },
        { label: 'Category', render: (r) => r.category.replace(/_/g, ' ') },
        { label: 'Severity', render: (r) => badge(r.severity, severityTone(r.severity)) },
        { label: 'Points', align: 'right', render: (r) => `+${r.score_base}` },
        { label: 'Parameters', render: (r) => el('span', { class: 'mono small' }, Object.entries(r.inputs || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v}`).join('  ') || '—') },
        { label: 'Effective', nowrap: true, render: (r) => el('div', { class: 'small' }, fmtDateTime(r.effective_from), r.effective_to ? el('div', { class: 'faint' }, `until ${fmtDateTime(r.effective_to)}`) : null) },
      ],
      data.rules,
    ),
    el('div', { style: { marginTop: '1.25rem' } },
      card('Behavioural anomaly model',
        notice('Unsupervised only. Credible money-laundering labels are scarce and biased towards what a previous system already caught, '
          + 'so this layer answers a narrower question: how unusual is this customer relative to the population? It contributes a bounded '
          + 'number of points and never raises an alert on its own.'),
        anomaly.scores.length
          ? table(
            [
              { label: 'Customer', render: (s) => s.customer_name || `#${s.customer_id}` },
              { label: 'Score', render: (s) => el('div', { style: { minWidth: '110px' } }, el('div', { class: 'mono small' }, s.score.toFixed(3)), meter(s.score, s.score > 0.9 ? 'critical' : s.score > 0.7 ? 'high' : 'low')) },
              { label: 'Model', render: (s) => pill(`${s.model_name} v${s.model_version}`) },
              { label: 'Most influential features', render: (s) => el('span', { class: 'small' }, (s.attributions || []).slice(0, 3).map((a) => `${a.feature} (${a.contribution >= 0 ? '+' : ''}${a.contribution})`).join(', ') || 'no dominant feature') },
            ],
            anomaly.scores.slice(0, 15),
          )
          : el('div', { class: 'empty' }, 'No scores computed yet.'),
        el('p', { class: 'small faint' },
          'Attributions are single-feature ablations — each feature is replaced with the population median and the model re-scored. '
          + 'That is exact for "what if this feature were typical?" but does not decompose feature interactions the way SHAP would.'),
      ),
    ),
  );
}

// ------------------------------------------------------------- validation lab

const SAMPLE = {
  '@context': 'http://fintrac-canafe.gc.ca/reporting/api/lvctr/2021',
  '@type': 'LvctrForm',
  reportingEntityNumber: '1234567',
  reportReference: 'DEMO-0001',
  details: {
    '@type': 'LvctrFormDetails',
    activitySectorCode: '11',
    contactNumber: '7654321',
    twentyFourHourAggregationTypeCode: '2',
  },
  definitions: [],
  transactions: [
    {
      '@type': 'LvctrTransaction',
      details: {
        '@type': 'LvctrTransactionDetails',
        transactionReference: 'T0001',
        transactionDateTime: '2026-08-10T09:05:00',
        locationReference: 'L0000001',
        transactionMethodTypeCode: '8',
        thresholdIndicator: true,
      },
      startingActions: [{
        '@type': 'LvctrStartingAction',
        details: {
          '@type': 'LvctrStartingActionDetails',
          virtualCurrencyTypeCode: 'BTC',
          virtualCurrencyAmount: '0.5',
          canadianExchangeRate: '118400',
          conductorIndicator: true,
          sendingVirtualCurrencyAddresses: ['bc1qexampleaddress'],
        },
        conductors: [{
          '@type': 'LvctrConductor',
          subject: { $ref: 'C1' },
          details: { '@type': 'LvctrConductingDetails', onBehalfOfIndicator: true },
        }],
      }],
      completingActions: [{
        '@type': 'LvctrCompletingAction',
        details: {
          '@type': 'LvctrCompletingActionDetails',
          dispositionTypeCode: '17',
          virtualCurrencyTypeCode: 'BTC',
          virtualCurrencyAmount: '0.5',
          canadianEquivalentAmount: '99999.99',
          beneficiaryIndicator: true,
        },
      }],
    },
  ],
};

export async function validationLabView(root) {
  const editor = el('textarea', {
    style: { minHeight: '26rem', fontFamily: 'var(--mono)', fontSize: '0.8rem' },
    spellcheck: 'false',
  });
  editor.value = JSON.stringify(SAMPLE, null, 2);

  const output = el('div', {}, el('div', { class: 'empty' }, 'Paste a report payload and run validation.'));
  const levelBoxes = [1, 2, 3, 4].map((n) => el('input', { type: 'checkbox', checked: true, style: { width: 'auto' }, dataset: { level: String(n) } }));

  async function run() {
    let payload;
    try { payload = JSON.parse(editor.value); }
    catch (error) { mount(output, notice(`That is not valid JSON: ${error.message}`, 'danger')); return; }

    const levels = levelBoxes.filter((b) => b.checked).map((b) => b.dataset.level).join(',');
    if (!levels) { mount(output, notice('Select at least one level.', 'warn')); return; }

    mount(output, loading('Validating'));
    try {
      const result = await api.validatePayload(payload, levels);
      mount(output,
        el('div', { class: 'row' },
          el('strong', {}, `Report readiness ${result.readiness}%`),
          badge(result.valid ? 'submittable' : 'blocked', result.valid ? 'ok' : 'critical'),
          el('span', { class: 'small faint' }, `${result.error_count} error(s), ${result.warning_count} warning(s)`),
        ),
        el('div', { style: { margin: '0.6rem 0 1rem' } }, meter(result.readiness / 100, result.valid ? 'low' : 'critical')),
        result.issues.length
          ? el('div', {}, result.issues.map((i) => el('div', { class: 'issue' },
            badge(`L${i.level} ${i.severity === 'ERROR' ? 'error' : 'warn'}`, i.severity === 'ERROR' ? 'critical' : 'medium'),
            el('div', {},
              el('div', {}, i.message),
              el('div', { class: 'path' }, `${i.code} · ${i.path}`)),
          )))
          : notice('No issues found at the selected levels.', 'ok'),
      );
    } catch (error) {
      mount(output, notice(error.message, 'danger'));
    }
  }

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Validation lab'),
        el('p', {},
          'The reference implementation made you build a file, upload it, and only then discover which of hundreds of rules it broke. '
          + 'Everything checkable locally is checked here, with the failing path and a plain-English reason.'),
      ),
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: run }, 'Validate')),
    ),
    el('div', { class: 'row', style: { marginBottom: '0.75rem' } },
      ...[
        ['Level 1 — field format', 0],
        ['Level 2 — business rules', 1],
        ['Level 3 — JSON Schema', 2],
        ['Level 4 — cross-field', 3],
      ].map(([label, index]) => el('label', { class: 'row tight' }, levelBoxes[index], ' ', label)),
      el('span', { class: 'small faint' }, 'Level 5 records the receiver\'s own verdict at submission time.'),
    ),
    el('div', { class: 'grid cols-2' },
      card('Payload', editor),
      card('Findings', output),
    ),
  );

  await run();
}

// ------------------------------------------------------------------- reports

export async function reportView(root, { params, navigate }) {
  mount(root, loading('Loading report'));
  const report = await api.report(params.id);
  const v = report.validation || {};

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, report.report_reference),
        el('p', {}, `${report.report_type} · schema ${report.schema_version} · status ${report.status}`),
      ),
      el('div', { class: 'actions' },
        el('a', { class: 'pill', href: `/api/reports/${report.id}/download`, download: '' }, 'Download JSON'),
        el('button', { onclick: () => navigate(`#/cases/${report.case_id}`) }, 'Back to case'),
      ),
    ),
    el('div', { class: 'grid cols-2' },
      card('Validation',
        el('div', { class: 'row' },
          el('strong', {}, `Readiness ${v.readiness ?? 0}%`),
          badge(v.valid ? 'submittable' : 'blocked', v.valid ? 'ok' : 'critical'),
          el('span', { class: 'small faint' }, `levels ${(v.levels_run || []).join(', ')}`),
        ),
        el('div', { style: { margin: '0.6rem 0' } }, meter((v.readiness ?? 0) / 100, v.valid ? 'low' : 'critical')),
        (v.issues || []).length
          ? el('div', {}, v.issues.map((i) => el('div', { class: 'issue' },
            badge(`L${i.level}`, i.severity === 'ERROR' ? 'critical' : 'medium'),
            el('div', {}, el('div', {}, i.message), el('div', { class: 'path' }, `${i.code} · ${i.path}`)))))
          : notice('Clean at every level run locally.', 'ok'),
        (report.submissions || []).length
          ? el('div', { style: { marginTop: '1rem' } },
            el('h3', {}, 'Submission history'),
            table(
              [
                { label: 'When', render: (s) => fmtDateTime(s.submitted_at) },
                { label: 'Request', render: (s) => el('span', { class: 'mono small' }, s.request_id) },
                { label: 'Verdict', render: (s) => badge(s.response_status, s.response_status === 'accepted' ? 'ok' : 'critical') },
                { label: 'Receipt', render: (s) => el('span', { class: 'mono small' }, s.submission_id || '—') },
              ],
              report.submissions,
            ))
          : null,
      ),
      card('FINTRAC payload',
        notice('Field names, nesting and code lists were reconciled against the 2021 reference implementation. '
          + 'Any real filing must be reconciled against FINTRAC\'s current technical documentation first.', 'warn'),
        json(report.payload),
      ),
    ),
    report.narrative
      ? el('div', { style: { marginTop: '1rem' } },
        card('Narrative', el('pre', { style: { whiteSpace: 'pre-wrap' } }, report.narrative)))
      : null,
  );
}

// --------------------------------------------------------------------- audit

export async function auditView(root) {
  mount(root, loading('Loading audit trail'));
  const [data, chain] = await Promise.all([api.audit({ limit: 300 }), api.verifyAudit()]);

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Audit trail'),
        el('p', {}, 'Append-only and hash-chained. Editing or removing a historical row breaks the chain and is detectable.'),
      ),
      el('div', { class: 'actions' },
        el('button', {
          onclick: async () => {
            const result = await api.verifyAudit();
            toast(result.valid
              ? `Chain intact across ${result.checked} events.`
              : `Chain broken at event ${result.broken_at}: ${result.problem}`,
            result.valid ? 'ok' : 'err', 8000);
          },
        }, 'Re-verify chain'),
      ),
    ),
    chain.valid
      ? notice(`Chain verified across ${chain.checked} events. No history has been altered.`, 'ok')
      : notice(`Chain broken at event ${chain.broken_at}: ${chain.problem}.`, 'danger'),
    el('div', { style: { marginTop: '1rem' } },
      table(
        [
          { label: 'When', nowrap: true, render: (e) => fmtDateTime(e.occurred_at) },
          { label: 'Actor', render: (e) => e.actor },
          { label: 'Action', render: (e) => pill(e.action) },
          { label: 'Object', render: (e) => el('span', { class: 'mono small' }, `${e.object_type}:${e.object_id}`) },
          { label: 'Change', render: (e) => el('span', { class: 'small mono' }, summarise(e)) },
          { label: 'Reason', render: (e) => el('span', { class: 'small' }, e.reason || '') },
        ],
        data.events,
      ),
    ),
  );
}

function summarise(event) {
  const parts = [];
  if (event.before) parts.push(`was ${JSON.stringify(event.before)}`);
  if (event.after) parts.push(`now ${JSON.stringify(event.after)}`);
  const text = parts.join(' · ');
  return text.length > 130 ? `${text.slice(0, 130)}…` : text;
}
