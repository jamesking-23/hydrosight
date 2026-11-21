export interface AssetForm {
  name: string;
  kind: string;
  mode: "point" | "polygon";
  lat: string;
  lon: string;
  geojson: string;
  elevation: string;
  elevationSource: string;
  valueAmount: string;
  valueCurrency: string;
  valueBasis: string;
  notes: string;
}

export const ASSET_KINDS = [
  "building",
  "road",
  "bridge",
  "school",
  "health_facility",
  "farmland",
  "utility",
  "water_supply",
  "other",
] as const;

type Out =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

/** Validates the form and shapes the add_asset RPC arguments. The database re-checks everything. */
export function assetArgs(orgId: string, f: AssetForm): Out {
  if (f.name.trim().length < 2)
    return { ok: false, error: "Enter a name for the asset." };
  let geo: unknown;
  if (f.mode === "point") {
    const lat = Number(f.lat);
    const lon = Number(f.lon);
    if (
      f.lat.trim() === "" ||
      f.lon.trim() === "" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    )
      return { ok: false, error: "Enter latitude and longitude as numbers." };
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180)
      return {
        ok: false,
        error: "Latitude must be -90 to 90 and longitude -180 to 180.",
      };
    geo = { type: "Point", coordinates: [lon, lat] };
  } else {
    try {
      geo = JSON.parse(f.geojson);
    } catch {
      return { ok: false, error: "The outline is not valid GeoJSON." };
    }
  }
  const hasElev = f.elevation.trim() !== "";
  if (hasElev) {
    if (!Number.isFinite(Number(f.elevation)))
      return { ok: false, error: "Elevation must be a number in metres." };
    if (f.elevationSource !== "measured" && f.elevationSource !== "estimated")
      return {
        ok: false,
        error:
          "Say whether the elevation was measured (surveyed) or estimated.",
      };
  }
  const hasValue = f.valueAmount.trim() !== "";
  if (hasValue) {
    const amt = Number(f.valueAmount);
    if (!Number.isFinite(amt) || amt < 0)
      return { ok: false, error: "Value must be a number, zero or more." };
    if (!/^[A-Za-z]{3}$/.test(f.valueCurrency.trim()))
      return { ok: false, error: "Use a 3-letter currency code such as UGX." };
    if (f.valueBasis.trim().length < 10)
      return {
        ok: false,
        error:
          "Say how the value was set (at least 10 characters), for example 'insurance valuation 2026'.",
      };
  }
  return {
    ok: true,
    args: {
      p_org: orgId,
      p_name: f.name.trim(),
      p_kind: f.kind,
      p_geojson: JSON.stringify(geo),
      p_elevation_m: hasElev ? Number(f.elevation) : null,
      p_elevation_source: hasElev ? f.elevationSource : null,
      p_value_amount: hasValue ? Number(f.valueAmount) : null,
      p_value_currency: hasValue ? f.valueCurrency.trim().toUpperCase() : null,
      p_value_basis: hasValue ? f.valueBasis.trim() : null,
      p_notes: f.notes.trim() || null,
      p_source_type: "estimated",
    },
  };
}
