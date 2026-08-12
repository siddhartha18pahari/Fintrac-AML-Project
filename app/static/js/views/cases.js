import { api } from '../api.js';
import {
  badge, card, el, field, fmtCad, fmtDateTime, loading, meter, modal, mount,
  notice, pill, relativeHours, table, tierTone, toast,
} from '../ui.js';

export async function casesView(root, { navigate }) {
  const state = { status: '', tier: '', open_only: true };
  const body = el('div', {});

  async function refresh() {
    mount(body, loading('Loading cases'));
    const data = await api.cases({ ...state, limit: 200 });
    mount(body, table(
      [
        { label: 'Case', nowrap: true, render: (c) => el('span', { class: 'mono' }, c.reference) },
        { label: 'Subject', render: (c) => el('div', {}, el('div', {}, c.customer_name || `#${c.customer_id}`), el('div', { class: 'small faint mono' }, c.customer_reference || '')) },
        {
          label: 'Risk',
          render: (c) => el('div', { style: { minWidth: '110px' } },
            el('div', { class: 'row tight' },
              el('strong', {}, c.effective_score),
              badge(c.risk_tier, tierTone(c.risk_tier)),
              c.overridden_score !== null ? badge('overridden', 'medium') : null),
            meter(c.effective_score / 100, tierTone(c.risk_tier))),
        },
        { label: 'Obligations', render: (c) => el('div', { class: 'row tight' },
          c.lvctr_required ? badge('LVCTR', 'reporting') : null,
          c.str_candidate ? badge('STR review', 'medium') : null,
          !c.lvctr_required && !c.str_candidate ? el('span', { class: 'faint' }, '—') : null) },
        { label: 'Status', render: (c) => badge(c.status.replace(/_/g, ' '), statusTone(c.status)) },
        { label: 'Due', nowrap: true, render: (c) => dueCell(c.due_at) },
        { label: 'Opened', nowrap: true, render: (c) => fmtDateTime(c.opened_at) },
      ],
      data.cases,
      { onRowClick: (c) => navigate(`#/cases/${c.id}`), empty: 'No cases match these filters.' },
    ));
  }

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Cases'),
        el('p', {}, 'One open case per subject. Splitting the same behaviour across several cases is how context gets lost.'),
      ),
    ),
    el('div', { class: 'row', style: { marginBottom: '1rem' } },
      el('div', { style: { minWidth: '200px' } }, field('Status', el('select', {
        onchange: (e) => { state.status = e.target.value; refresh(); },
      }, ['', 'NEW', 'TRIAGE', 'UNDER_REVIEW', 'ESCALATED', 'DECISION', 'APPROVED', 'FILED', 'CLOSED_NO_FILING']
        .map((v) => el('option', { value: v }, v ? v.replace(/_/g, ' ') : 'Any status'))))),
      el('div', { style: { minWidth: '160px' } }, field('Tier', el('select', {
        onchange: (e) => { state.tier = e.target.value; refresh(); },
      }, ['', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => el('option', { value: v }, v || 'Any tier'))))),
      el('label', { class: 'row tight', style: { marginTop: '0.9rem' } },
        el('input', { type: 'checkbox', checked: true, style: { width: 'auto' }, onchange: (e) => { state.open_only = e.target.checked; refresh(); } }),
        ' Open cases only'),
    ),
    body,
  );
  await refresh();
}

function statusTone(status) {
  if (status === 'FILED') return 'ok';
  if (status === 'CLOSED_NO_FILING' || status === 'ARCHIVED') return 'neutral';
  if (status === 'ESCALATED' || status === 'DECISION') return 'high';
  return 'neutral';
}

function dueCell(due) {
  if (!due) return el('span', { class: 'faint' }, '—');
  const hours = relativeHours(due);
  const tone = hours < 0 ? 'critical' : hours < 48 ? 'medium' : 'neutral';
  return el('div', {},
    el('span', { class: `badge ${tone}` }, hours < 0 ? `${Math.abs(Math.round(hours))}h overdue` : `${Math.round(hours)}h`),
    el('div', { class: 'small faint' }, fmtDateTime(due)),
  );
}

// ---------------------------------------------------------------------------
// Case workbench
// ---------------------------------------------------------------------------

