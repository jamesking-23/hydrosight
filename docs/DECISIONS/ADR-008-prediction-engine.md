# ADR-008: Prediction engine and validation harness

Status: accepted (2026-11-21). Migration `0009_prediction_engine.sql`. Code: `services/api/src/hydrosight_api/forecasting/`.

## Decisions
1. **Harness first, then baselines.** Scores (POD, FAR, CSI, Brier, reliability bins, median lead time, extreme events reported separately) are plain functions with hand-checked tests. Undefined scores are `null`, never 0.
2. **Hold-out discipline in code.** A model is fitted only on data and labels strictly before `train_end`, and at each issue time is shown `Series.upto(i)`, so it cannot see the future. A test proves this.
3. **No invented thresholds.** The event level, its written basis (20+ characters) and the warning probability are supplied by the caller. In production the level comes only from an active, approved threshold rule with a documented basis; without one, no occurrence forecast is issued.
4. **Baselines:** persistence, rate-of-rise, rainfall accumulation (antecedent index in bins), empirical exceedance. Probabilities are Laplace-smoothed frequencies. Decay, window and bin count are required arguments, not defaults, and are not validated values.
5. **Learned models are gated.** The database refuses `ml`/`hybrid` models unless a `models.promote` holder confirmed the data as real; code refuses to train on anything but `real_confirmed` series. No learned model exists yet; it waits for real data.
6. **Targets:** only `flood_occurrence` and `stage`. Extent, depth and impact are refused by the database until a calibrated hydraulic model exists.
7. **Immutability and provenance.** Predictions and backtest runs are append-only (trigger plus no grants). Each prediction stores its model version, horizon, and an input snapshot (series window, sensors, data origin, the threshold rule and its rationale).
8. **Promotion** is by a human with `models.promote`, never the registrant, with an evidence link, only for real-confirmed data with at least one real-confirmed backtest, and in order unvalidated, validated, operational. Synthetic backtests never count.
9. **Stale input is not forecast from.** The engine skips a station whose newest observation is older than 3 hours; the UI marks any prediction older than 3 hours "Out of date" and keeps counting on an open page.
10. **External models** (HEC-HMS, HEC-RAS, LISFLOOD, GloFAS, Google Flood Hub): interface only. An adapter cannot be registered without a recorded licence check. None is integrated.
11. **Labels.** The build prompt asks for "PROTOTYPE" labels; per the owner's instruction the UI says "Not validated" (the `unvalidated` state) instead, and nothing implies accuracy.
12. **Rainfall and forecasts as inputs:** only calibrated readings of good or unchecked quality, measured or synthetic. Interpolated `estimated` values never feed a forecast.
