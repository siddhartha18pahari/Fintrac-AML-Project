export type Passage = {
  id: string;
  title: string;
  text: string;
  source: string;
  topics?: string[];
  score?: number;
};

const K1 = 1.5;
const B = 0.75;

export function tokenize(text: string) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function indexedText(passage: Passage) {
  return `${passage.title} ${passage.title} ${passage.title} ${passage.text}`;
}

export function searchPassages(query: string, passages: Passage[], k = 4): Passage[] {
  const tokens = passages.map((passage) => tokenize(indexedText(passage)));
  const queryTerms = tokenize(query);
  if (!passages.length || !queryTerms.length) return [];
  const lengths = tokens.map((row) => row.length);
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const documentFrequency = new Map<string, number>();
  for (const row of tokens) {
    for (const term of new Set(row)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const total = passages.length;
  const scored: { score: number; passage: Passage }[] = [];
  passages.forEach((passage, index) => {
    const row = tokens[index];
    if (!row.length) return;
    const frequency = new Map<string, number>();
    for (const term of row) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const seen = frequency.get(term) ?? 0;
      if (!seen) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log((total - df + 0.5) / (df + 0.5) + 1);
      const denominator = seen + K1 * (1 - B + (B * lengths[index]) / average);
      score += (idf * (seen * (K1 + 1))) / denominator;
    }
    if (score > 0) scored.push({ score, passage });
  });
  scored.sort((left, right) => right.score - left.score || left.passage.id.localeCompare(right.passage.id));
  return scored.slice(0, k).map((hit) => ({ ...hit.passage, score: Math.round(hit.score * 10000) / 10000 }));
}

export function extractiveAnswer(query: string, hits: Passage[], context = "") {
  if (!hits.length) {
    return "None of the bundled guidance notes share terms with that question. Try a report name such as LCTR, EFTR, STR, or terrorist property. This copilot only answers from those notes.";
  }
  const lines = [
    "This answer is extracted from Sentinel's own summaries of public FINTRAC guidance. It is not a filing decision and it is not a finding that money laundering occurred.",
    "",
  ];
  if (context.trim()) {
    lines.push(`Book context supplied with the question: ${context.trim()}`, "");
  }
  hits.forEach((hit, index) => {
    let snippet = hit.text.replace(/\s+/g, " ").trim();
    if (snippet.length > 420) snippet = `${snippet.slice(0, 417).replace(/\s+\S*$/, "")}…`;
    lines.push(`${index + 1}. ${hit.title} (${hit.id}, score ${hit.score})`);
    lines.push(snippet);
    lines.push(`Source: ${hit.source}`, "");
  });
  lines.push("A person still decides whether a report is filed.");
  return lines.join("\n").trim();
}

export function shortestPath(edges: { source: string; target: string }[], start: string, end: string) {
  if (start === end) return [start];
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target]);
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source]);
  }
  const seen = new Set([start]);
  const queue = [[start]];
  while (queue.length) {
    const path = queue.shift()!;
    for (const next of neighbours.get(path[path.length - 1]) ?? []) {
      if (seen.has(next)) continue;
      const extended = [...path, next];
      if (next === end) return extended;
      seen.add(next);
      queue.push(extended);
    }
  }
  return null;
}