export async function caseDetailView(root, ctx) {
  const { params, navigate, permissions } = ctx;
  mount(root, loading('Loading case'));

  const data = await api.caseDetail(params.id);
  const c = data.case;
  const can = (perm) => permissions.includes(perm);

  const reload = () => caseDetailView(root, ctx);

  const graphHolder = el('div', { class: 'graph-holder', style: { height: '380px' } }, loading('Building network'));
  const strHolder = el('div', {}, el('p', { class: 'muted small' }, 'Generate an evidence-grounded draft below.'));
  const reportHolder = el('div', {});

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, `${c.reference} · ${c.customer_name}`),
        el('div', { class: 'row tight', style: { marginTop: '0.35rem' } },
          badge(c.status.replace(/_/g, ' '), statusTone(c.status)),
          badge(`${c.risk_tier} ${c.effective_score}/100`, tierTone(c.risk_tier)),
          c.lvctr_required ? badge('LVCTR required', 'reporting') : null,
          c.str_candidate ? badge('STR review', 'medium') : null,
          c.disposition ? pill(c.disposition.replace(/_/g, ' ')) : null,
          c.due_at ? dueCell(c.due_at) : null,
        ),
      ),
      el('div', { class: 'actions' }, ...caseActions(c, ctx, reload, can)),
    ),

    c.overridden_score !== null
      ? notice(`Score overridden to ${c.overridden_score} (engine computed ${c.risk_score}). Reason: ${c.override_reason}`, 'warn')
      : null,
    c.lvctr_required
      ? notice('This case reached the LVCTR reporting threshold. The threshold test is not a matter of judgement, so it cannot be dispositioned "no filing".', 'warn')
      : null,

    el('div', { class: 'grid cols-3', style: { marginTop: '1rem' } },
      card('Subject',
        el('div', { class: 'stack' },
          kv('Customer', data.customer.name),
          kv('Reference', el('span', { class: 'mono' }, data.customer.customer_id)),
          kv('Type', data.customer.customer_type),
          kv('KYC risk', badge(data.customer.kyc_risk, tierTone(data.customer.kyc_risk))),
          kv('Country', data.customer.country),
          kv('Stated business', data.customer.occupation_or_business || '—'),
          kv('Expected monthly', fmtCad(data.customer.expected_monthly_volume_cad)),
        ),
      ),

      card('Risk drivers',
        (c.risk_drivers || []).length
          ? el('div', {}, (c.risk_drivers || []).map(driverRow))
          : el('div', { class: 'empty' }, 'No drivers recorded.'),
        el('p', { class: 'small faint', style: { marginBottom: 0 } },
          'Contributions are additive and capped at 100. Where a rule fired more than once, only its highest-scoring firing counts.'),
      ),

      card('Transaction network', graphHolder),
    ),

    el('div', { class: 'grid cols-2', style: { marginTop: '1rem' } },
      card('Transaction timeline',
        data.timeline.length
          ? el('div', { class: 'timeline' }, data.timeline.map((t) => el('div', { class: `tl-item ${t.direction === 'OUTGOING' ? 'out' : ''}` },
            el('div', { class: 'when' }, fmtDateTime(t.occurred_at)),
            el('div', { class: 'what' },
              t.direction === 'INCOMING' ? 'Received ' : 'Sent ',
              el('strong', {}, `${t.asset_amount} ${t.asset}`),
              ' · ', fmtCad(t.cad_value),
              el('div', { class: 'small faint mono' }, `${t.transaction_id ?? t.external_id ?? ''} ${t.wallet_from ? `from ${t.wallet_from.slice(0, 12)}…` : ''}`),
            ),
          )))
          : el('div', { class: 'empty' }, 'No transactions attached.'),
      ),

      card('Reporting obligations',
        table(
          [
            { label: 'Grouping', render: (e) => e.group_type.replace(/_/g, ' ') },
            { label: 'Receipts', align: 'right', render: (e) => e.receipt_count },
            { label: 'Aggregated', align: 'right', render: (e) => fmtCad(e.total_cad) },
            { label: 'Due', nowrap: true, render: (e) => fmtDateTime(e.due_at) },
            { label: 'Reported', render: (e) => badge(e.reported ? 'filed' : 'open', e.reported ? 'ok' : 'medium') },
          ],
          data.aggregation_events,
          { empty: 'No threshold obligation on this case.' },
        ),
        el('div', { style: { marginTop: '1rem' } }, reportHolder),
      ),
    ),

    el('div', { class: 'grid cols-2', style: { marginTop: '1rem' } },
      card('Alerts on this case',
        table(
          [
            { label: 'Rule', render: (a) => pill(`${a.rule_id} v${a.rule_version}`) },
            { label: 'Finding', render: (a) => el('div', {}, el('div', {}, a.title), el('div', { class: 'small faint' }, a.explanation?.detail || '')) },
            { label: 'Points', align: 'right', render: (a) => `+${a.score_contribution}` },
          ],
          data.alerts,
          { empty: 'No alerts linked.' },
        ),
      ),

      card('Investigator notes',
        el('div', { class: 'stack' },
          (c.notes || []).length
            ? el('div', {}, (c.notes || []).map((n) => el('div', { style: { borderBottom: '1px solid var(--border)', padding: '0.5rem 0' } },
              el('div', { class: 'small faint' }, `${fmtDateTime(n.created_at)} · ${n.note_type.toLowerCase()}`),
              el('div', {}, n.body))))
            : el('div', { class: 'empty' }, 'No notes yet.'),
          can('case:note') ? noteForm(c, reload) : null,
        ),
      ),
    ),

    el('div', { class: 'grid cols-1', style: { marginTop: '1rem' } },
      card('STR copilot', strHolder),
    ),
  );

  // Async panels, loaded after the shell so the page is usable immediately.
  api.caseGraph(c.id, 2)
    .then(async (payload) => {
      const { renderGraph } = await import('../graph.js');
      renderGraph(graphHolder, payload, { height: 380 });
    })
    .catch(() => mount(graphHolder, el('div', { class: 'empty' }, 'Network view unavailable.')));

  renderReports(reportHolder, c, ctx, reload);
  renderStrPanel(strHolder, c, can, reload);
}

