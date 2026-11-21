# Synthetic seed data

All seed data is **synthetic** and must be stored with `source_type = 'synthetic'` and badged "SYNTHETIC DEMO" in the UI.

Phase 0 has no tables to seed yet (stations, sensors and readings arrive in Phases 2-3). The seed script is added in Phase 2 together with the tables it populates, so it can be run and verified. It is not stubbed here to avoid an untested script.

`demo_models.sql` registers the four baseline models for the demo organisation (synthetic, unvalidated).
