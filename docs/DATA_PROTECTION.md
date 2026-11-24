# Data protection notes (Phase 10)

**This is an engineering inventory, not legal advice and not a claim of compliance with Uganda's Data Protection and Privacy Act, 2019. Legal review is required before any pilot** (also in `docs/OPEN_QUESTIONS.md`).

## Personal data held
| Data | Where | Who can read | Notes |
|---|---|---|---|
| Staff and customer user email, role, membership | `auth.users`, `profiles`, `memberships`, `invitations` | The person; admins of their organisation | Email is needed to sign in. |
| Reporter identity and location on community reports | `community_reports` | Moderators of that organisation; the reporter for their own report | Anonymous reports store no user id (database check). No IP address or device data is stored anywhere. Photos have no EXIF (database refuses it). Consent version and time stored with each report. |
| Demo-request contact details | `demo_requests` | Platform staff only | Name, work email, organisation, optional role, country, free-text message; consent version stored. No IP or device data. |
| Assistant questions and answers | `assistant_turns` | Organisation admins with audit access | Questions are logged in full (append-only). Free text may contain personal data. |
| Audit log | `audit_log` | Admins with `audit.read` | Append-only; holds user ids and the changed row contents, which can include emails. |
| Resource contact phone numbers (shelters, clinics) | `community_resources` | Members of the organisation; public only after a second person publishes | Business contact numbers, not private individuals by design. |
| Alert recipients (SMS, email addresses) | `subscriptions` | Organisation admins | Notifications are dry-run only; nothing is sent. |

## Handling built
- Consent text and version are recorded on community reports and demo requests.
- Signed-in reporters can withdraw their own unvalidated report; anonymous reports cannot be removed later and the consent text says so.
- Data minimisation: no IP, device identifier or browser fingerprint is stored by HydroSight code. (Vercel and Supabase keep their own platform logs, which we do not control and have not reviewed.)
- Row-level security separates organisations; platform staff see only demo requests, plans, assignments, invoices and organisation names.

## Not built (gaps, owner decision and legal review needed)
- **Retention periods** are undecided for every item above, and no automatic deletion job exists.
- **Access requests (a person asks what we hold):** manual. Search by email in `auth.users`, `profiles`, `memberships`, `invitations`, `demo_requests`; by user id in `community_reports`, `assistant_turns`; and the audit log. No export tool exists.
- **Deletion requests:** manual and not yet worked out. The audit log is append-only by design, so deleting a person means deleting or anonymising live records and **deciding with counsel** how the audit trail may keep user ids. Deleting a user from `auth.users` is blocked where other rows reference it; the procedure is not written or tested.
- Privacy notice text and a data-processing description for customers (organisations are the controllers of their own data; HydroSight is likely a processor; confirm with counsel).
- Cross-border transfer: Supabase and Vercel regions are not reviewed against the Act's requirements.
- Registration with the Personal Data Protection Office and any data-protection officer requirement: not checked.
- The language-model provider (Gemini free tier) may use content to improve its products: use demonstration data only until a paid arrangement is agreed.
- Breach notification procedure: `docs/RUNBOOK.md` has incident steps; the legal notification duties and deadlines are not confirmed.