function kv(label, value) {
  return el('div', { class: 'row', style: { justifyContent: 'space-between', gap: '1rem' } },
    el('span', { class: 'small faint' }, label),
    el('span', { class: 'small', style: { textAlign: 'right' } }, value),
  );
}

function driverRow(driver) {
  return el('div', { class: 'driver' },
    el('div', { class: 'points' }, `+${driver.points}`),
    el('div', {},
      el('div', { class: 'label' }, driver.label),
      driver.detail ? el('div', { class: 'detail' }, driver.detail) : null,
      el('div', { class: 'meta' },
        pill(driver.source === 'model' ? `${driver.key} v${driver.version}` : `${driver.key} v${driver.version}`),
        driver.source === 'model' ? badge('model', 'reporting') : badge('rule', 'neutral'),
        (driver.evidence_ids || []).length ? el('span', { class: 'small faint' }, `${driver.evidence_ids.length} evidence item(s)`) : null,
      ),
    ),
  );
}

function noteForm(c, reload) {
  const input = el('textarea', { placeholder: 'Facts, context, the customer\'s explanation, and what you concluded.' });
  return el('div', { style: { marginTop: '0.5rem' } },
    field('Add a note', input),
    el('button', {
      onclick: async () => {
        const body = input.value.trim();
        if (!body) return toast('A note cannot be empty.', 'err');
        await api.post(`/api/cases/${c.id}/notes`, { body });
        toast('Note recorded.', 'ok');
        reload();
      },
    }, 'Save note'),
  );
}

// ---------------------------------------------------------------------- actions

function caseActions(c, ctx, reload, can) {
  const actions = [];

  if (can('case:escalate') && !['FILED', 'ARCHIVED', 'CLOSED_NO_FILING'].includes(c.status)) {
    actions.push(el('button', { onclick: () => changeStatus(c, reload) }, 'Change status'));
  }
  if (can('case:override_risk')) {
    actions.push(el('button', { onclick: () => overrideRisk(c, reload) }, 'Override score'));
  }
  if (can('case:decide') && !c.disposition) {
    actions.push(el('button', { class: 'primary', onclick: () => recordDecision(c, reload) }, 'Record decision'));
  }
  if (can('case:approve') && c.status === 'DECISION') {
    actions.push(el('button', { class: 'primary', onclick: () => approve(c, reload) }, 'Approve for filing'));
  }
  actions.push(el('button', { class: 'ghost', onclick: () => ctx.navigate('#/cases') }, 'All cases'));
  return actions;
}

async function changeStatus(c, reload) {
  const select = el('select', {}, ['TRIAGE', 'UNDER_REVIEW', 'ESCALATED', 'DECISION', 'CLOSED_NO_FILING', 'ARCHIVED']
    .map((s) => el('option', { value: s }, s.replace(/_/g, ' '))));
  const reason = el('input', { placeholder: 'Optional note for the audit trail' });
  await modal({
    title: `Change status of ${c.reference}`,
    body: el('div', {}, field('New status', select), field('Reason', reason)),
    confirmLabel: 'Apply',
    onConfirm: async () => {
      await api.post(`/api/cases/${c.id}/status`, { status: select.value, reason: reason.value || null });
      toast(`Case moved to ${select.value.replace(/_/g, ' ')}.`, 'ok');
      reload();
    },
  });
}

