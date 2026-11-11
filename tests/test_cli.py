"""
Unit and integration tests for AMV Maker Engine CLI commands using Typer's CliRunner.
"""

from __future__ import annotations

import json
from pathlib import Path
import pytest
from typer.testing import CliRunner

from engine.main import app
from engine.models import BeatsData, ScenesCatalog, Timeline
from tests.fixtures import (
    generate_synthetic_audio,
    generate_synthetic_video,
    generate_synthetic_timeline,
)

runner = CliRunner()


def test_cli_analyze_soundtrack_stdout(tmp_path: Path):
    """Test analyze-soundtrack CLI command emitting JSON to stdout."""
    audio_path = generate_synthetic_audio(tmp_path / "audio.wav", duration_sec=4.0)

    result = runner.invoke(app, ["analyze-soundtrack", str(audio_path)])
    assert result.exit_code == 0

    beats = BeatsData.model_validate_json(result.stdout)
    assert beats.duration_sec > 0
    assert beats.tempo_bpm > 0
    assert len(beats.beats) > 0


def test_cli_analyze_soundtrack_output_file(tmp_path: Path):
    """Test analyze-soundtrack CLI command writing to --output file."""
    audio_path = generate_synthetic_audio(tmp_path / "audio.wav", duration_sec=4.0)
    out_file = tmp_path / "beats.json"

    result = runner.invoke(app, ["analyze-soundtrack", str(audio_path), "-o", str(out_file)])
    assert result.exit_code == 0
    assert out_file.exists()

    beats = BeatsData.model_validate_json(out_file.read_text())
    assert beats.tempo_bpm > 0


def test_cli_analyze_soundtrack_missing_file():
    """Test analyze-soundtrack CLI command error handling for nonexistent file."""
    result = runner.invoke(app, ["analyze-soundtrack", "nonexistent_audio.wav"])
    assert result.exit_code == 1


def test_cli_analyze_scenes_stdout(synthetic_video_dir: Path):
    """Test analyze-scenes CLI command emitting JSON to stdout."""
    result = runner.invoke(app, ["analyze-scenes", str(synthetic_video_dir)])
    assert result.exit_code == 0

    catalog = ScenesCatalog.model_validate_json(result.stdout)
    assert catalog.total_scenes > 0
    assert len(catalog.scenes) > 0


def test_cli_analyze_scenes_output_file(synthetic_video_dir: Path, tmp_path: Path):
    """Test analyze-scenes CLI command saving to --output file."""
    out_file = tmp_path / "scenes.json"
    result = runner.invoke(app, ["analyze-scenes", str(synthetic_video_dir), "-o", str(out_file)])
    assert result.exit_code == 0
    assert out_file.exists()

    catalog = ScenesCatalog.model_validate_json(out_file.read_text())
    assert catalog.total_scenes > 0


def test_cli_direct(synthetic_audio_path: Path, synthetic_video_dir: Path, tmp_path: Path):
    """Test direct CLI command running director and outputting timeline JSON."""
    beats_file = tmp_path / "beats.json"
    scenes_file = tmp_path / "scenes.json"
    timeline_file = tmp_path / "timeline.json"

    # Generate prerequisite beats and scenes files
    res_b = runner.invoke(app, ["analyze-soundtrack", str(synthetic_audio_path), "-o", str(beats_file)])
    assert res_b.exit_code == 0
    res_s = runner.invoke(app, ["analyze-scenes", str(synthetic_video_dir), "-o", str(scenes_file)])
    assert res_s.exit_code == 0

    # Test direct with output file
    res_d = runner.invoke(
        app,
        [
            "direct",
            "--beats",
            str(beats_file),
            "--scenes",
            str(scenes_file),
            "--prompt",
            "High octane battle action cuts",
            "--title",
            "CLI Battle AMV",
            "-o",
            str(timeline_file),
        ],
    )
    assert res_d.exit_code == 0
    assert timeline_file.exists()

    tl = Timeline.model_validate_json(timeline_file.read_text())
    assert tl.project_title == "CLI Battle AMV"
    assert len(tl.cuts) > 0


def test_cli_render_default(tmp_path: Path):
    """Test render CLI command end-to-end with synthetic media."""
    timeline = generate_synthetic_timeline(tmp_path)
    timeline_file = tmp_path / "timeline.json"
    timeline_file.write_text(timeline.model_dump_json())

    out_mp4 = tmp_path / "final_amv.mp4"
    result = runner.invoke(
        app,
        [
            "render",
            str(timeline_file),
            "-o",
            str(out_mp4),
            "--resolution",
            "320x240",
            "--preset",
            "ultrafast",
        ],
    )
    assert result.exit_code == 0
    assert out_mp4.exists()
    assert out_mp4.stat().st_size > 0


def test_cli_render_json_ipc(tmp_path: Path):
    """Test render CLI command with --json flag for Tauri IPC sidecar communication."""
    timeline = generate_synthetic_timeline(tmp_path)
    timeline_file = tmp_path / "timeline.json"
    timeline_file.write_text(timeline.model_dump_json())

    out_mp4 = tmp_path / "final_amv_ipc.mp4"
    result = runner.invoke(
        app,
        [
            "render",
            str(timeline_file),
            "-o",
            str(out_mp4),
            "--resolution",
            "320x240",
            "--preset",
            "ultrafast",
            "--json",
        ],
    )
    assert result.exit_code == 0

    # Parse stdout JSON messages
    messages = []
    for line in result.stdout.strip().split("\n"):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                messages.append(json.loads(line))
            except Exception:
                pass

    types = [m.get("type") for m in messages]
    assert "completed" in types
    complete_msg = [m for m in messages if m.get("type") == "completed"][0]
    assert complete_msg["status"] == "success"
    assert complete_msg["outputPath"] == str(out_mp4.resolve())


def test_cli_render_missing_timeline():
    """Test render CLI error handling with non-existent timeline file."""
    result = runner.invoke(app, ["render", "nonexistent_timeline.json", "--json"])
    assert result.exit_code == 1
    data = json.loads(result.stdout)
    assert data["type"] == "error"
    assert data["status"] == "failed"


def test_cli_export_project_otio(tmp_path: Path):
    """Test export-project CLI command for OpenTimelineIO (.otio)."""
    timeline = generate_synthetic_timeline(tmp_path)
    timeline_file = tmp_path / "timeline.json"
    timeline_file.write_text(timeline.model_dump_json())

    out_otio = tmp_path / "project.otio"
    result = runner.invoke(
        app,
        ["export-project", str(timeline_file), "-o", str(out_otio), "--json"],
    )
    assert result.exit_code == 0
    assert out_otio.exists()

    data = json.loads(result.stdout.strip())
    assert data["type"] == "completed"
    assert data["format"] == "otio"


def test_cli_export_project_fcpxml(tmp_path: Path):
    """Test export-project CLI command for Final Cut Pro XML (.fcpxml)."""
    timeline = generate_synthetic_timeline(tmp_path)
    timeline_file = tmp_path / "timeline.json"
    timeline_file.write_text(timeline.model_dump_json())

    out_fcpxml = tmp_path / "project.fcpxml"
    result = runner.invoke(
        app,
        ["export-project", str(timeline_file), "-o", str(out_fcpxml), "--format", "fcpxml", "--json"],
    )
    assert result.exit_code == 0
    assert out_fcpxml.exists()

    data = json.loads(result.stdout.strip())
    assert data["type"] == "completed"
    assert data["format"] == "fcpxml"
