// Force-directed transaction-network renderer.
//
// Hand-rolled rather than pulling in a graph library, because the whole app is
// a strict-CSP, no-external-request page: a compliance console that blanks out
// on an air-gapped network is not usable. The simulation is a plain
// Fruchterman-Reingold layout with a fixed iteration budget, run once on a
// worker-free rAF loop and then frozen, so it never burns CPU in the
// background of a case an investigator has left open.

const NODE_COLOURS = {
  customer: 'var(--accent)',
  wallet: 'var(--text-dim)',
  beneficiary: 'var(--reporting)',
  third_party: 'var(--medium)',
  party: 'var(--medium)',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  return node;
}

function nodeRadius(node) {
  if (node.kind === 'customer') return 13;
  if (node.risk_tags?.length || node.external_risk_score >= 70) return 9;
  return 6;
}

function nodeColour(node) {
  if (node.kind === 'wallet') {
    if (node.risk_tags?.length || node.external_risk_score >= 70) return 'var(--critical)';
    if (node.internal) return 'var(--low)';
  }
  return NODE_COLOURS[node.kind] || 'var(--text-faint)';
}

/**
 * Render a graph payload from /api/cases/{id}/graph into `container`.
 * Returns a teardown function.
 */
export function renderGraph(container, payload, { height = 380, onSelect } = {}) {
  container.innerHTML = '';
  container.style.height = `${height}px`;

  const rawNodes = payload.nodes || [];
  if (!rawNodes.length) {
    container.innerHTML = '<div class="empty">No network activity to plot.</div>';
    return () => {};
  }

  const width = container.clientWidth || 720;
  const index = new Map(rawNodes.map((n, i) => [n.id, i]));

  // Deterministic starting positions: a ring, seeded by index. Random starts
  // make the same case look different on every visit, which destroys an
  // investigator's ability to recognise a network they have seen before.
  const nodes = rawNodes.map((n, i) => {
    const angle = (i / rawNodes.length) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.34;
    return {
      ...n,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      pinned: n.id === payload.focus,
    };
  });

  const focus = nodes.find((n) => n.id === payload.focus);
  if (focus) { focus.x = width / 2; focus.y = height / 2; }

  const links = [];
  const seen = new Set();
  for (const edge of payload.edges || []) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (seen.has(key)) {
      links.find((l) => l.key === key).weight += 1;
      continue;
    }
    seen.add(key);
    links.push({ key, source: a, target: b, weight: 1, relation: edge.relation, cad: edge.cad_value });
  }

  layout(nodes, links, width, height);

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Transaction network' });
  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id: 'arrow', viewBox: '0 0 10 10', refX: 18, refY: 5,
    markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse',
  });
  marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--border-strong)' }));
  defs.append(marker);
  svg.append(defs);

  const edgeLayer = svgEl('g');
  for (const link of links) {
    const a = nodes[link.source];
    const b = nodes[link.target];
    edgeLayer.append(svgEl('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: link.relation === 'SENT' ? 'var(--border-strong)' : 'var(--border)',
      'stroke-width': Math.min(3, 0.8 + Math.log2(link.weight + 1) * 0.7),
      'stroke-dasharray': link.relation === 'SENT' ? null : '3 3',
      'marker-end': link.relation === 'SENT' ? 'url(#arrow)' : null,
      opacity: 0.75,
    }));
  }
  svg.append(edgeLayer);

  const tip = document.createElement('div');
  tip.className = 'graph-tip';
  tip.style.display = 'none';
  container.append(tip);

  const nodeLayer = svgEl('g');
  for (const node of nodes) {
    const group = svgEl('g', { transform: `translate(${node.x},${node.y})`, style: 'cursor:pointer' });
    const circle = svgEl('circle', {
      r: nodeRadius(node),
      fill: nodeColour(node),
      stroke: node.id === payload.focus ? 'var(--text)' : 'var(--bg)',
      'stroke-width': node.id === payload.focus ? 2.5 : 1.5,
    });
    group.append(circle);

    if (node.kind === 'customer' || node.risk_tags?.length) {
      const label = svgEl('text', { class: 'node-label', y: nodeRadius(node) + 12, 'text-anchor': 'middle' });
      label.textContent = (node.label || '').slice(0, 22);
      group.append(label);
    }

    group.addEventListener('mouseenter', () => {
      tip.textContent = describe(node);
      tip.style.display = 'block';
      tip.style.left = `${Math.min(node.x + 14, width - 220)}px`;
      tip.style.top = `${Math.max(node.y - 10, 6)}px`;
    });
    group.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    if (onSelect) group.addEventListener('click', () => onSelect(node));
    nodeLayer.append(group);
  }
  svg.append(nodeLayer);
  container.prepend(svg);

  const legend = document.createElement('div');
  legend.className = 'graph-legend';
  for (const [text, colour] of [
    ['Customer', 'var(--accent)'],
    ['Internal wallet', 'var(--low)'],
    ['External wallet', 'var(--text-dim)'],
    ['High-risk wallet', 'var(--critical)'],
    ['Beneficiary', 'var(--reporting)'],
    ['Third party', 'var(--medium)'],
  ]) {
    const item = document.createElement('span');
    const dot = document.createElement('i');
    dot.style.background = colour;
    item.append(dot, document.createTextNode(text));
    legend.append(item);
  }
  container.append(legend);

  return () => { container.innerHTML = ''; };
}