async function overrideRisk(c, reload) {
  const score = el('input', { type: 'number', min: '0', max: '100', value: String(c.effective_score) });
  const reason = el('textarea', { placeholder: 'Why does your assessment differ from the engine\'s?' });
  await modal({
    title: 'Override the computed risk score',
    body: el('div', {},
      notice('The engine score is preserved alongside your override. Model governance depends on being able to measure how often, and in which direction, humans disagree with the engine.'),
      field('Your score', score),
      field('Reason', reason, 'At least 10 characters.')),
    confirmLabel: 'Record override',
    onConfirm: async () => {
      await api.post(`/api/cases/${c.id}/override`, { score: Number(score.value), reason: reason.value.trim() });
      toast('Override recorded.', 'ok');
      reload();
    },
  });
}

async function recordDecision(c, reload) {
  const options = c.lvctr_required
    ? [['LVCTR', 'File an LVCTR'], ['LVCTR_AND_STR', 'File an LVCTR and an STR']]
    : [['NO_FILING', 'No filing'], ['STR', 'File an STR'], ['LVCTR', 'File an LVCTR'], ['LVCTR_AND_STR', 'File both']];
  const select = el('select', {}, options.map(([v, label]) => el('option', { value: v }, label)));
  const rationale = el('textarea', { placeholder: 'What did you find, what did the customer say, and why this disposition?' });
  await modal({
    title: `Filing decision for ${c.reference}`,
    body: el('div', {},
      c.lvctr_required
        ? notice('This case reached the reporting threshold, so every available disposition includes an LVCTR.', 'warn')
        : notice('An STR is suspicion-driven. A model score is not a filing decision.'),
      field('Disposition', select),
      field('Documented rationale', rationale, 'At least 20 characters. This becomes part of the record.')),
    confirmLabel: 'Record decision',
    onConfirm: async () => {
      await api.post(`/api/cases/${c.id}/decision`, { disposition: select.value, rationale: rationale.value.trim() });
      toast('Decision recorded. It now needs a separate approver.', 'ok');
      reload();
    },
  });
}

async function approve(c, reload) {
  await modal({
    title: `Approve ${c.reference} for filing`,
    body: notice('Four-eyes control: the case owner cannot approve their own decision. Approval is attributable and timestamped.'),
    confirmLabel: 'Approve',
    onConfirm: async () => {
      await api.post(`/api/cases/${c.id}/approve`);
      toast('Case approved. Reports can now be submitted.', 'ok');
      reload();
    },
  });
}

// ---------------------------------------------------------------------- reports

async function renderReports(holder, c, ctx, reload) {
  const can = (p) => ctx.permissions.includes(p);
  const data = await api.reports({ case_id: c.id });

  const buildButton = can('report:build')
    ? el('button', {
      class: 'primary',
      onclick: async () => {
        try {
          await api.buildReport(c.id, { report_type: 'LVCTR', include_narrative: false });
          toast('LVCTR built and validated.', 'ok');
          reload();
        } catch (error) { toast(error.message, 'err', 9000); }
      },
    }, data.reports.some((r) => r.report_type === 'LVCTR') ? 'Rebuild LVCTR' : 'Build LVCTR')
    : null;

  mount(holder,
    el('div', { class: 'row', style: { marginBottom: '0.75rem' } },
      el('strong', {}, 'Reports'),
      el('span', { class: 'nav-spacer', style: { flex: 1 } }),
      buildButton,
    ),
    data.reports.length
      ? el('div', {}, data.reports.map((r) => reportRow(r, c, ctx, reload)))
      : el('p', { class: 'small faint', style: { margin: 0 } },
        c.lvctr_required ? 'No report built yet.' : 'No reporting obligation on this case.'),
  );
}

