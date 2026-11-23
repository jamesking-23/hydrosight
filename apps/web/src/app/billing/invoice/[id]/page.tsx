import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { Shell } from "@/components/shell";
import { money, type InvoiceRow } from "@/lib/invoice-format";
import { loadAccess } from "@/lib/load-access";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const a = await loadAccess(`/billing/invoice/${id}`);
  const { data } = await a.supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound(); // RLS decides who can see it
  const i = data as unknown as InvoiceRow;
  const org = await a.supabase
    .from("organizations")
    .select("name")
    .eq("id", i.org_id)
    .maybeSingle();
  return (
    <Shell
      title={`Invoice ${i.number ?? "(draft)"}`}
      signedInAs={a.user.email ?? undefined}
    >
      <div className="mb-6 flex items-center gap-4 print:hidden">
        <Link href="/billing" className="text-ocean underline">
          Back to billing
        </Link>
        <PrintButton />
      </div>
      <p className="text-muted">
        {org.data?.name ?? "Organisation"} · {i.period_start} to {i.period_end}{" "}
        · status: {i.status}
        {i.status === "void" ? ` (${i.void_reason})` : ""}
      </p>
      <table className="mt-6 w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="py-2">Description</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l, n) => (
            <tr key={n} className="border-b border-line">
              <td className="py-2">{l.description}</td>
              <td className="text-right">{money(l.amount, i.currency)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2">Subtotal</td>
            <td className="text-right">{money(i.subtotal, i.currency)}</td>
          </tr>
          {Number(i.tax_amount) > 0 ? (
            <tr>
              <td className="py-2">{i.tax_label ?? "Tax"}</td>
              <td className="text-right">{money(i.tax_amount, i.currency)}</td>
            </tr>
          ) : null}
          <tr className="font-bold">
            <td className="py-2">Total</td>
            <td className="text-right">{money(i.total, i.currency)}</td>
          </tr>
        </tbody>
      </table>
      {i.due_at ? <p className="mt-4">Due {i.due_at}</p> : null}
      {i.status === "paid" ? (
        <p className="mt-2">
          Paid {i.paid_at?.slice(0, 10)} by {i.payment_method}, reference{" "}
          {i.payment_reference}.
        </p>
      ) : null}
      {i.notes ? (
        <p className="mt-4 max-w-[60ch] text-muted">{i.notes}</p>
      ) : null}
      <p className="mt-6 text-sm text-muted">
        Online payment is not available. Pay by arrangement with HydroSight and
        quote the invoice number.
      </p>
    </Shell>
  );
}
