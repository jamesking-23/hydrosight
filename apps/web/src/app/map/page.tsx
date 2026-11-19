import { Shell } from "@/components/shell";
import { StationMapLoader } from "@/components/station-map-loader";
import { ErrorNote } from "@/components/ui";
import { loadAccess } from "@/lib/load-access";
import type { StationRow } from "@/lib/stations";

export default async function MapPage() {
  const a = await loadAccess("/map");
  const s = a.supabase;
  const [st, rv, ca, im] = await Promise.all([
    s.from("stations_geo").select("*").order("name"),
    s.from("rivers_geo").select("id, name, geojson"),
    s.from("catchments_geo").select("id, name, geojson"),
    s.from("geo_imports").select("kind, source, licence, source_type"),
  ]);
  const errors = [a.loadError, st.error, rv.error, ca.error, im.error]
    .filter(Boolean)
    .map((e) => e!.message)
    .join("; ");
  const stations = (st.data ?? []) as StationRow[];
  const allSynthetic = stations.length > 0 && stations.every((x) => x.source_type === "synthetic");

  return (
    <Shell title="Map" signedInAs={a.user.email ?? undefined} wide>
      <ErrorNote>{errors ? `Some data could not be loaded: ${errors}` : ""}</ErrorNote>
      {allSynthetic ? (
        <p role="status" className="mb-5 rounded-md border border-src-synthetic/40 bg-src-synthetic/5 p-3 text-sm">
          All stations shown are <strong>synthetic demo</strong> stations placed by hand near named
          rivers. They are not real monitoring equipment and have no readings.
        </p>
      ) : null}
      <StationMapLoader
        stations={stations}
        rivers={(rv.data ?? []) as never}
        catchments={(ca.data ?? []) as never}
        imports={im.data ?? []}
      />
    </Shell>
  );
}
