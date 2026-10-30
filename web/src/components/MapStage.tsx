"use client";

import { useState } from "react";
import { GlobeSlot } from "@/components/globe/GlobeSlot";
import { WorldMap, type MapCountry } from "@/components/WorldMap";
import type { GlobeCountry } from "@/components/globe/coords";

export function MapStage({ countries }: { countries: MapCountry[] }) {
  const [mode, setMode] = useState<"atlas" | "globe">("atlas");
  const globeCountries: GlobeCountry[] = countries.map((country) => ({
    code: country.code,
    name: country.name,
    incoming_cad: country.incoming_cad,
    outgoing_cad: country.outgoing_cad,
  }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Map presentation" className="inline-flex rounded-full border border-line bg-card/80 p-1">
          {(
            [
              ["atlas", "Atlas"],
              ["globe", "3D globe"],
            ] as const
          ).map(([value, label]) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                id={`map-tab-${value}`}
                aria-selected={selected}
                aria-controls={`map-panel-${value}`}
                onClick={() => setMode(value)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${selected ? "bg-spruce text-white shadow-[0_0_18px_rgba(226,196,138,0.35)]" : "text-muted"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted">{mode === "globe" ? "Drag to orbit. Gold leaves Canada, mint arrives." : "Scroll to zoom the atlas. Arcs animate between Canada and each counterparty."}</p>
      </div>
      <div id="map-panel-atlas" role="tabpanel" aria-labelledby="map-tab-atlas" hidden={mode !== "atlas"}>
        {mode === "atlas" ? <WorldMap countries={countries} /> : null}
      </div>
      <div id="map-panel-globe" role="tabpanel" aria-labelledby="map-tab-globe" hidden={mode !== "globe"}>
        {mode === "globe" ? (
          <div className="relative h-[min(72vh,680px)] overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#071410]">
            <GlobeSlot countries={globeCountries} variant="stage" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
