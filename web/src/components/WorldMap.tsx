"use client";

import { geoCentroid } from "d3-geo";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ComposableMap, Geographies, Geography, Graticule, Line, Marker, Sphere, ZoomableGroup } from "react-simple-maps";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { FATF_AS_OF, ISO_NUMERIC, fatfStatus, padNumericId, type FatfStatus } from "@/lib/fatf";
import { money } from "@/lib/format";

export type MapCountry = {
  code: string;
  name: string;
  transactions: number;
  cad: number;
  incoming_cad: number;
  outgoing_cad: number;
  high_risk_jurisdiction: boolean;
};

type Atlas = Topology<{ countries: GeometryCollection }>;
type Tip = {
  name: string;
  x: number;
  y: number;
  fatf: FatfStatus;
  country?: MapCountry;
};

const HOME = "124";

function mix(from: string, to: string, t: number) {
  const parse = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const left = parse(from);
  const right = parse(to);
  const channel = left.map((value, index) => Math.round(value + (right[index] - value) * t));
  return `rgb(${channel.join(",")})`;
}

function exposureFill(cad: number, maxCad: number) {
  const t = maxCad > 0 ? Math.log1p(cad) / Math.log1p(maxCad) : 0;
  return mix("#16382f", "#8ef0d2", Math.min(1, Math.max(0.15, t)));
}

