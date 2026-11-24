"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  GhostButton,
  inputCls,
} from "@/components/ui";
import { FEATURE_LABEL, type FeatureKey } from "@/lib/entitlements";
import { money, parseLines, type InvoiceRow } from "@/lib/invoice-format";
import { createClient } from "@/lib/supabase/browser";

type R = Record<string, unknown>;
interface Props {
  loadError: string | null;
  demos: R[];
  plans: R[];
  limits: R[];
  features: R[];
  orgs: { id: string; name: string }[];
  orgPlans: R[];
  invoices: R[];
}
const FEATURES = Object.keys(FEATURE_LABEL) as FeatureKey[];

export function PlatformAdmin(p: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function rpc(name: string, args: Record<string, unknown>, ok: string) {
    setErr(null);
    setMsg(null);
    const { error } = await createClient().rpc(name, args);
    if (error) setErr(error.message);
    else {
      setMsg(ok);
      router.refresh();
    }
  }
  const orgName = (id: string) => p.orgs.find((o) => o.id === id)?.name ?? id;

  return (
    <>
      <ErrorNote>{p.loadError ?? err}</ErrorNote>
      {msg ? (
        <p
          role="status"
          className="mb-4 rounded-md border border-leaf/50 bg-leaf/5 p-3 text-sm"
        >
          {msg}
        </p>
      ) : null}

      <Card title={`Demo requests (${p.demos.length})`}>
        <p className="mb-3 text-sm text-muted">
          No email is sent when a request arrives (no email provider is
          verified), so check here.
        </p>
        {p.demos.length === 0 ? (
          <p className="text-muted">No requests yet.</p>
        ) : null}
        <ul className="space-y-4">
          {p.demos.map((d) => (
            <li
              key={d.id as string}
              className="rounded-md border border-line p-4"
            >
              <p className="font-semibold">
                {d.name as string} · {d.organisation as string}
              </p>
              <p className="text-sm">
                <a
                  className="text-ocean underline"
                  href={`mailto:${d.email as string}`}
                >
                  {d.email as string}
                </a>
                {d.role_title ? ` · ${d.role_title as string}` : ""}
                {d.country ? ` · ${d.country as string}` : ""}
              </p>
              {d.interest ? (
                <p className="mt-1 text-sm">Interest: {d.interest as string}</p>
              ) : null}
              {d.message ? (
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {d.message as string}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted">
                {new Date(d.created_at as string).toLocaleString("en-GB")} ·
                consent {d.consent_version as string}
              </p>
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void rpc(
                    "update_demo_request",
                    {
                      p_id: d.id,
                      p_status: f.get("status"),
                      p_notes: f.get("notes") || null,
                    },
                    "Request updated.",
                  );
                }}
              >
                <select
                  name="status"
                  defaultValue={d.status as string}
                  className={inputCls + " !w-auto"}
                >
                  {["new", "contacted", "qualified", "closed"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <input
                  name="notes"
                  defaultValue={(d.notes as string) ?? ""}
                  placeholder="Notes"
                  className={inputCls + " max-w-sm"}
                />
                <GhostButton type="submit">Save</GhostButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Plans">
        <p className="mb-3 text-sm text-muted">
          Nothing is invented: a plan has no price unless you enter one with a
          written basis. A limit left blank means none allowed; type
          &quot;unlimited&quot; to allow any number. Plans are hidden from the
          public site until published.
        </p>
        {p.plans.map((pl) => (
          <p key={pl.key as string} className="text-sm">
            <strong>{pl.name as string}</strong> ({pl.key as string}) ·{" "}
            {pl.published ? "published" : "unpublished"}
          </p>
        ))}
        <PlanForm
          onSave={(args) => rpc("save_plan", args, "Plan saved.")}
          setErr={setErr}
        />
      </Card>

      <Card title="Assign a plan to an organisation">
        <ul className="mb-3 text-sm">
          {p.orgPlans.map((o) => (
            <li key={o.org_id as string}>
              {orgName(o.org_id as string)}: {o.plan_key as string} (
              {o.status as string})
            </li>
          ))}
          {p.orgPlans.length === 0 ? (
            <li className="text-muted">
              No organisation has a plan. Unassigned organisations are not
              limited.
            </li>
          ) : null}
        </ul>
        <form
          className="grid max-w-xl gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ends = String(f.get("ends") || "");
            void rpc(
              "assign_plan",
              {
                p_org: f.get("org"),
                p_plan: f.get("plan"),
                p_status: f.get("status"),
                p_ends_at: ends ? new Date(ends).toISOString() : null,
                p_note: f.get("note") || null,
              },
              "Plan assigned.",
            );
          }}
        >
          <select name="org" required className={inputCls}>
            {p.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select name="plan" required className={inputCls}>
            {p.plans.map((pl) => (
              <option key={pl.key as string} value={pl.key as string}>
                {pl.name as string}
              </option>
            ))}
          </select>
          <select name="status" className={inputCls}>
            {["trial", "active", "suspended", "ended"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Field label="Ends on (optional)" name="ends" type="date" />
          <Field label="Note" name="note" />
          <Button type="submit">Assign plan</Button>
        </form>
      </Card>

      <Card title="Invoices">
        <p className="mb-3 text-sm text-muted">
          You type the amounts; HydroSight calculates no price or tax. An issued
          invoice cannot be edited, only voided. Marking paid needs a method and
          a reference. No payment provider is connected.
        </p>
        <InvoiceForm
          orgs={p.orgs}
          onCreate={(args) =>
            rpc("create_invoice_draft", args, "Draft invoice created.")
          }
          setErr={setErr}
        />
        <ul className="mt-6 space-y-3">
          {(p.invoices as unknown as InvoiceRow[]).map((i) => (
            <li
              key={i.id}
              className="rounded-md border border-line p-3 text-sm"
            >
              <p className="font-semibold">
                {i.number ?? "Draft"} · {orgName(i.org_id)} ·{" "}
                {money(i.total, i.currency)} · {i.status}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {i.status === "draft" ? (
                  <GhostButton
                    onClick={() =>
                      rpc("issue_invoice", { p_id: i.id }, "Invoice issued.")
                    }
                  >
                    Issue
                  </GhostButton>
                ) : null}
                {i.status === "issued" ? (
                  <GhostButton
                    onClick={() => {
                      const method = window.prompt(
                        "Payment method (for example: bank transfer, mobile money)",
                      );
                      const ref = method
                        ? window.prompt(
                            "Payment reference from the payer or bank",
                          )
                        : null;
                      if (method && ref)
                        void rpc(
                          "mark_invoice_paid",
                          { p_id: i.id, p_method: method, p_reference: ref },
                          "Marked paid.",
                        );
                    }}
                  >
                    Mark paid
                  </GhostButton>
                ) : null}
                {i.status === "draft" || i.status === "issued" ? (
                  <GhostButton
                    onClick={() => {
                      const reason = window.prompt(
                        "Why is this invoice void? (at least 5 characters)",
                      );
                      if (reason)
                        void rpc(
                          "void_invoice",
                          { p_id: i.id, p_reason: reason },
                          "Invoice voided.",
                        );
                    }}
                  >
                    Void
                  </GhostButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function PlanForm({
  onSave,
  setErr,
}: {
  onSave: (a: Record<string, unknown>) => void;
  setErr: (e: string | null) => void;
}) {
  return (
    <form
      className="mt-4 grid max-w-xl gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const limits: Record<string, number | null> = {};
        for (const k of ["locations", "sensors", "users"]) {
          const v = String(f.get(`limit_${k}`) ?? "")
            .trim()
            .toLowerCase();
          if (v === "") continue;
          if (v === "unlimited") limits[k] = null;
          else if (/^\d+$/.test(v)) limits[k] = Number(v);
          else
            return setErr(
              `Limit for ${k} must be a whole number or "unlimited".`,
            );
        }
        const amount = String(f.get("price_amount") ?? "").trim();
        const basis = String(f.get("price_basis") ?? "").trim();
        if (
          amount &&
          (basis.length < 10 ||
            !f.get("price_currency") ||
            !f.get("price_interval"))
        )
          return setErr(
            "A price needs a currency, an interval and a written basis (at least 10 characters).",
          );
        setErr(null);
        onSave({
          p_key: f.get("key"),
          p_name: f.get("name"),
          p_description: f.get("description") || "",
          p_published: f.get("published") === "on",
          p_sort: Number(f.get("sort") || 100),
          p_limits: limits,
          p_features: FEATURES.filter((x) => f.get(`feat_${x}`) === "on"),
          p_price_amount: amount ? Number(amount) : null,
          p_price_currency: amount ? String(f.get("price_currency")) : null,
          p_price_interval: amount ? f.get("price_interval") : null,
          p_price_basis: amount ? basis : null,
        });
      }}
    >
      <Field
        label="Plan key (lowercase, for example starter)"
        name="key"
        required
        pattern="[a-z][a-z0-9_]{1,29}"
      />
      <Field label="Name" name="name" required maxLength={60} />
      <Field label="Description" name="description" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Locations limit" name="limit_locations" />
        <Field label="Sensors limit" name="limit_sensors" />
        <Field label="Users limit" name="limit_users" />
      </div>
      <fieldset className="grid grid-cols-2 gap-1 text-sm">
        <legend className="mb-1 font-semibold">Included features</legend>
        {FEATURES.map((x) => (
          <label key={x} className="flex gap-2">
            <input type="checkbox" name={`feat_${x}`} /> {FEATURE_LABEL[x]}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field
          label="Price (optional)"
          name="price_amount"
          inputMode="decimal"
        />
        <Field label="Currency" name="price_currency" maxLength={3} />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Per</span>
          <select name="price_interval" className={inputCls}>
            <option value="month">month</option>
            <option value="year">year</option>
          </select>
        </label>
        <Field label="Sort order" name="sort" defaultValue="100" />
      </div>
      <Field label="Price basis (what the price covers)" name="price_basis" />
      <label className="flex gap-2 text-sm">
        <input type="checkbox" name="published" /> Published on the public Plans
        page
      </label>
      <Button type="submit">Save plan</Button>
    </form>
  );
}

function InvoiceForm({
  orgs,
  onCreate,
  setErr,
}: {
  orgs: { id: string; name: string }[];
  onCreate: (a: Record<string, unknown>) => void;
  setErr: (e: string | null) => void;
}) {
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const parsed = parseLines(String(f.get("lines") ?? ""));
        if (!parsed.ok) return setErr(parsed.error);
        const cur = String(f.get("currency") ?? "").toUpperCase();
        if (!/^[A-Z]{3}$/.test(cur))
          return setErr("Currency must be a three-letter code.");
        setErr(null);
        onCreate({
          p_org: f.get("org"),
          p_period_start: f.get("start"),
          p_period_end: f.get("end"),
          p_currency: cur,
          p_lines: parsed.lines,
          p_tax_amount: Number(String(f.get("tax") || "0").replace(/,/g, "")),
          p_tax_label: f.get("tax_label") || null,
          p_due: f.get("due") || null,
          p_notes: f.get("notes") || null,
        });
      }}
    >
      <select name="org" required className={inputCls}>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Period start" name="start" type="date" required />
        <Field label="Period end" name="end" type="date" required />
        <Field label="Due date" name="due" type="date" />
      </div>
      <Field
        label="Currency (for example UGX)"
        name="currency"
        required
        maxLength={3}
      />
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">
          Lines, one per row: description | amount
        </span>
        <textarea name="lines" rows={3} required className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Tax amount (typed in, optional)"
          name="tax"
          inputMode="decimal"
        />
        <Field label="Tax label" name="tax_label" />
      </div>
      <Field label="Notes" name="notes" />
      <Button type="submit">Create draft invoice</Button>
    </form>
  );
}
