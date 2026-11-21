import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  buildAnalyticsReport,
  buildAssetsReport,
  type Portfolio,
  type StationAnalytics,
} from "@/lib/report";
import { csvSafe, sha256Hex, toCsv, toPdf, toXlsx } from "@/lib/report-format";

const sensor = (
  kind: string,
  source = "synthetic",
): StationAnalytics["sensors"][number] => ({
  sensor_id: "s1",
  kind,
  unit: kind === "rainfall" ? "mm" : "m",
  source_type: source,
  expected_interval_s: 3600,
  summary: {
    readings: 720,
    used_in_statistics: 697,
    quality_good: 0,
    quality_unchecked: 697,
    quality_suspect: 0,
    quality_bad: 23,
    estimated_excluded: 0,
    min: 0.3,
    mean: 0.9,
    max: 2.4,
    first_at: "2026-10-22T00:00:00Z",
    last_at: "2026-11-21T00:00:00Z",
    expected_readings: 720,
    completeness: 1,
  },
  monthly: [
    { month: "2026-11", readings: 300, mean: 0.9, max: 2.4, sum: 12.5 },
  ],
  weekly_performance: [
    {
      week_start: "2026-11-16T00:00:00",
      received: 168,
      expected: 168,
      completeness: 1,
      suspect: 0,
      bad: 2,
    },
  ],
  seasonal: [{ month_number: 11, years_with_data: 1, mean: 0.9, max: 2.4 }],
  annual_maxima: [{ year: 2026, max: 2.4, readings: 697 }],
  days_at_or_above_level:
    kind === "water_level" ? [{ year: 2026, days_at_or_above: 3 }] : null,
});

const data: StationAnalytics = {
  station_id: "st",
  org_id: "o",
  station: "Test gauge",
  window_from: "2026-10-22T00:00:00Z",
  window_to: "2026-11-21T01:00:00Z",
  level: 1.5,
  sensors: [sensor("water_level"), sensor("rainfall")],
};

const base = {
  data,
  rule: {
    id: "r1",
    value: 1.5,
    unit: "m",
    rationale: "Bankfull level from the 2019 survey",
  },
  warn: 0.5,
  verification: [
    {
      model: "persistence 1",
      predictions: 6,
      outcome_unknown: 1,
      hits: 2,
      misses: 1,
      false_alarms: 1,
      correct_negatives: 1,
      brier: 0.2,
      includes_synthetic: true,
    },
  ],
  events: [],
  backtests: [],
  generatedAt: "2026-11-21T12:00:00Z",
  generatedBy: "james@example.org",
};

describe("csvSafe", () => {
  it("blocks spreadsheet formula injection and quotes awkward cells", () => {
    expect(csvSafe('=HYPERLINK("http://x")')).toBe(
      '"\'=HYPERLINK(""http://x"")"',
    );
    expect(csvSafe("+1")).toBe("'+1");
    expect(csvSafe("@cmd")).toBe("'@cmd");
    expect(csvSafe("a,b")).toBe('"a,b"');
    expect(csvSafe(-5)).toBe("-5"); // real negative numbers are untouched
    expect(csvSafe(null)).toBe("");
  });
});

describe("analytics report", () => {
  const r = buildAnalyticsReport(base);
  it("states window, sources, maturity and assumptions", () => {
    expect(r.window).toEqual({ from: data.window_from, to: data.window_to });
    expect(r.maturity).toMatch(/SYNTHETIC DATA/);
    expect(r.maturity).toMatch(/Nothing in this report has been validated/);
    expect(r.assumptions.join(" ")).toMatch(/No gaps are filled/);
    expect(r.assumptions.join(" ")).toMatch(/approved rule r1/);
  });
  it("never estimates return periods and says so", () => {
    const t = r.tables.find((x) =>
      x.title.startsWith("Highest value each year"),
    );
    expect(t?.note).toMatch(/Return periods are not estimated/);
  });
  it("only adds a rainfall sum column for rainfall", () => {
    const rain = r.tables.find((x) => x.title.startsWith("Monthly: rainfall"));
    const level = r.tables.find((x) =>
      x.title.startsWith("Monthly: water level"),
    );
    expect(rain?.columns).toContain("Sum of values");
    expect(level?.columns).not.toContain("Sum of values");
    expect(rain?.note).toMatch(/only if each reading/);
  });
  it("shows a level section only when an approved rule supplied the level", () => {
    expect(
      r.tables.some((t) => t.title.startsWith("Days at or above 1.5")),
    ).toBe(true);
    const none = buildAnalyticsReport({
      ...base,
      rule: null,
      data: {
        ...data,
        level: null,
        sensors: [{ ...sensor("water_level"), days_at_or_above_level: null }],
      },
    });
    expect(
      none.tables.some((t) => t.title.startsWith("Days at or above")),
    ).toBe(false);
    expect(none.assumptions.join(" ")).toMatch(/No approved threshold rule/);
  });
  it("explains the missing warning probability instead of picking one", () => {
    const v = buildAnalyticsReport({
      ...base,
      warn: null,
      verification: null,
    }).tables.find((t) => t.title === "Forecast verification");
    expect(v?.rows[0]?.[0]).toMatch(/choose a warning probability/);
  });
  it("shows undefined scores as not defined and empty cells as not available", () => {
    const x = buildAnalyticsReport({
      ...base,
      data: {
        ...data,
        sensors: [
          {
            ...sensor("water_level"),
            summary: { ...sensor("water_level").summary, mean: null },
          },
        ],
      },
      backtests: [
        {
          model: "m 1",
          holdout_start: "2026-01-01",
          holdout_end: "2026-02-01",
          horizon_hours: 6,
          n_forecasts: 10,
          pod: null,
          far: null,
          csi: null,
          brier: null,
          is_synthetic: true,
        },
      ],
    });
    const summary = x.tables[0];
    expect(summary?.rows.find((row) => row[0] === "Mean")?.[1]).toBe(
      "not available",
    );
    const bt = x.tables.find((t) => t.title === "Backtests on stored history");
    expect(bt?.rows[0]?.slice(4, 8)).toEqual([
      "not defined",
      "not defined",
      "not defined",
      "not available",
    ]);
    expect(bt?.rows[0]?.[8]).toMatch(/tests software only/);
  });
  it("non-synthetic data drops the synthetic warning but not the validation caveat", () => {
    const real = buildAnalyticsReport({
      ...base,
      data: { ...data, sensors: [sensor("water_level", "measured")] },
    });
    expect(real.maturity).not.toMatch(/SYNTHETIC/);
    expect(real.maturity).toMatch(/has been validated/);
  });
});

