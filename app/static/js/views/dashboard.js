import { api } from '../api.js';
import { card, el, fmtCad, fmtNum, loading, mount, notice, stat, table, tierTone, badge } from '../ui.js';

const TIERS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export async function dashboardView(root, { navigate }) {
  mount(root, loading('Loading dashboard'));
  const data = await api.dashboard();
  const w = data.widgets;
  const threshold = data.threshold;

  const maxTier = Math.max(1, ...TIERS.map((t) => data.risk_distribution[t] || 0));
  const maxTypology = Math.max(1, ...data.typologies.map((t) => t.count));

  mount(root,
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Compliance overview'),
        el('p', {},
          `Threshold CAD ${fmtNum(threshold.lvctr_threshold_cad)} · `,
          `${threshold.aggregation_window_hours}-hour aggregation window · `,
          `${threshold.filing_deadline_working_days} working days to file.`),
      ),
      el('div', { class: 'actions' },
        el('button', { onclick: () => navigate('#/candidates') }, 'LVCTR candidates'),
        el('button', { class: 'primary', onclick: () => navigate('#/cases') }, 'Open cases'),
      ),
    ),

    el('div', { class: 'grid cols-4', style: { marginBottom: '1rem' } },
      stat({ value: w.open_cases, label: 'Open cases' }),
      stat({ value: w.high_risk_cases, label: 'High-risk cases', tone: w.high_risk_cases ? 'high' : undefined }),
      stat({ value: w.lvctr_candidates, label: 'LVCTR candidates unreported', tone: w.lvctr_candidates ? 'medium' : 'good' }),
      stat({ value: w.str_reviews_pending, label: 'STR reviews pending' }),
      stat({ value: w.reports_due_48h, label: 'Reports due < 48h', tone: w.reports_due_48h ? 'medium' : 'good' }),
      stat({ value: w.overdue_cases, label: 'Past filing deadline', tone: w.overdue_cases ? 'critical' : 'good' }),
      stat({ value: w.validation_failures, label: 'Reports failing validation', tone: w.validation_failures ? 'high' : 'good' }),
      stat({ value: fmtNum(data.volumes.transactions), label: 'Transactions monitored', hint: fmtCad(data.volumes.total_cad) }),
    ),

    el('div', { class: 'grid cols-2' },
      card('Case risk distribution',
        ...TIERS.map((tier) => el('div', { class: 'bar-row' },
          badge(tier, tierTone(tier)),
          el('div', { class: `meter ${tierTone(tier)}` },
            el('span', { style: { width: `${((data.risk_distribution[tier] || 0) / maxTier) * 100}%` } })),
          el('span', { class: 'num' }, data.risk_distribution[tier] || 0),
        )),
        el('p', { class: 'small faint', style: { marginTop: '0.9rem', marginBottom: 0 } },
          'Tier is derived from the composite score. Every score decomposes into ranked drivers on the case page.'),
      ),

      card('AML typologies observed',
        data.typologies.length
          ? el('div', {}, data.typologies.slice(0, 9).map((t) => el('div', { class: 'bar-row' },
            el('span', { class: 'pill', title: t.title }, t.rule_id),
            el('div', { class: 'meter' }, el('span', { style: { width: `${(t.count / maxTypology) * 100}%` } })),
            el('span', { class: 'num' }, t.count),
          )))
          : el('div', { class: 'empty' }, 'No alerts yet. Run the detection pipeline.'),
      ),
    ),

    el('div', { class: 'grid cols-2', style: { marginTop: '1rem' } },
      card('Operational load',
        table(
          [
            { label: 'Metric', render: (r) => r.label },
            { label: 'Value', align: 'right', render: (r) => r.value },
          ],
          [
            { label: 'Alerts per 1,000 transactions', value: data.operational_metrics.alerts_per_1000_transactions },
            { label: 'Cases per 1,000 transactions', value: data.operational_metrics.cases_per_1000_transactions },
            { label: 'High-risk share of cases', value: `${data.operational_metrics.high_risk_share_of_cases_pct}%` },
            { label: 'Customers monitored', value: fmtNum(data.volumes.customers) },
            { label: 'Alerts (not dismissed)', value: fmtNum(data.volumes.alerts) },
          ],
        ),
        notice(data.operational_metrics.note),
      ),

      card('What this system does not do',
        el('div', { class: 'stack' },
          notice('Rules and models identify signals. A person decides whether a report is filed, and the reasoning is recorded on the case.', 'ok'),
          notice('An LVCTR obligation is threshold-driven: a case that reaches it cannot be dispositioned "no filing". An STR is always a judgement call.', 'warn'),
          notice('Reports are submitted to a local mock receiver. This deployment has no connection to FINTRAC and holds no real customer data.', 'danger'),
        ),
      ),
    ),
  );
}
