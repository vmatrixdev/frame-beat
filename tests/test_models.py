"""
Unit tests for AMV Maker pipeline models and data validation.
"""

import json
from engine.models import (
    EnergySegment,
    BeatsData,
    SceneCut,
    ScenesCatalog,
    TimelineCut,
    Timeline,
)


def test_energy_segment_validation():
    seg = EnergySegment(start=0.0, end=15.0, level="intro", label="intro_section")
    assert seg.start == 0.0
    assert seg.end == 15.0
    assert seg.level == "intro"
    assert seg.label == "intro_section"


def test_beats_data_serialization():
    data = BeatsData(
        duration_sec=120.0,
        tempo_bpm=128.0,
        time_signature="4/4",
        downbeats=[0.0, 1.875, 3.75],
        beats=[0.0, 0.468, 0.937, 1.406, 1.875],
        energy_segments=[
            EnergySegment(start=0.0, end=30.0, level="low", label="intro"),
            EnergySegment(start=30.0, end=90.0, level="high", label="chorus"),
        ],
    )
    dumped = data.model_dump()
    assert dumped["tempo_bpm"] == 128.0
    assert len(dumped["beats"]) == 5
    assert len(dumped["downbeats"]) == 3

    # Ensure JSON matches expected schema structure
    json_str = data.model_dump_json()
    loaded = json.loads(json_str)
    assert loaded["duration_sec"] == 120.0
    assert loaded["energy_segments"][1]["level"] == "high"


def test_scene_cut_metrics():
    cut = SceneCut(
        scene_id=1,
        source_file="/path/to/ep01.mp4",
        start_time=12.5,
        end_time=15.0,
        duration=2.5,
        keyframe_path="/cache/thumbnails/ep01_scene_0001.jpg",
        sharpness_score=142.5,
        brightness_score=110.2,
    )
    assert cut.scene_id == 1
    assert cut.duration == 2.5
    assert cut.sharpness_score == 142.5


def test_timeline_validation():
    timeline = Timeline(
        project_title="Epic Battle AMV",
        target_audio="/media/audio.mp3",
        cuts=[
            TimelineCut(
                source_file="/media/clip1.mp4",
                source_in=0.0,
                source_out=1.875,
                timeline_start=0.0,
                timeline_end=1.875,
                transition="cut",
                pacing_beat_interval=4,
            ),
            TimelineCut(
                source_file="/media/clip2.mp4",
                source_in=5.0,
                source_out=7.5,
                timeline_start=1.875,
                timeline_end=4.375,
                transition="flash_white",
                pacing_beat_interval=4,
            ),
        ],
    )
    assert len(timeline.cuts) == 2
    assert timeline.cuts[1].transition == "flash_white"
    assert timeline.cuts[0].timeline_end == timeline.cuts[1].timeline_start
