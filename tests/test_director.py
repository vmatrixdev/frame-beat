"""
Unit tests for AMV Director (engine.director).
"""

from __future__ import annotations
import os
import pytest

from engine.director import direct_amv, direct_amv_deterministic
from engine.models import (
    BeatsData,
    EnergySegment,
    ScenesCatalog,
    SceneCut,
    Timeline,
)


@pytest.fixture
def mock_beats() -> BeatsData:
    """Provides a synthetic 8-second BeatsData structure."""
    return BeatsData(
        duration_sec=8.0,
        tempo_bpm=120.0,
        time_signature="4/4",
        downbeats=[0.0, 2.0, 4.0, 6.0],
        beats=[i * 0.5 for i in range(16)],
        energy_segments=[
            EnergySegment(start=0.0, end=2.0, level="low", label="intro"),
            EnergySegment(start=2.0, end=4.0, level="medium", label="verse"),
            EnergySegment(start=4.0, end=6.0, level="high", label="build"),
            EnergySegment(start=6.0, end=8.0, level="drop", label="drop"),
        ],
    )


@pytest.fixture
def mock_catalog() -> ScenesCatalog:
    """Provides a synthetic ScenesCatalog with multiple scenes of differing sharpness."""
    return ScenesCatalog(
        source_files=["/mock/video1.mp4", "/mock/video2.mp4"],
        total_scenes=3,
        scenes=[
            SceneCut(
                scene_id=0,
                source_file="/mock/video1.mp4",
                start_time=0.0,
                end_time=5.0,
                duration=5.0,
                sharpness_score=150.0,
                brightness_score=120.0,
            ),
            SceneCut(
                scene_id=1,
                source_file="/mock/video1.mp4",
                start_time=5.0,
                end_time=10.0,
                duration=5.0,
                sharpness_score=850.0,
                brightness_score=180.0,
            ),
            SceneCut(
                scene_id=2,
                source_file="/mock/video2.mp4",
                start_time=0.0,
                end_time=6.0,
                duration=6.0,
                sharpness_score=420.0,
                brightness_score=95.0,
            ),
        ],
    )


def test_direct_amv_deterministic_basic(mock_beats: BeatsData, mock_catalog: ScenesCatalog):
    """Verifies deterministic offline alignment of cuts to downbeats."""
    timeline = direct_amv_deterministic(
        beats=mock_beats,
        catalog=mock_catalog,
        project_title="Test AMV",
        target_audio="/mock/audio.wav",
    )

    assert isinstance(timeline, Timeline)
    assert timeline.project_title == "Test AMV"
    assert timeline.target_audio == "/mock/audio.wav"
    assert len(timeline.cuts) > 0

    # Rule: Timeline must start at 0.0 and end at beats.duration_sec
    assert timeline.cuts[0].timeline_start == 0.0
    assert timeline.cuts[-1].timeline_end == mock_beats.duration_sec

    # Rule: Cuts must seamlessly connect without gaps or overlaps
    for i in range(len(timeline.cuts) - 1):
        assert timeline.cuts[i].timeline_end == timeline.cuts[i + 1].timeline_start

    # Rule: Source duration must equal timeline duration for every cut
    for cut in timeline.cuts:
        src_dur = round(cut.source_out - cut.source_in, 3)
        tl_dur = round(cut.timeline_end - cut.timeline_start, 3)
        assert pytest.approx(src_dur, abs=0.001) == tl_dur
        assert cut.transition in ["cut", "crossfade", "flash_white", "zoom_in", "whip_pan"]


def test_direct_amv_offline_fallback(mock_beats: BeatsData, mock_catalog: ScenesCatalog, monkeypatch):
    """Verifies direct_amv transparently falls back when GEMINI_API_KEY is not configured."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    timeline = direct_amv(
        beats=mock_beats,
        catalog=mock_catalog,
        user_prompt="Energetic battle AMV with fast cuts",
        api_key=None,
    )

    assert isinstance(timeline, Timeline)
    assert len(timeline.cuts) > 0
    assert timeline.cuts[0].timeline_start == 0.0
    assert timeline.cuts[-1].timeline_end == mock_beats.duration_sec


def test_direct_amv_force_fallback(mock_beats: BeatsData, mock_catalog: ScenesCatalog):
    """Verifies force_fallback flag uses deterministic director directly."""
    timeline = direct_amv(
        beats=mock_beats,
        catalog=mock_catalog,
        user_prompt="Emotional anime music video",
        force_fallback=True,
    )
    assert isinstance(timeline, Timeline)
    assert len(timeline.cuts) > 0


def test_direct_amv_empty_catalog(mock_beats: BeatsData):
    """Verifies ValueError when scenes catalog is empty."""
    empty_catalog = ScenesCatalog(source_files=[], total_scenes=0, scenes=[])
    with pytest.raises(ValueError, match="contains no scenes"):
        direct_amv_deterministic(beats=mock_beats, catalog=empty_catalog)


def test_direct_amv_zero_duration_audio(mock_catalog: ScenesCatalog):
    """Verifies ValueError when audio duration is <= 0."""
    invalid_beats = BeatsData(
        duration_sec=0.0,
        tempo_bpm=120.0,
        time_signature="4/4",
        downbeats=[],
        beats=[],
        energy_segments=[],
    )
    with pytest.raises(ValueError, match="duration must be greater than 0"):
        direct_amv_deterministic(beats=invalid_beats, catalog=mock_catalog)