function reportRow(report, c, ctx, reload) {
  const v = report.validation || {};
  const can = (p) => ctx.permissions.includes(p);
  const errors = v.error_count || 0;

  return el('div', { style: { borderTop: '1px solid var(--border)', paddingTop: '0.7rem', marginTop: '0.7rem' } },
    el('div', { class: 'row' },
      el('strong', { class: 'mono small' }, report.report_reference),
      badge(report.status, report.status === 'ACCEPTED' ? 'ok' : errors ? 'critical' : 'neutral'),
      el('span', { class: 'small faint' }, `readiness ${v.readiness ?? 0}%`),
    ),
    el('div', { style: { margin: '0.5rem 0' } }, meter((v.readiness ?? 0) / 100, errors ? 'critical' : 'low')),
    errors
      ? el('div', {}, (v.issues || []).filter((i) => i.severity === 'ERROR').slice(0, 6).map((i) => el('div', { class: 'issue' },
        badge(`L${i.level}`, 'critical'),
        el('div', {}, el('div', {}, i.message), el('div', { class: 'path' }, i.path)),
      )))
      : el('p', { class: 'small', style: { color: 'var(--low)', margin: 0 } },
        `Passed levels ${(v.levels_run || []).join(', ')} with ${v.warning_count || 0} warning(s).`),
    el('div', { class: 'row', style: { marginTop: '0.6rem' } },
      el('button', { class: 'sm', onclick: () => ctx.navigate(`#/reports/${report.id}`) }, 'View payload'),
      el('a', { class: 'pill', href: `/api/reports/${report.id}/download`, download: '' }, 'Download JSON'),
      can('report:submit') && report.status !== 'ACCEPTED'
        ? el('button', {
          class: 'sm primary',
          onclick: async () => {
            try {
              const result = await api.submitReport(report.id);
              const status = result.submission.response_status;
              toast(status === 'accepted'
                ? `Accepted by the mock receiver as ${result.submission.submission_id}.`
                : `Rejected with ${result.submission.response.validation_messages.length} finding(s).`,
              status === 'accepted' ? 'ok' : 'err', 9000);
              reload();
            } catch (error) { toast(error.message, 'err', 10000); }
          },
        }, 'Submit to mock receiver')
        : null,
    ),
    (report.submissions || []).length
      ? el('div', { class: 'small faint', style: { marginTop: '0.4rem' } },
        `${report.submissions.length} submission attempt(s); latest ${report.submissions.at(-1).response_status}.`)
      : null,
  );
}

// ------------------------------------------------------------------ STR panel

async function renderStrPanel(holder, c, can, reload) {
  const generate = el('button', { class: 'primary' }, 'Generate evidence-grounded draft');
  mount(holder,
    notice('The copilot composes a draft from case evidence only, cites every sentence, and refuses to assert '
      + 'anything the facts do not contain. It never files anything.'),
    el('div', { class: 'row', style: { marginTop: '0.75rem' } }, generate),
  );

  generate.addEventListener('click', async () => {
    generate.disabled = true;
    const output = el('div', {}, loading('Drafting'));
    holder.append(output);
    try {
      const draft = await api.strDraft(c.id);
      const verification = draft.verification;
      mount(output,
        el('div', { style: { marginTop: '1rem' } },
          verification.supported
            ? notice('Verified: every figure and date in this draft appears in the case evidence, and no sentence asserts that an offence occurred.', 'ok')
            : notice(`Verification failed: ${verification.unsupported_claims.length} unsupported figure(s), `
              + `${verification.prohibited_language.length} statement(s) asserting criminality. Do not file this draft as written.`, 'danger'),
          draft.missing_information?.length
            ? notice(`Missing information: ${draft.missing_information.join(' ')}`, 'warn')
            : null,
          el('div', { class: 'grid cols-2', style: { marginTop: '0.75rem' } },
            el('div', {},
              el('h3', {}, 'Draft details of suspicion'),
              el('pre', { style: { whiteSpace: 'pre-wrap' } }, draft.narrative)),
            el('div', {},
              el('h3', {}, 'Claim-to-evidence citations'),
              table(
                [
                  { label: 'Sentence', render: (s) => el('span', { class: 'small' }, s.sentence) },
                  { label: 'Evidence', align: 'right', render: (s) => el('span', { class: 'small mono', title: s.evidence.join(', ') }, s.evidence.length) },
                ],
                draft.citations,
              )),
          ),
          el('p', { class: 'small faint' }, draft.disclaimer),
          can('report:build')
            ? el('button', {
              onclick: async () => {
                await api.buildReport(c.id, { report_type: 'STR', include_narrative: true });
                toast('STR draft attached to the case for review.', 'ok');
                reload();
              },
            }, 'Attach draft to the case')
            : null,
        ),
      );
    } catch (error) {
      mount(output, notice(error.message, 'danger'));
    } finally {
      generate.disabled = false;
    }
  });
}
