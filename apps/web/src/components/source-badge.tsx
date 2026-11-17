import { t, type Locale, type MessageKey } from "@/lib/i18n";

/** Rule 2: every value shown carries exactly one of these source types. */
export const SOURCE_TYPES = ["measured", "estimated", "forecast", "community", "synthetic"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const STYLES: Record<SourceType, string> = {
  measured: "border-src-measured text-src-measured",
  estimated: "border-src-estimated text-src-estimated",
  forecast: "border-src-forecast text-src-forecast",
  community: "border-src-community text-src-community",
  synthetic: "border-src-synthetic text-src-synthetic",
};

export function SourceBadge({ source, locale = "en" }: { source: SourceType; locale?: Locale }) {
  const label = t(locale, `source.${source}` as MessageKey);
  return (
    <span
      data-source-type={source}
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide ${STYLES[source]}`}
    >
      {label}
    </span>
  );
}
