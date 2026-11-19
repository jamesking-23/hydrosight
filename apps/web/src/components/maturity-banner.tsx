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
      className="w-full border-b border-[#e8d48a] bg-[#fff6d6] px-4 py-1.5 text-center text-sm font-semibold text-[#5c4a05]"
    >
      {t(locale, `maturity.${status}` as MessageKey)}
    </div>
  );
}
