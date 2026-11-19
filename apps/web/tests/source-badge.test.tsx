import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaturityBanner } from "@/components/maturity-banner";
import { SOURCE_TYPES, SourceBadge } from "@/components/source-badge";

describe("SourceBadge (HS-UI-001: every value shows its source type)", () => {
  it("renders a distinct label for every source type", () => {
    const labels = SOURCE_TYPES.map((s) => {
      const { unmount, container } = render(<SourceBadge source={s} />);
      const text = container.textContent ?? "";
      unmount();
      return text;
    });
    expect(new Set(labels).size).toBe(SOURCE_TYPES.length);
  });

  it("labels synthetic data unmistakably", () => {
    render(<SourceBadge source="synthetic" />);
    expect(screen.getByText("SYNTHETIC DEMO")).toBeTruthy();
  });

  it("labels community data as unverified", () => {
    render(<SourceBadge source="community" />);
    expect(screen.getByText(/UNVERIFIED/)).toBeTruthy();
  });
});

describe("MaturityBanner (HS-UI-002: unvalidated by default)", () => {
  it("defaults to the not-yet-validated notice", () => {
    render(<MaturityBanner />);
    expect(screen.getByRole("status").textContent).toContain("advisory only");
  });
});
