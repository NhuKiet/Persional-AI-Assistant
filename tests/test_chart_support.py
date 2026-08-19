# tests/test_chart_support.py
from backend.app.features.research.output_schemas import ChartData
from backend.app.features.research.synthesizer import chart_is_supported

CTX = (
    "[WEB] Benchmarks\nMMLU results: Llama 3 scores 79.5 while Mistral scores "
    "71.2 on the same evaluation. Training took 40 days."
)


def _chart(**kw):
    base = dict(
        has_data=True, type="bar", title="MMLU",
        labels=["Llama 3", "Mistral"], values=[79.5, 71.2], unit="score",
        source_quote="Llama 3 scores 79.5 while Mistral scores 71.2",
    )
    base.update(kw)
    return ChartData(**base)


def test_supported_chart_with_verbatim_quote_and_two_numbers():
    assert chart_is_supported(_chart(), CTX) is True


def test_has_data_false_is_rejected():
    assert chart_is_supported(_chart(has_data=False), CTX) is False


def test_single_data_point_is_rejected():
    assert chart_is_supported(_chart(labels=["Llama 3"], values=[79.5]), CTX) is False


def test_mismatched_labels_and_values_are_rejected():
    assert chart_is_supported(_chart(labels=["a", "b", "c"], values=[1.0, 2.0]), CTX) is False


def test_missing_quote_is_rejected():
    assert chart_is_supported(_chart(source_quote=""), CTX) is False


def test_quote_absent_from_context_is_rejected():
    assert chart_is_supported(
        _chart(source_quote="Llama 3 scores 91.4 while Mistral scores 88.0"), CTX
    ) is False


def test_values_absent_from_the_quote_are_rejected():
    """The quote is real but does not contain the plotted numbers."""
    assert chart_is_supported(
        _chart(values=[12.0, 34.0], source_quote="Training took 40 days"), CTX
    ) is False


def test_quote_survives_whitespace_differences():
    assert chart_is_supported(
        _chart(source_quote="Llama 3 scores 79.5   while  Mistral scores 71.2"), CTX
    ) is True


def test_integral_values_match_without_decimal_noise():
    ctx = "Model A used 40 GPUs and model B used 12 GPUs."
    assert chart_is_supported(
        _chart(labels=["A", "B"], values=[40.0, 12.0], unit="GPUs",
               source_quote="Model A used 40 GPUs and model B used 12 GPUs"),
        ctx,
    ) is True
