import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export const inputCls =
  "w-full rounded-md border border-[#b9cad8] bg-white px-3 py-2 text-ink placeholder:text-muted/60 hover:border-ocean";

export function Button({ className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`min-h-11 rounded-md bg-ocean px-4 py-2 font-semibold text-white hover:bg-ocean-deep disabled:opacity-50 ${className}`}
    />
  );
}

export function GhostButton({ className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`min-h-10 rounded-md border border-[#b9cad8] bg-white px-3 py-1 text-sm font-semibold text-ink hover:border-ocean disabled:opacity-50 ${className}`}
    />
  );
}

export function Field({
  label,
  ...p
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input {...p} className={inputCls} />
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="rounded-md border border-src-synthetic/50 bg-src-synthetic/5 p-3 text-sm text-src-synthetic">
      {children}
    </p>
  ) : null;
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,31,51,0.04)] sm:p-5">
      <h2 className="mb-3 text-xl font-bold sm:mb-4">{title}</h2>
      {children}
    </section>
  );
}
