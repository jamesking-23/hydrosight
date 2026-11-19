import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export const inputCls =
  "w-full rounded border border-ocean bg-transparent px-3 py-2 text-[var(--text)]";

export function Button({ className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`rounded bg-ocean px-4 py-2 font-semibold text-white disabled:opacity-50 ${className}`}
    />
  );
}

export function GhostButton({ className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`rounded border border-ocean px-3 py-1 text-sm disabled:opacity-50 ${className}`}
    />
  );
}

export function Field({
  label,
  ...p
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm">{label}</span>
      <input {...p} className={inputCls} />
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="rounded border border-src-synthetic p-3 text-sm">
      {children}
    </p>
  ) : null;
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded border border-ocean p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
