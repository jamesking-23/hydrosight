"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ASSET_KINDS, assetArgs, type AssetForm } from "@/lib/asset-input";
import { createClient } from "@/lib/supabase/browser";
import { Button, ErrorNote, Field, inputCls } from "./ui";

const EMPTY: AssetForm = {
  name: "",
  kind: "building",
  mode: "point",
  lat: "",
  lon: "",
  geojson: "",
  elevation: "",
  elevationSource: "",
  valueAmount: "",
  valueCurrency: "UGX",
  valueBasis: "",
  notes: "",
};

export function AssetFormView({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [f, setF] = useState<AssetForm>(EMPTY);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof AssetForm) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const r = assetArgs(orgId, f);
    if (!r.ok) return setError(r.error);
    setBusy(true);
    const { error: err } = await createClient().rpc(
      "add_asset",
      r.args as never,
    );
    setBusy(false);
    if (err) return setError(err.message);
    setF(EMPTY);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <ErrorNote>{error}</ErrorNote>
      </div>
      <Field label="Name" value={f.name} onChange={set("name")} required />
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Type</span>
        <select value={f.kind} onChange={set("kind")} className={inputCls}>
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-sm font-semibold">Location is a</span>
        <select value={f.mode} onChange={set("mode")} className={inputCls}>
          <option value="point">Point (latitude and longitude)</option>
          <option value="polygon">Outline (GeoJSON polygon)</option>
        </select>
      </label>
      {f.mode === "point" ? (
        <>
          <Field
            label="Latitude"
            inputMode="decimal"
            value={f.lat}
            onChange={set("lat")}
          />
          <Field
            label="Longitude"
            inputMode="decimal"
            value={f.lon}
            onChange={set("lon")}
          />
        </>
      ) : (
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-semibold">
            GeoJSON Polygon or MultiPolygon (longitude, latitude)
          </span>
          <textarea
            value={f.geojson}
            onChange={set("geojson")}
            rows={4}
            className={inputCls}
          />
        </label>
      )}
      <Field
        label="Elevation in metres (optional)"
        inputMode="decimal"
        value={f.elevation}
        onChange={set("elevation")}
      />
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Elevation was</span>
        <select
          value={f.elevationSource}
          onChange={set("elevationSource")}
          className={inputCls}
        >
          <option value="">Not given</option>
          <option value="measured">Measured (surveyed)</option>
          <option value="estimated">Estimated</option>
        </select>
      </label>
      <Field
        label="Value (optional)"
        inputMode="decimal"
        value={f.valueAmount}
        onChange={set("valueAmount")}
      />
      <Field
        label="Currency"
        value={f.valueCurrency}
        onChange={set("valueCurrency")}
        maxLength={3}
      />
      <div className="sm:col-span-2">
        <Field
          label="How the value was set (required with a value)"
          value={f.valueBasis}
          onChange={set("valueBasis")}
        />
      </div>
      <div className="sm:col-span-2">
        <Field
          label="Notes (optional)"
          value={f.notes}
          onChange={set("notes")}
        />
      </div>
      <div className="sm:col-span-2">
        <Button disabled={busy}>{busy ? "Saving…" : "Register asset"}</Button>
        <p className="mt-2 text-xs text-muted">
          The asset is saved as unvalidated. Value is stated as supplied;
          HydroSight does not estimate loss.
        </p>
      </div>
    </form>
  );
}
