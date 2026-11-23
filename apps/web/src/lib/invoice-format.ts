export interface InvoiceLine {
  description: string;
  quantity?: number;
  amount: number;
}
export interface InvoiceRow {
  id: string;
  org_id: string;
  number: string | null;
  status: "draft" | "issued" | "paid" | "void";
  period_start: string;
  period_end: string;
  currency: string;
  lines: InvoiceLine[];
  subtotal: string | number;
  tax_amount: string | number;
  tax_label: string | null;
  total: string | number;
  notes: string | null;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  void_reason: string | null;
}

/** Display only: amounts are stored and typed in by the owner, never calculated here. */
export function money(amount: string | number, currency: string): string {
  const n = Number(amount);
  return `${currency} ${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parses the invoice-lines textarea: one line per row, "description | amount". */
export function parseLines(
  text: string,
): { ok: true; lines: InvoiceLine[] } | { ok: false; error: string } {
  const rows = text
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  if (rows.length === 0)
    return { ok: false, error: "Add at least one invoice line." };
  const lines: InvoiceLine[] = [];
  for (const [i, r] of rows.entries()) {
    const at = r.lastIndexOf("|");
    const description = at < 0 ? "" : r.slice(0, at).trim();
    const raw =
      at < 0
        ? ""
        : r
            .slice(at + 1)
            .trim()
            .replace(/,/g, "");
    const amount = Number(raw);
    if (!description || raw === "" || !Number.isFinite(amount) || amount < 0)
      return {
        ok: false,
        error: `Line ${i + 1}: write it as "description | amount" with a non-negative amount.`,
      };
    lines.push({ description, amount });
  }
  return { ok: true, lines };
}