function describe(node) {
  const parts = [node.label || node.id];
  if (node.kind === 'wallet') {
    parts.push(`${node.blockchain || 'chain'} · risk ${node.external_risk_score ?? 0}/100`);
    if (node.risk_tags?.length) parts.push(`tags: ${node.risk_tags.join(', ')}`);
    if (node.internal) parts.push('hosted by the reporting entity');
    if (node.address) parts.push(node.address);
  } else if (node.kind === 'customer') {
    parts.push(`customer · KYC risk ${node.kyc_risk || 'n/a'} · ${node.country || ''}`);
  } else {
    parts.push(node.kind.replace('_', ' '));
  }
  return parts.join('\n');
}

/** Fruchterman-Reingold with a fixed budget; positions settle deterministically. */
function layout(nodes, links, width, height, iterations = 220) {
  const area = width * height;
  const k = Math.sqrt(area / Math.max(nodes.length, 1)) * 0.62;
  let temperature = width / 8;
  const cooling = temperature / (iterations + 1);

  for (let step = 0; step < iterations; step += 1) {
    for (const node of nodes) { node.vx = 0; node.vy = 0; }

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) { dx = (i % 7) - 3 || 1; dy = (j % 5) - 2 || 1; dist = Math.hypot(dx, dy); }
        const force = (k * k) / dist;
        const ux = (dx / dist) * force;
        const uy = (dy / dist) * force;
        nodes[i].vx += ux; nodes[i].vy += uy;
        nodes[j].vx -= ux; nodes[j].vy -= uy;
      }
    }

    for (const link of links) {
      const a = nodes[link.source];
      const b = nodes[link.target];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const force = (dist * dist) / k;
      const ux = (dx / dist) * force;
      const uy = (dy / dist) * force;
      a.vx -= ux; a.vy -= uy;
      b.vx += ux; b.vy += uy;
    }

    for (const node of nodes) {
      if (node.pinned) continue;
      const speed = Math.max(Math.hypot(node.vx, node.vy), 0.01);
      node.x += (node.vx / speed) * Math.min(speed, temperature);
      node.y += (node.vy / speed) * Math.min(speed, temperature);
      node.x = Math.max(24, Math.min(width - 24, node.x));
      node.y = Math.max(20, Math.min(height - 20, node.y));
    }
    temperature -= cooling;
  }
}
