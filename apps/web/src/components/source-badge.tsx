import { t, type Locale, type MessageKey } from "@/lib/i18n";

/** Rule 2: every value shown carries exactly one of these source types. */
export const SOURCE_TYPES = ["measured", "estimated", "forecast", "community", "synthetic"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const STYLES: Record<SourceType, string> = {
  measured: "border-src-measured/40 bg-src-measured/10 text-src-measured",
  estimated: "border-src-estimated/40 bg-src-estimated/10 text-src-estimated",
  forecast: "border-src-forecast/40 bg-src-forecast/10 text-src-forecast",
  community: "border-src-community/40 bg-src-community/10 text-src-community",
  synthetic: "border-src-synthetic/40 bg-src-synthetic/10 text-src-synthetic",
};

export function SourceBadge({ source, locale = "en" }: { source: SourceType; locale?: Locale }) {
  const label = t(locale, `source.${source}` as MessageKey);
  return (
    <span
      data-source-type={source}
      className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold ${STYLES[source]}`}
    >
      {label}
    </span>
  );
}
