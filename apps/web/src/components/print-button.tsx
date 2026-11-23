"use client";
import { GhostButton } from "@/components/ui";

export function PrintButton() {
  return (
    <GhostButton
      type="button"
      onClick={() => window.print()}
      className="print:hidden"
    >
      Print or save as PDF
    </GhostButton>
  );
}
