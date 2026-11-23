/**
 * Public site copy. Rules (enforced by tests/site-content.test.ts):
 *  - no accuracy, lead-time or "guarantee" claims; no percentages;
 *  - no customer, partner or regulator names;
 *  - no prices or currency amounts (prices come only from published plans in the database);
 *  - no contact details that have not been supplied by the owner.
 */
export interface Section {
  heading: string;
  body?: string;
  points?: string[];
}
export interface PageContent {
  slug: string;
  title: string;
  lead: string;
  sections: Section[];
}

export const NAV = [
  { href: "/capabilities", label: "Capabilities" },
  { href: "/solutions", label: "Solutions" },
  { href: "/industries", label: "Industries" },
  { href: "/technology", label: "Technology" },
  { href: "/plans", label: "Plans" },
  { href: "/about", label: "About" },
] as const;

export const HOME_WORKS = [
  "Sign-in with two-factor verification for approvers and administrators",
  "Organisations, roles and invitations, with each organisation's data kept separate",
  "A map of stations and sensors, and a monitoring view that shows offline and stale data as such",
  "Alert drafting with a second-person approval step, and alerts delivered in dry-run only",
  "Community flood reports that stay unvalidated until a moderator checks them against evidence",
  "Forecasts labelled as unvalidated, with their inputs saved",
  "Analytics, an asset and exposure register, and exports that record who exported what",
  "An assistant that is off by default and answers only from records it can cite",
  "Plans with limits, usage monitoring and invoices",
];
export const HOME_NOT_YET = [
  "Verified flood forecasts: none has been validated for any area yet",
  "Alerts sent to real phones or inboxes: no SMS or email provider is verified",
  "Online payment: no payment provider is connected",
  "Flood extent, depth or loss estimates: HydroSight does not produce them",
];

export const PAGES: PageContent[] = [
  {
    slug: "about",
    title: "About HydroSight",
    lead: "HydroSight is flood risk intelligence and early-warning software, starting with Uganda and East Africa.",
    sections: [
      {
        heading: "Why it exists",
        body: "Flood decisions depend on knowing what was measured, what was predicted and what someone only reported. HydroSight keeps those apart on every screen.",
      },
      {
        heading: "How it is built",
        points: [
          "Every value carries one label: measured, estimated, forecast, community or synthetic.",
          "Nothing is treated as validated until a named person promotes it with a link to evidence.",
          "No public warning goes out without a second person approving it.",
        ],
      },
      {
        heading: "Who is behind it",
        body: "Company details, the team and a registered address will be published here once the owner confirms them.",
      },
    ],
  },
  {
    slug: "capabilities",
    title: "Capabilities",
    lead: "What the platform does today, and where each part still depends on data you supply.",
    sections: [
      {
        heading: "Monitor",
        body: "Stations, sensors and devices on a map. Late, offline and failed readings are shown as late, offline and failed, never as a current value.",
      },
      {
        heading: "Quality control",
        body: "Readings are stored as received and never edited. Calibration is applied when data is read. Quality limits are set by you, because HydroSight does not assume them.",
      },
      {
        heading: "Forecast",
        body: "Forecast results are labelled unvalidated and keep a snapshot of their inputs. Back-tests on synthetic data are shown as such and never support a claim about skill.",
      },
      {
        heading: "Alert",
        body: "Alerts are drafted by one person and approved by another. Thresholds come from rules your organisation writes and documents; none ship by default.",
      },
      {
        heading: "Community",
        body: "People can send flood reports from a phone. Reports stay labelled community and unvalidated until a moderator checks them. No IP address or device data is kept.",
      },
      {
        heading: "Assets and exposure",
        body: "Register assets with their location, elevation and value. Where elevation, distance to water or hazard-zone data has not been supplied, the result says not assessed, not safe.",
      },
      {
        heading: "Assistant",
        body: "An optional assistant answers questions from records it can cite, split into observed, forecast, assumptions and not known. It never issues warnings or says an area is safe. It is off until an organisation admin turns it on and sets a daily limit.",
      },
    ],
  },
  {
    slug: "solutions",
    title: "Solutions",
    lead: "Ways organisations use HydroSight, all built from the same parts.",
    sections: [
      {
        heading: "Early-warning operations",
        body: "A control room watches stations, drafts alerts and sends them through an approval step.",
      },
      {
        heading: "Community reporting",
        body: "A reporting channel for residents, with moderation and evidence before anything is published.",
      },
      {
        heading: "Exposure review",
        body: "A register of assets with what is known and not known about their flood exposure, exported with a record of the export.",
      },
      {
        heading: "Data and API access",
        body: "Organisations can create API keys with limited scopes, if their plan includes it.",
      },
    ],
  },
  {
    slug: "industries",
    title: "Industries",
    lead: "HydroSight is designed for organisations that act on flood information.",
    sections: [
      {
        heading: "Who it is for",
        points: [
          "Disaster management and local government offices",
          "Water, drainage and infrastructure operators",
          "Humanitarian and community organisations",
          "Property, insurance and engineering teams that need exposure records",
        ],
      },
      {
        heading: "What we do not claim",
        body: "No organisation is named here as a customer or partner. Pilots will be listed only with the organisation's written agreement.",
      },
    ],
  },
  {
    slug: "technology",
    title: "Technology",
    lead: "How HydroSight keeps data separate, traceable and honest about its limits.",
    sections: [
      {
        heading: "Separation",
        body: "Each organisation's data is separated by row-level security in the database, and cross-organisation access is tested.",
      },
      {
        heading: "Traceability",
        points: [
          "Changes are written to an audit trail that cannot be edited or deleted.",
          "Raw readings cannot be changed after they arrive.",
          "Forecasts are immutable and keep the inputs they used.",
          "Every export is logged with a hash of its contents.",
        ],
      },
      {
        heading: "Models and data",
        body: "Learned models may train only on real data the owner has confirmed. Synthetic data is always labelled synthetic. Third-party data is used only with its source and licence recorded.",
      },
      {
        heading: "Language model",
        body: "The optional assistant calls an external language model. On the provider's free tier, content may be used to improve its products, so use demonstration data only until a paid arrangement is in place.",
      },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    lead: "The fastest way to reach HydroSight is the demo request form.",
    sections: [
      {
        heading: "Request a demo",
        body: "Tell us about your organisation and what you want to see. Requests are saved and read by the HydroSight team.",
      },
      {
        heading: "Other ways to reach us",
        body: "A public email address, phone number and office address will be added here once the owner supplies them.",
      },
    ],
  },
];

export function page(slug: string): PageContent {
  const p = PAGES.find((x) => x.slug === slug);
  if (!p) throw new Error(`unknown page ${slug}`);
  return p;
}
