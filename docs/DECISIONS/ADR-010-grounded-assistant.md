# ADR-010: Grounded data assistant

Status: accepted (Phase 8). Owner review pending.

## Decision
- The assistant runs in the Next.js server route, not the Python service, so every read happens with the signed-in person's own Supabase session. Row-level security and role permissions apply unchanged; the assistant never has more access than the person asking.
- Eight read-only tools (stations, sensor status, recent readings, device health, predictions, active alerts, asset exposure, community reports). There is no tool that writes, approves, publishes or sends anything. The organisation is fixed by the server; ids from the model are validated.
- The model must finish by calling `submit_answer` with Observed, Forecast, Assumptions and Not known. The server rejects an answer if a citation was not returned by a tool in the same turn, if a forecast cites a non-prediction or an observation cites a prediction, or if any section contains warning, evacuation or safety language. One correction is allowed. Free text is never shown. Timestamps shown come from the cited records.
- Community text is sanitised, wrapped in `untrusted_text`, flagged if instruction-like, and logged. Because tools are read-only and the validator is independent of the model, an obeying model still cannot act or publish advice.
- Off by default per organisation. An org admin must set a daily token cap (no default). Caps are in tokens, not money. Every question, tool call and token count is logged in an append-only table. A turn that cannot be logged is not delivered.
- The model adapter is a small interface; Anthropic is the only implementation and its model name has no default.

## Alternatives considered
- Python service with a service-role database connection: rejected; it would bypass RLS and need its own permission checks.
- Free-form model text with citation markers: rejected; harder to validate.
- Claude Agent SDK / MCP: not needed for eight fixed tools; avoids a dependency.

## Consequences
Citations are enforced; the facts inside sentences are not mechanically verified (see OPEN_QUESTIONS). The live model path is untested until a key is supplied.
