"""Gate for machine-learned models: train only on data a human has confirmed as real.

Gradient boosting (or anything else learned) must pass through `require_real_training_data`
first. Synthetic data, or real data nobody has confirmed, is refused, so a model trained on
invented numbers can never be presented as having real performance. No learned model is
trained in this codebase yet: it waits for the owner's real datasets."""

from hydrosight_api.forecasting.series import Series


class TrainingDataRefused(ValueError):
    """The data may not be used to train a learned model."""


def require_real_training_data(stage: Series, rain: Series | None = None) -> None:
    for name, s in (("stage", stage), ("rain", rain)):
        if s is None:
            continue
        if s.origin != "real_confirmed":
            raise TrainingDataRefused(
                f"{name} series is '{s.origin}'. Learned models are trained only on data the owner "
                "has confirmed is real (real_confirmed)."
            )
