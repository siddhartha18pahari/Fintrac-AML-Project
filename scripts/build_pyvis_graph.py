"""Build a self-contained PyVis entity graph for the investigator workspace.

Reads the knowledge graph already exported into ``web/src/data/snapshot.json``
(the same book the Next.js app renders) and writes one HTML file that inlines
vis-network. No API key and no CDN request at page view.

    python -m scripts.build_pyvis_graph
    python -m scripts.build_pyvis_graph --solver barnesHut

The default solver is vis.js ``forceAtlas2Based``. ``--solver barnesHut``
switches to the Barnes-Hut quadtree gravity model. Colour and size follow
residual risk. Nodes are grouped by entity type. Hover titles are HTML.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if __package__ in (None, ""):
    sys.path.insert(0, str(ROOT))

SNAPSHOT = ROOT / "web" / "src" / "data" / "snapshot.json"
OUT = ROOT / "web" / "public" / "graph" / "entity-graph.html"

RISK_STOPS = (
    (75, "#e06b76"),
    (50, "#e39a55"),
    (25, "#e2c48a"),
    (0, "#3dbea0"),
)
UNKNOWN = "#8aa399"

KIND_SIZE = {
    "customer": 26,
    "case": 18,
    "typology": 20,
    "rule": 14,
    "beneficiary": 16,
    "third_party": 15,
    "device": 12,
    "ip": 12,
    "alert": 9,
    "wallet": 8,
}


def risk_color(risk: int | None) -> str:
    if risk is None:
        return UNKNOWN
    for floor, color in RISK_STOPS:
        if risk >= floor:
            return color
    return UNKNOWN


def node_size(kind: str, risk: int | None) -> float:
    base = KIND_SIZE.get(kind, 11)
    return base + min(14, (risk or 0) / 8)


def tooltip(node: dict) -> str:
    kind = html.escape(str(node.get("kind") or "entity"))
    label = html.escape(str(node.get("label") or node["id"]))
    detail = html.escape(str(node.get("detail") or "No further detail on this node."))
    risk = node.get("risk")
    risk_text = "not scored" if risk is None else str(int(risk))
    record = html.escape(str(node.get("href") or ""))
    record_row = f'<div style="margin-top:6px;color:#9ad7c4">{record}</div>' if record else ""
    # Avoid the substring href: PyVis switches off the vis tooltip when a title contains it.
    blob = (
        f'<div style="max-width:260px;font-family:Inter,system-ui,sans-serif">'
        f'<div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#e2c48a">{kind}</div>'
        f'<div style="margin-top:2px;font-size:15px;font-weight:600;color:#f4f7f5">{label}</div>'
        f'<div style="margin-top:6px;font-size:12px;color:#d5e3dc">Risk {html.escape(risk_text)}</div>'
        f'<div style="margin-top:4px;font-size:12px;line-height:1.4;color:#b7c7bf">{detail}</div>'
        f"{record_row}</div>"
    )
    return blob.replace("href", "h-ref")


def load_graph(path: Path) -> tuple[dict, list[dict], list[dict]]:
    payload = json.loads(path.read_text())
    graph = payload.get("knowledge_graph") or {}
    nodes = list(graph.get("nodes") or [])
    edges = list(graph.get("edges") or [])
    if not nodes:
        raise SystemExit(f"No knowledge_graph.nodes in {path}")
    return graph, nodes, edges


def build(solver: str, snapshot: Path, out: Path) -> None:
    from pyvis.network import Network

    graph, nodes, edges = load_graph(snapshot)
    present = {node["id"] for node in nodes}
    net = Network(
        height="calc(100vh - 56px)",
        width="100%",
        bgcolor="#071410",
        font_color="#e7f0ec",
        directed=False,
        notebook=False,
        neighborhood_highlight=True,
        select_menu=False,
        filter_menu=False,
        cdn_resources="in_line",
        heading="",
    )
    if solver == "barnesHut":
        net.barnes_hut(
            gravity=-14000,
            central_gravity=0.22,
            spring_length=170,
            spring_strength=0.025,
            damping=0.42,
            overlap=0.45,
        )
    else:
        net.force_atlas_2based(
            gravity=-78,
            central_gravity=0.018,
            spring_length=145,
            spring_strength=0.055,
            damping=0.52,
            overlap=0.55,
        )

    for node in nodes:
        risk = node.get("risk")
        risk_value = int(risk) if isinstance(risk, (int, float)) else None
        kind = str(node.get("kind") or "entity")
        label = str(node.get("label") or node["id"])
        if len(label) > 28:
            label = f"{label[:24]}…"
        blob = f"{node.get('id', '')} {node.get('label', '')} {node.get('detail', '')}".lower()
        sanctioned = "sanction" in blob
        color = risk_color(risk_value)
        # Group styling drops an explicit colour in PyVis, so set colour after the node exists.
        net.add_node(
            node["id"],
            label=label,
            title=tooltip(node),
            size=node_size(kind, risk_value),
            borderWidth=3 if sanctioned else 1,
            mass=1.6 if kind == "customer" else 1,
        )
        stored = net.node_map[node["id"]]
        stored["group"] = kind
        stored["color"] = {
            "background": color,
            "border": "#e2c48a" if sanctioned else "#0c1612",
            "highlight": {"background": "#fff7e8", "border": "#e2c48a"},
        }
        stored["font"] = {
            "color": "#e7f0ec",
            "size": 13 if kind in {"customer", "typology", "case"} else 11,
            "face": "Inter, system-ui, sans-serif",
        }

    kept = 0
    for edge in edges:
        if edge["source"] not in present or edge["target"] not in present:
            continue
        relation = str(edge.get("relation") or "link")
        net.add_edge(
            edge["source"],
            edge["target"],
            title=html.escape(relation),
            color={"color": "rgba(167,214,196,0.32)", "highlight": "#e2c48a"},
            smooth={"type": "continuous"},
        )
        kept += 1

    out.parent.mkdir(parents=True, exist_ok=True)
    net.write_html(str(out), notebook=False, open_browser=False)
    seal(out, graph.get("disclaimer") or "", solver, len(nodes), kept)
    text = out.read_text()
    remote = re.findall(r"""(?:src|href)\s*=\s*["']https?://[^"']+["']|url\(\s*["']?https?://""", text)
    if remote:
        raise SystemExit(f"{out} still loads a remote asset: {remote[:3]}")
    print(f"Wrote {out} ({out.stat().st_size} bytes, {len(nodes)} nodes, {kept} edges, solver={solver})")


def seal(path: Path, disclaimer: str, solver: str, node_count: int, edge_count: int) -> None:
    text = path.read_text()
    text = re.sub(
        r'\s*<link\s+href="https://cdn\.jsdelivr\.net/npm/bootstrap[^>]*>\s*',
        "\n",
        text,
    )
    text = re.sub(
        r'\s*<script\s+src="https://cdn\.jsdelivr\.net/npm/bootstrap[\s\S]*?</script>\s*',
        "\n",
        text,
    )
    text = re.sub(r"<center>\s*<h1>\s*</h1>\s*</center>", "", text)
    solver_label = "forceAtlas2Based" if solver == "forceAtlas2Based" else "barnesHut"
    bar = f"""
<style id="sentinel-graph">
  html, body {{ margin: 0; height: 100%; background: #071410; color: #e7f0ec; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }}
  #sentinel-bar {{
    display: flex; gap: 16px; align-items: center; justify-content: space-between;
    min-height: 56px; padding: 8px 16px; box-sizing: border-box;
    border-bottom: 1px solid rgba(226, 196, 138, 0.28);
    background: linear-gradient(90deg, rgba(18, 40, 34, 0.96), rgba(7, 20, 16, 0.92));
  }}
  #sentinel-bar strong {{ font-weight: 600; letter-spacing: -0.03em; }}
  #sentinel-bar p {{ margin: 2px 0 0; color: #b7c7bf; font-size: 12px; line-height: 1.35; }}
  .legend {{ display: flex; flex-wrap: wrap; gap: 8px 12px; font-size: 11px; color: #d5e3dc; }}
  .swatch {{ display: inline-block; width: 8px; height: 8px; border-radius: 99px; margin-right: 5px; vertical-align: middle; }}
  .card {{ background: transparent !important; border: 0 !important; width: 100% !important; }}
  #mynetwork {{
    width: 100% !important; height: calc(100vh - 56px) !important;
    background: #071410 !important; border: 0 !important; float: none !important;
  }}
  #loadingBar {{ background-color: rgba(7, 20, 16, 0.88) !important; }}
  #text {{ color: #e7f0ec !important; }}
  .vis-tooltip {{
    background: #12201c !important; color: #e7f0ec !important;
    border: 1px solid rgba(226, 196, 138, 0.4) !important;
    border-radius: 12px !important; padding: 8px 10px !important;
  }}
</style>
"""
    header = f"""
<div id="sentinel-bar">
  <div>
    <strong>Entity graph</strong>
    <p>{html.escape(disclaimer)} {node_count} nodes, {edge_count} edges. Physics: {solver_label}. Grouped by entity type. Click a node to light its neighbours.</p>
  </div>
  <div class="legend" aria-label="Risk legend">
    <span><i class="swatch" style="background:#3dbea0"></i>Under 25</span>
    <span><i class="swatch" style="background:#e2c48a"></i>25–49</span>
    <span><i class="swatch" style="background:#e39a55"></i>50–74</span>
    <span><i class="swatch" style="background:#e06b76"></i>75 and above</span>
  </div>
</div>
"""
    text = text.replace("</head>", bar + "\n</head>", 1)
    text = text.replace("<body>", "<body>\n" + header, 1)
    path.write_text(text)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the PyVis entity graph.")
    parser.add_argument("--solver", choices=("forceAtlas2Based", "barnesHut"), default="forceAtlas2Based")
    parser.add_argument("--snapshot", type=Path, default=SNAPSHOT)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    build(args.solver, args.snapshot, args.out)


if __name__ == "__main__":
    main()
