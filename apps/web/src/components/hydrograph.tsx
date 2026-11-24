import { SourceBadge } from "@/components/source-badge";

/**
 * Illustration of how HydroSight labels data. The curve is hand-drawn SYNTHETIC DEMO data:
 * it does not come from any river, sensor or model, and carries no accuracy or lead time.
 */
export function Hydrograph() {
  return (
    <figure className="rounded-xl border border-line bg-mist p-5">
      <figcaption className="mb-3 flex flex-wrap items-center gap-2">
        <SourceBadge source="synthetic" />
        <span className="text-sm text-muted">Illustration only. Not data from any real river.</span>
      </figcaption>
      <svg
        viewBox="0 0 560 280"
        role="img"
        aria-label="Example river-stage chart. A solid line shows readings up to now, then a dashed line with a shaded band shows a forecast."
        className="h-auto w-full"
      >
        <g stroke="#d5e1ea" strokeWidth="1">
          {[50, 110, 170, 230].map((y) => (
            <line key={y} x1="48" x2="544" y1={y} y2={y} />
          ))}
        </g>
        <line x1="48" x2="48" y1="30" y2="240" stroke="#9db3c4" />
        <line x1="48" x2="544" y1="240" y2="240" stroke="#9db3c4" />
        <text x="12" y="140" fontSize="14" fill="#4a6176" transform="rotate(-90 12 140)" textAnchor="middle">
          River stage
        </text>
        <text x="296" y="266" fontSize="14" fill="#4a6176" textAnchor="middle">
          Time
        </text>

        {/* forecast uncertainty band */}
        <path d="M340 92 C390 70 440 56 490 70 S530 92 544 100 L544 168 C520 150 490 132 450 126 S380 118 340 92 Z"
          fill="#1b5e9b" opacity="0.12" />
        {/* readings so far */}
        <path d="M48 214 C100 210 140 196 184 168 S270 112 340 92" fill="none" stroke="#2f7a33"
          strokeWidth="3.5" strokeLinecap="round" pathLength="1" className="draw-line" />
        {/* forecast */}
        <path d="M340 92 C390 76 440 66 490 82 S530 108 544 124" fill="none" stroke="#1b5e9b"
          strokeWidth="3.5" strokeDasharray="2 9" strokeLinecap="round" />
        <line x1="340" x2="340" y1="30" y2="240" stroke="#0b1f33" strokeWidth="1.5" />
        <circle cx="340" cy="92" r="5.5" fill="#fff" stroke="#0b1f33" strokeWidth="2" />
        <text x="334" y="46" fontSize="13" fontWeight="700" fill="#0b1f33" textAnchor="end">Now</text>
      </svg>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden className="inline-block h-1 w-6 rounded bg-leaf" />
          Readings up to now are labelled <SourceBadge source="measured" />
        </li>
        <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden className="inline-block h-1 w-6 rounded border-t-4 border-dotted border-ocean" />
          Anything after now is labelled <SourceBadge source="forecast" />
        </li>
      </ul>
    </figure>
  );
}
