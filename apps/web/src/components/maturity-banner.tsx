import { t, type Locale, type MessageKey } from "@/lib/i18n";

export type ServiceStatus = "prototype" | "validated" | "operational";

/**
 * Rule 4: everything starts as `prototype`. Only an authorised human admin, with an
 * evidence link, may change a model's or location's status. This component only displays it.
 */
export function MaturityBanner({
  status = "prototype",
  locale = "en",
}: {
  status?: ServiceStatus;
  locale?: Locale;
}) {
  return (
    <div
      role="status"
      data-service-status={status}
      className="w-full border-b border-src-estimated bg-surface-raised px-4 py-2 text-center text-sm font-semibold"
    >
      {t(locale, `maturity.${status}` as MessageKey)}
    </div>
  );
}