export function WorldMap({ countries }: { countries: MapCountry[] }) {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [failed, setFailed] = useState(false);
  const [center, setCenter] = useState<[number, number]>([8, 12]);
  const [zoom, setZoom] = useState(1);
  const [tip, setTip] = useState<Tip | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/geo/countries-50m.json")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((payload: Atlas) => {
        if (!cancel) setAtlas(payload);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const collection = useMemo(() => {
    if (!atlas?.objects?.countries) return null;
    return feature(atlas, atlas.objects.countries);
  }, [atlas]);

  const centroids = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const geo of collection?.features ?? []) {
      const point = geoCentroid(geo);
      if (Number.isFinite(point[0]) && Number.isFinite(point[1])) map.set(padNumericId(geo.id), [point[0], point[1]]);
    }
    return map;
  }, [collection]);

  const byNumeric = useMemo(() => {
    const map = new Map<string, MapCountry>();
    for (const country of countries) {
      const id = ISO_NUMERIC[country.code];
      if (id) map.set(id, country);
    }
    return map;
  }, [countries]);

  const maxCad = Math.max(...countries.map((country) => country.cad), 1);
  const home = centroids.get(HOME);

  const flows = countries.flatMap((country) => {
    const id = ISO_NUMERIC[country.code];
    const there = id ? centroids.get(id) : undefined;
    if (!home || !there) return [];
    const arcs: { key: string; from: [number, number]; to: [number, number]; outbound: boolean; cad: number }[] = [];
    if (country.outgoing_cad > 0) {
      arcs.push({ key: `out-${country.code}`, from: home, to: there, outbound: true, cad: country.outgoing_cad });
    }
    if (country.incoming_cad > 0) {
      arcs.push({ key: `in-${country.code}`, from: there, to: home, outbound: false, cad: country.incoming_cad });
    }
    return arcs;
  });

  function flyTo(code: string) {
    const id = ISO_NUMERIC[code];
    const point = id ? centroids.get(id) : undefined;
    if (!point) return;
    setPinned(code);
    setCenter(point);
    setZoom(3.5);
  }

  function fillFor(id: string) {
    const book = byNumeric.get(id);
    const fatf = fatfStatus(id);
    if (id === HOME) return "#1f6a5c";
    if (book && fatf === "call-for-action") return "#e07a86";
    if (fatf === "call-for-action") return "#7a3038";
    if (book && fatf === "increased-monitoring") return "#e2b15a";
    if (fatf === "increased-monitoring") return "#6e5428";
    if (book) return exposureFill(book.cad, maxCad);
    return "#1a2e28";
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#071410] text-[#e7f0ec] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_240px_at_20%_0%,rgba(61,190,160,0.18),transparent_60%),radial-gradient(500px_220px_at_90%_100%,rgba(226,196,138,0.12),transparent_55%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e2c48a]">World atlas</p>
            <h2 className="font-display text-2xl tracking-tight text-white">Flows and jurisdiction risk</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-full border border-white/15 px-3 py-1 text-sm text-white hover:bg-white/10" onClick={() => setZoom((value) => Math.min(8, value * 1.35))} aria-label="Zoom in">+</button>
            <button type="button" className="rounded-full border border-white/15 px-3 py-1 text-sm text-white hover:bg-white/10" onClick={() => setZoom((value) => Math.max(1, value / 1.35))} aria-label="Zoom out">−</button>
            <button type="button" className="rounded-full border border-white/15 px-3 py-1 text-sm text-white hover:bg-white/10" onClick={() => { setCenter([8, 12]); setZoom(1); setPinned(null); }}>Reset</button>
          </div>
        </div>
        <div ref={stage} className="relative h-[620px]" onMouseLeave={() => { setTip(null); setHoverId(null); }}>
          {!collection && !failed ? (
            <div className="flex h-full flex-col justify-end p-6">
              <div className="shimmer h-3 w-40 rounded bg-white/10" />
              <p className="mt-3 text-sm text-[#b7c7bf]">Loading the bundled world atlas.</p>
            </div>
          ) : null}
          {failed ? (
            <p className="p-6 text-sm text-[#f0b4bc]">The world atlas file did not load from this deployment.</p>
          ) : null}
          {collection ? (
            <ComposableMap
              width={900}
              height={520}
              projection="geoNaturalEarth1"
              projectionConfig={{ scale: 168, rotate: [-12, 0, 0] }}
              className="h-full w-full"
              role="img"
              aria-label="World map of counterparty flows and FATF jurisdiction lists"
            >
              <ZoomableGroup
                center={center}
                zoom={zoom}
                minZoom={1}
                maxZoom={8}
                onMoveEnd={(position) => {
                  if (position.coordinates) setCenter(position.coordinates);
                  if (typeof position.zoom === "number") setZoom(position.zoom);
                }}
              >
                <Sphere fill="#0c1915" stroke="#1d3a32" strokeWidth={0.4} />
                <Graticule stroke="rgba(214,232,224,0.08)" step={[20, 20]} />
                <Geographies geography={collection}>
                  {({ geographies }) =>
                    geographies.map((geo) => {
                      const id = padNumericId(geo.id);
                      const book = byNumeric.get(id);
                      const fatf = fatfStatus(id);
                      const name = String((geo.properties as { name?: string } | null)?.name ?? id);
                      const active = hoverId === id || pinned === book?.code;
                      const placeTip = (event: MouseEvent<SVGPathElement>) => {
                        const box = stage.current?.getBoundingClientRect();
                        if (!box) return;
                        setHoverId(id);
                        setTip({
                          name,
                          x: event.clientX - box.left + 14,
                          y: event.clientY - box.top + 14,
                          fatf,
                          country: book,
                        });
                      };
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          aria-label={name}
                          fill={fillFor(id)}
                          stroke={active ? "#f6e7c3" : book ? "#d5ece4" : "#0d1c18"}
                          strokeWidth={active ? 1.1 : 0.4}
                          onMouseEnter={placeTip}
                          onMouseMove={placeTip}
                          onClick={() => {
                            if (book) flyTo(book.code);
                            else {
                              const point = centroids.get(id);
                              if (point) {
                                setCenter(point);
                                setZoom(3.2);
                                setPinned(null);
                              }
                            }
                          }}
                          style={{ outline: "none", cursor: "pointer" }}
                        />
                      );
                    })
                  }
                </Geographies>
                {flows.map((flow) => (
                  <Line
                    key={flow.key}
                    from={flow.from}
                    to={flow.to}
                    coordinates={bend(flow.from, flow.to, flow.outbound ? 7 : -7)}
                    stroke={flow.outbound ? "#8ef0d2" : "#e2c48a"}
                    strokeWidth={1.1 + Math.min(2.4, Math.log10(flow.cad + 10) / 2)}
                    fill="none"
                    className={flow.outbound ? "flow-arc" : "flow-arc flow-in"}
                    strokeLinecap="round"
                    style={{ pointerEvents: "none" }}
                  />
                ))}
                {home ? (
                  <Marker coordinates={home}>
                    <circle r={7} fill="#8ef0d2" opacity={0.25} className="map-pulse" />
                    <circle r={3.2} fill="#e7f6f1" stroke="#071410" strokeWidth={0.6} />
                  </Marker>
                ) : null}
                {countries.map((country) => {
                  const id = ISO_NUMERIC[country.code];
                  const point = id ? centroids.get(id) : undefined;
                  if (!point) return null;
                  return (
                    <Marker key={country.code} coordinates={point}>
                      <circle r={3} fill={country.high_risk_jurisdiction ? "#e07a86" : "#f4f7f5"} stroke="#071410" strokeWidth={0.5} />
                    </Marker>
                  );
                })}
              </ZoomableGroup>
            </ComposableMap>
          ) : null}
          {tip ? (
            <div
              className="pointer-events-none absolute z-10 w-60 rounded-2xl border border-white/15 bg-[#10211c]/95 p-3 text-sm shadow-2xl backdrop-blur"
              style={{ left: Math.min(tip.x, 520), top: Math.min(tip.y, 460) }}
              role="status"
            >
              <p className="font-semibold text-white">{tip.name}</p>
              <p className="mt-1 text-xs text-[#d5e3dc]">
                {tip.fatf === "call-for-action"
                  ? `FATF call for action · ${FATF_AS_OF}`
                  : tip.fatf === "increased-monitoring"
                    ? `FATF increased monitoring · ${FATF_AS_OF}`
                    : "Not on the bundled FATF lists"}
              </p>
              {tip.country ? (
                <p className="mt-2 text-xs leading-relaxed text-[#b7c7bf]">
                  {tip.country.transactions} transactions · {money(tip.country.cad)}
                  <br />
                  In {money(tip.country.incoming_cad)} · out {money(tip.country.outgoing_cad)}
                  {tip.country.high_risk_jurisdiction ? " · placeholder higher-risk list" : ""}
                </p>
              ) : (
                <p className="mt-2 text-xs text-[#b7c7bf]">No counterparty exposure in this book.</p>
              )}
            </div>
          ) : null}
        </div>
        <ul className="relative flex flex-wrap gap-x-4 gap-y-2 border-t border-white/10 px-4 py-3 text-xs text-[#d5e3dc]" aria-label="Map legend">
          <li><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#1f6a5c]" /> Canada, the book</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#8ef0d2]" /> Counterparty exposure</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#7a3038]" /> FATF call for action</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#6e5428]" /> FATF increased monitoring</li>
          <li><i className="mr-1 inline-block h-2 w-6 border-t-2 border-dashed border-[#8ef0d2]" /> Outflow</li>
          <li><i className="mr-1 inline-block h-2 w-6 border-t-2 border-dashed border-[#e2c48a]" /> Inflow</li>
        </ul>
        <p className="relative px-4 pb-4 text-xs leading-relaxed text-[#8eaa9f]">
          Scroll to zoom and drag to pan. Arcs use country centroids from the bundled Natural Earth atlas (world-atlas countries-50m). FATF colours follow the {FATF_AS_OF} public lists, stored in the repo. They are not a live feed and not a sanctions designation.
        </p>
      </div>
      <aside className="panel glass p-5">
        <h2 className="font-display text-2xl text-spruce">On the wire</h2>
        <p className="mt-1 text-sm text-muted">Click a country to centre the map. Amounts are the Canadian-dollar value recorded against that counterparty.</p>
        {countries.length === 0 ? (
          <p className="mt-6 text-sm text-muted">No foreign counterparty country was recorded. The atlas still shows the FATF lists.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {countries.map((country) => (
              <li key={country.code}>
                <button type="button" onClick={() => flyTo(country.code)} className="flex w-full items-start justify-between gap-3 py-3 text-left hover:text-brass">
                  <span>
                    <span className="block font-semibold">{country.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {country.code} · {country.transactions} transactions
                      {country.high_risk_jurisdiction ? " · placeholder higher-risk" : ""}
                      {fatfStatus(ISO_NUMERIC[country.code] ?? "") === "call-for-action" ? " · FATF call for action" : ""}
                    </span>
                  </span>
                  <span className="num text-sm">{money(country.cad)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function bend(from: [number, number], to: [number, number], amount: number): [number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return [
    from,
    [(from[0] + to[0]) / 2 + (-dy / length) * amount, (from[1] + to[1]) / 2 + (dx / length) * amount],
    to,
  ];
}
