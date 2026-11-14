"""
Unit tests for AMV Director (engine.director).
"""

from __future__ import annotations
import os
import pytest

from engine.director import (
    DIRECTOR_SYSTEM_INSTRUCTION,
    build_director_input,
    direct_amv,
    direct_amv_deterministic,
)
from engine.models import (
    AudioCueNote,
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


def test_direct_amv_genre_adaptation(mock_beats: BeatsData, mock_catalog: ScenesCatalog):
    """Verifies that the director adapts pacing and transitions to genre (e.g. wedding vs action)."""
    # 1. Emotional / Wedding / Family / Memories
    wedding_tl = direct_amv_deterministic(
        beats=mock_beats,
        catalog=mock_catalog,
        user_prompt="Emotional wedding ceremony montage with soft dissolves and warm photos",
    )
    assert isinstance(wedding_tl, Timeline)
    # Emotional mode prefers crossfades and avoids harsh flash_white
    transitions = [c.transition for c in wedding_tl.cuts]
    assert "crossfade" in transitions
    assert "flash_white" not in transitions

    # 2. Action / AMV / Battle
    action_tl = direct_amv_deterministic(
        beats=mock_beats,
        catalog=mock_catalog,
        user_prompt="High-octane action AMV battle with rapid cuts and flash transitions",
    )
    assert isinstance(action_tl, Timeline)
    action_transitions = [c.transition for c in action_tl.cuts]
    assert "flash_white" in action_transitions or "whip_pan" in action_transitions


def test_direct_amv_offline_fallback(mock_beats: BeatsData, mock_catalog: ScenesCatalog, monkeypatch):
    """Verifies direct_amv transparently falls back when GEMINI_API_KEY is not configured."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr("engine.director.load_dotenv_if_present", lambda: None)

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


def test_build_director_input_includes_rich_metrics_and_annotations():
    """Verifies build_director_input forwards new audio/visual/emotion metrics and user annotations."""
    beats = BeatsData(
        duration_sec=4.0,
        tempo_bpm=120.0,
        downbeats=[0.0, 2.0],
        beats=[0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
        energy_segments=[
            EnergySegment(
                start=0.0,
                end=2.0,
                level="low",
                label="segment_1",
                vocal_energy=0.82,
                percussive_energy=0.15,
                bass_energy=0.22,
                spectral_brightness=0.35,
                audio_mood="vocal_intimate",
            ),
            EnergySegment(
                start=2.0,
                end=4.0,
                level="high",
                label="segment_2",
                vocal_energy=0.40,
                percussive_energy=0.91,
                bass_energy=0.88,
                spectral_brightness=0.72,
                audio_mood="high_energy_drop",
            ),
        ],
        audio_notes=[
            AudioCueNote(
                id="cue-1",
                timestamp_ms=2000,
                tags=["drop", "impact"],
                note="Hard beat drop here",
            )
        ],
    )
    catalog = ScenesCatalog(
        source_files=["/mock/clip.mp4"],
        total_scenes=1,
        scenes=[
            SceneCut(
                scene_id=0,
                source_file="/mock/clip.mp4",
                start_time=0.0,
                end_time=4.0,
                duration=4.0,
                sharpness_score=510.0,
                motion_score=45.0,
                brightness_score=140.0,
                contrast_score=62.5,
                saturation_score=70.0,
                fluidity_score=88.2,
                dramatism_score=58.0,
                color_mood="warm_golden",
                visual_mood="dramatic_intense",
                has_faces=True,
                face_count=1,
                dominant_expression="focused / determined",
                smile_score=0.12,
                subject_prominence="close_up",
                emotion_scores={
                    "joy": 0.1,
                    "surprise": 0.05,
                    "anger": 0.2,
                    "sadness": 0.05,
                    "worry": 0.1,
                    "neutral": 0.5,
                },
                user_tags=["hero", "climax"],
                user_note="Use on the 2.0s drop",
            )
        ],
    )

    payload = build_director_input(beats=beats, catalog=catalog, user_prompt="Dramatic AMV")
    assert payload["audio_cue_notes"] == [
        {
            "id": "cue-1",
            "timestamp_ms": 2000,
            "timestamp_sec": 2.0,
            "tags": ["drop", "impact"],
            "note": "Hard beat drop here",
        }
    ]
    seg0 = payload["music_profile"]["energy_segments"][0]
    assert seg0["vocal_energy"] == 0.82
    assert seg0["audio_mood"] == "vocal_intimate"

    scene0 = payload["available_scenes"][0]
    assert scene0["contrast_score"] == 62.5
    assert scene0["saturation_score"] == 70.0
    assert scene0["fluidity_score"] == 88.2
    assert scene0["dramatism_score"] == 58.0
    assert scene0["color_mood"] == "warm_golden"
    assert scene0["visual_mood"] == "dramatic_intense"
    assert scene0["emotion_scores"]["neutral"] == 0.5
    assert scene0["user_tags"] == ["hero", "climax"]
    assert scene0["user_note"] == "Use on the 2.0s drop"

    for keyword in ["user_tags", "user_note", "audio_cue_notes", "vocal_energy", "fluidity_score", "dramatism_score"]:
        assert keyword in DIRECTOR_SYSTEM_INSTRUCTION


def test_clip_search_and_shortlist_for_segment(mock_beats: BeatsData):
    """Verifies static clip search tools and segment shortlisting with pinned clips and segment notes."""
    from engine.clip_search import get_scene_details, list_source_summaries, search_scenes
    from engine.director import shortlist_clips_for_segment
    from engine.models import AudioCueNote, PinnedVideoRange

    catalog = ScenesCatalog(
        source_files=["/media/ceremony.mp4", "/media/dance.mp4"],
        total_scenes=3,
        scenes=[
            SceneCut(
                scene_id=0,
                source_file="/media/ceremony.mp4",
                start_time=1.0,
                end_time=4.0,
                duration=3.0,
                visual_mood="warm_intimate",
                color_mood="warm_golden",
                has_faces=True,
                smile_score=0.85,
                user_tags=["bride", "smile"],
                user_note="Emotional smile during vows",
            ),
            SceneCut(
                scene_id=1,
                source_file="/media/dance.mp4",
                start_time=5.0,
                end_time=8.5,
                duration=3.5,
                visual_mood="energetic_action",
                fluidity_score=84.0,
                dramatism_score=70.0,
                user_tags=["party", "sparklers"],
                user_note="High energy dance floor",
            ),
            SceneCut(
                scene_id=2,
                source_file="/media/dance.mp4",
                start_time=10.0,
                end_time=13.0,
                duration=3.0,
                visual_mood="serene_scenic",
                user_tags=["outro"],
            ),
        ],
    )

    summaries = list_source_summaries(catalog)
    assert len(summaries) == 2
    assert summaries[1]["clip_count"] == 2

    hits = search_scenes(catalog, query_text="sparklers", min_fluidity=80.0)
    assert len(hits) == 1
    assert hits[0]["scene_id"] == 1

    details = get_scene_details(catalog, 0)
    assert details is not None
    assert details["visual_mood"] == "warm_intimate"

    cue = AudioCueNote(
        id="seg-1",
        timestamp_ms=2000,
        end_ms=6000,
        tags=["sparklers", "party"],
        note="Drop hits here, want energetic dance floor",
        pinned_scene_ids=[0],
        pinned_ranges=[PinnedVideoRange(source_file="/media/dance.mp4", start_sec=5.5, end_sec=7.5)],
    )
    shortlist = shortlist_clips_for_segment(
        beats=mock_beats,
        catalog=catalog,
        start_ms=2000,
        end_ms=6000,
        cue_note=cue,
        limit=3,
        force_fallback=True,
    )
    assert shortlist.start_ms == 2000
    assert shortlist.end_ms == 6000
    assert len(shortlist.candidates) == 3
    # Pinned scene (0) and pinned/matched dance clip (1) should rank top 2
    top_ids = {c.scene_id for c in shortlist.candidates[:2]}
    assert top_ids == {0, 1}


def test_clip_search_query_contract():
    """Verifies ClipSearchQuery contract shared between UI filters and AI agent tools."""
    from engine.clip_search import build_search_tool_functions, search_scenes_from_query
    from engine.models import ClipSearchQuery

    catalog = ScenesCatalog(
        source_files=["/media/action.mp4", "/media/calm.mp4"],
        total_scenes=2,
        scenes=[
            SceneCut(
                scene_id=0,
                source_file="/media/action.mp4",
                start_time=0.0,
                end_time=3.0,
                duration=3.0,
                dramatism_score=72.0,
                sharpness_score=65.0,
                semantic_tags=["epic action / fight", "brave / determined"],
            ),
            SceneCut(
                scene_id=1,
                source_file="/media/calm.mp4",
                start_time=0.0,
                end_time=3.0,
                duration=3.0,
                dramatism_score=25.0,
                sharpness_score=90.0,
                semantic_tags=["calm / serene", "warm / intimate"],
            ),
        ],
    )

    q_sem = ClipSearchQuery(semantic_tag="epic action / fight", limit=10)
    res_sem = search_scenes_from_query(catalog, q_sem)
    assert [r["scene_id"] for r in res_sem] == [0]

    q_sort = ClipSearchQuery(sort_by="sharpness", limit=10)
    res_sort = search_scenes_from_query(catalog, q_sort)
    assert [r["scene_id"] for r in res_sort] == [1, 0]

    tools = build_search_tool_functions(catalog)
    tool_search = tools[1]
    res_tool = tool_search(semantic_tag="calm / serene", source_file="calm.mp4")
    assert [r["scene_id"] for r in res_tool] == [1]