describe("exports match the report", () => {
  const r = buildAnalyticsReport(base);
  it("CSV carries the metadata and every table with the same row count", () => {
    const csv = toCsv(r);
    expect(csv).toContain("Maturity");
    expect(csv).toContain("Assumption 1");
    for (const t of r.tables)
      expect(csv).toContain(t.title.includes(",") ? `"${t.title}"` : t.title);
    const dataLines = csv.split("\r\n").filter((l) => l.startsWith("2026-11,"));
    expect(dataLines.length).toBe(2); // monthly rows of the two sensors
  });
  it("XLSX has an About sheet plus one sheet per table with the same rows", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await toXlsx(r)) as unknown as ArrayBuffer);
    expect(wb.worksheets.length).toBe(r.tables.length + 1);
    const first = wb.worksheets[1];
    const t = r.tables[0];
    expect(first?.getRow(1).getCell(1).value).toBe(t?.title);
    expect(first?.getRow(2).values).toEqual([undefined, ...(t?.columns ?? [])]);
    expect(first?.getRow(3).getCell(2).value).toBe(t?.rows[0]?.[1]);
    expect(wb.worksheets[0]?.getRow(6).getCell(2).value).toBe(r.maturity);
  });
  it("XLSX never turns text into a formula", async () => {
    const evil = {
      ...r,
      tables: [{ title: "T", columns: ["a"], rows: [["=1+1"]] }],
    };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(await toXlsx(evil)) as unknown as ArrayBuffer,
    );
    expect(wb.worksheets[1]?.getRow(3).getCell(1).value).toBe("=1+1");
    expect(wb.worksheets[1]?.getRow(3).getCell(1).type).toBe(
      ExcelJS.ValueType.String,
    );
  });
  it("PDF is a real PDF, survives characters it cannot encode, and paginates", async () => {
    const weird = {
      ...r,
      scope: "Kampala — Ŋanga ก",
      tables: [
        {
          title: "Big",
          columns: ["a", "b"],
          rows: Array.from({ length: 200 }, (_, i) => [
            `row ${i}`,
            "x ".repeat(40),
          ]),
        },
      ],
    };
    const bytes = await toPdf(weird);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(3);
  });
  it("hashes content with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("assets report", () => {
  const portfolio: Portfolio = {
    assets: [
      {
        asset_id: "a",
        name: "Clinic",
        kind: "health_facility",
        geometry_type: "Point",
        lon: 30,
        lat: 0.05,
        record_source_type: "estimated",
        elevation: { status: "not_provided" },
        waterway: { status: "not_assessed" },
        hazard: { status: "not_assessed", loaded_zones: 0, note: "n" },
        value: {
          amount: 1000,
          currency: "UGX",
          basis: "district valuation roll",
          label: "x",
        },
      },
    ],
    value_inside_loaded_zones_by_currency: [],
    assumptions: ["No damage curve is applied and no loss is estimated."],
  };
  const r = buildAssetsReport({
    portfolio,
    zones: [],
    orgName: "Demo",
    generatedAt: "2026-11-21T12:00:00Z",
    generatedBy: "j@x.org",
  });
  it("says not assessed rather than safe, and states no loss is estimated", () => {
    const row = r.tables[0]?.rows[0];
    expect(row?.[4]).toBe("not provided");
    expect(row?.[5]).toBe("not assessed");
    expect(row?.[6]).toMatch(/Not assessed/);
    expect(row?.[8]).toBe("1000 UGX");
    expect(r.tables[1]?.note).toMatch(/no loss is estimated/);
    expect(r.maturity).toMatch(/not established losses/);
    expect(r.tables[2]?.note).toMatch(/No hazard zones are loaded/);
  });
});
