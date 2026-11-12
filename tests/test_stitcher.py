"""
Unit and integration tests for FFmpeg Stitcher and OTIO/FCPXML Exporters.
"""

from __future__ import annotations

import os
from pathlib import Path
import xml.etree.ElementTree as ET
import pytest
import ffmpeg

try:
    import opentimelineio as otio
except ImportError:
    otio = None

from engine.models import RenderProgress, Timeline, TimelineCut
from engine.stitcher import (
    find_ffmpeg_binary,
    find_ffprobe_binary,
    is_videotoolbox_available,
    render_ffmpeg,
    export_otio,
    export_fcpxml,
    export_project,
)
from tests.fixtures import generate_synthetic_audio, generate_synthetic_video


def test_find_ffmpeg_and_ffprobe_binary():
    """Verify FFmpeg and FFprobe binary discoverability."""
    ffmpeg_bin = find_ffmpeg_binary()
    ffprobe_bin = find_ffprobe_binary()

    assert Path(ffmpeg_bin).exists()
    assert os.access(ffmpeg_bin, os.X_OK)
    assert Path(ffprobe_bin).exists()
    assert os.access(ffprobe_bin, os.X_OK)


def test_is_videotoolbox_available():
    """Verify VideoToolbox hardware check returns boolean without error."""
    vt_avail = is_videotoolbox_available()
    assert isinstance(vt_avail, bool)


def test_render_ffmpeg_synthetic_end_to_end(synthetic_timeline: Timeline, tmp_path: Path):
    """End-to-end test rendering a 2-cut synthetic AMV video and verifying streams and duration."""
    out_file = tmp_path / "rendered_amv.mp4"

    res_path = render_ffmpeg(
        timeline=synthetic_timeline,
        output_path=out_file,
        resolution=(320, 240),
        fps=24.0,
        preset="ultrafast",
    )

    assert res_path.exists()
    assert res_path.stat().st_size > 0

    # Probe generated video file
    probe_info = ffmpeg.probe(str(res_path))
    streams = probe_info["streams"]
    video_streams = [s for s in streams if s["codec_type"] == "video"]
    audio_streams = [s for s in streams if s["codec_type"] == "audio"]

    assert len(video_streams) == 1
    assert len(audio_streams) == 1

    # Check video parameters
    v = video_streams[0]
    assert int(v["width"]) == 320
    assert int(v["height"]) == 240
    assert v["r_frame_rate"] == "24/1"

    # Check audio parameters
    a = audio_streams[0]
    assert a["codec_name"] == "aac"
    assert a["sample_rate"] == "48000"

    # Check total duration (3.0s expected)
    duration = float(probe_info["format"]["duration"])
    assert 2.8 <= duration <= 3.2


def test_render_ffmpeg_codecs(synthetic_timeline: Timeline, tmp_path: Path):
    """Verify rendering with libx264 software codec and optional hardware codec."""
    # Test software libx264
    out_sw = tmp_path / "sw_rendered.mp4"
    render_ffmpeg(
        timeline=synthetic_timeline,
        output_path=out_sw,
        codec="libx264",
        resolution=(320, 240),
        fps=24.0,
        preset="ultrafast",
    )
    assert out_sw.exists()
    assert out_sw.stat().st_size > 0

    # Test hardware acceleration if supported
    if is_videotoolbox_available():
        out_hw = tmp_path / "hw_rendered.mp4"
        render_ffmpeg(
            timeline=synthetic_timeline,
            output_path=out_hw,
            codec="h264_videotoolbox",
            resolution=(320, 240),
            fps=24.0,
        )
        assert out_hw.exists()
        assert out_hw.stat().st_size > 0


def test_render_ffmpeg_progress_callback(synthetic_timeline: Timeline, tmp_path: Path):
    """Verify progress callback hooks receive progress updates and reaches 100%."""
    out_file = tmp_path / "progress_rendered.mp4"
    updates: list[RenderProgress] = []

    def _callback(prog: RenderProgress):
        updates.append(prog)

    render_ffmpeg(
        timeline=synthetic_timeline,
        output_path=out_file,
        resolution=(320, 240),
        fps=24.0,
        progress_callback=_callback,
        preset="ultrafast",
    )

    assert len(updates) > 0
    assert updates[-1].percent == 100.0
    assert updates[-1].current_time_sec >= 3.0


def test_render_ffmpeg_empty_timeline_error(tmp_path: Path):
    """Verify render_ffmpeg raises ValueError on empty cuts."""
    empty_timeline = Timeline(
        project_title="Empty",
        target_audio=str(tmp_path / "audio.wav"),
        cuts=[],
    )
    with pytest.raises(ValueError, match="no cuts to render"):
        render_ffmpeg(empty_timeline, tmp_path / "out.mp4")


def test_render_ffmpeg_missing_files_error(tmp_path: Path):
    """Verify render_ffmpeg raises FileNotFoundError when media does not exist."""
    missing_timeline = Timeline(
        project_title="Missing",
        target_audio=str(tmp_path / "nonexistent_audio.wav"),
        cuts=[
            TimelineCut(
                source_file=str(tmp_path / "nonexistent_clip.mp4"),
                source_in=0.0,
                source_out=1.0,
                timeline_start=0.0,
                timeline_end=1.0,
            )
        ],
    )
    with pytest.raises(FileNotFoundError):
        render_ffmpeg(missing_timeline, tmp_path / "out.mp4")


def test_render_ffmpeg_with_still_image(synthetic_audio_path: Path, tmp_path: Path):
    """Verify that FFmpeg stitcher seamlessly renders still images (JPG/PNG) into video cuts."""
    if not find_ffmpeg_binary():
        pytest.skip("ffmpeg not available")

    import cv2
    import numpy as np

    # Generate a test image
    img_path = tmp_path / "still_fanart.jpg"
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    cv2.rectangle(img, (100, 100), (540, 260), (200, 50, 100), -1)
    cv2.imwrite(str(img_path), img)

    timeline = Timeline(
        project_title="Image AMV Test",
        target_audio=str(synthetic_audio_path),
        cuts=[
            TimelineCut(
                source_file=str(img_path),
                source_in=0.0,
                source_out=2.0,
                timeline_start=0.0,
                timeline_end=2.0,
                transition="cut",
            )
        ],
    )

    out_mp4 = tmp_path / "image_cut.mp4"
    rendered = render_ffmpeg(
        timeline,
        out_mp4,
        resolution=(640, 360),
        fps=24.0,
        hwaccel=False,
    )
    assert rendered.exists()
    assert rendered.stat().st_size > 1000

    probe = ffmpeg.probe(str(rendered))
    v_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert v_stream["width"] == 640
    assert v_stream["height"] == 360
    assert float(probe["format"]["duration"]) >= 1.8


def test_export_otio(synthetic_timeline: Timeline, tmp_path: Path):
    """Verify OpenTimelineIO export produces a valid .otio schema with accurate tracks and ranges."""
    if otio is None:
        pytest.skip("OpenTimelineIO not installed")

    out_otio = tmp_path / "test_amv.otio"
    result_path = export_otio(synthetic_timeline, out_otio, fps=24.0)
    assert result_path.exists()

    # Read back and inspect OTIO structure
    read_tl = otio.adapters.read_from_file(str(result_path))
    assert read_tl.name == synthetic_timeline.project_title

    video_tracks = read_tl.video_tracks()
    audio_tracks = read_tl.audio_tracks()

    assert len(video_tracks) == 1
    assert len(audio_tracks) == 1

    # Verify video cuts count and durations
    v_clips = [c for c in video_tracks[0] if isinstance(c, otio.schema.Clip)]
    assert len(v_clips) == len(synthetic_timeline.cuts)

    # First cut: 1.5s at 24fps = 36 frames
    assert v_clips[0].source_range.duration.value == 36
    assert v_clips[0].source_range.start_time.value == 12  # 0.5s * 24

    # Verify audio clip
    a_clips = [c for c in audio_tracks[0] if isinstance(c, otio.schema.Clip)]
    assert len(a_clips) == 1
    assert a_clips[0].source_range.duration.value == 72  # 3.0s * 24


def test_export_fcpxml(synthetic_timeline: Timeline, tmp_path: Path):
    """Verify Final Cut Pro XML (FCPXML) export produces valid XML conforming to FCPXML schema."""
    out_fcpxml = tmp_path / "test_amv.fcpxml"
    result_path = export_fcpxml(synthetic_timeline, out_fcpxml, fps=24.0, width=1920, height=1080)
    assert result_path.exists()

    # Parse XML and inspect elements
    tree = ET.parse(str(result_path))
    root = tree.getroot()

    assert root.tag == "fcpxml"
    assert root.attrib.get("version") == "1.9"

    # Verify resources
    resources = root.find("resources")
    assert resources is not None
    format_elem = resources.find("format")
    assert format_elem is not None
    assert format_elem.attrib["width"] == "1920"
    assert format_elem.attrib["height"] == "1080"

    assets = resources.findall("asset")
    assert len(assets) >= 2  # 2 video assets + 1 audio asset

    # Verify sequence and spine
    spine = root.find(".//sequence/spine")
    assert spine is not None

    spine_clips = spine.findall("asset-clip")
    assert len(spine_clips) == len(synthetic_timeline.cuts)

    # Check clip offsets and durations
    clip1 = spine_clips[0]
    assert clip1.attrib["offset"] == "0.0000s"
    assert clip1.attrib["duration"] == "1.5000s"

    # Check secondary attached audio on first clip
    attached_audio = clip1.find("asset-clip")
    assert attached_audio is not None
    assert attached_audio.attrib["lane"] == "-1"
    assert attached_audio.attrib["duration"] == "3.0000s"


def test_export_project_dispatch(synthetic_timeline: Timeline, tmp_path: Path):
    """Verify export_project dispatches correctly to OTIO or FCPXML based on format/extension."""
    # Test OTIO export
    out_otio = tmp_path / "project.otio"
    res_otio = export_project(synthetic_timeline, out_otio)
    assert res_otio.suffix == ".otio"
    assert res_otio.exists()

    # Test FCPXML export via extension
    out_fcpxml = tmp_path / "project.fcpxml"
    res_fcpxml = export_project(synthetic_timeline, out_fcpxml)
    assert res_fcpxml.suffix == ".fcpxml"
    assert res_fcpxml.exists()

    # Test explicit format option
    out_explicit = tmp_path / "project_custom"
    res_explicit = export_project(synthetic_timeline, out_explicit, format="fcpxml")
    assert res_explicit.exists()

    # Test invalid format error
    with pytest.raises(ValueError, match="Unsupported export format"):
        export_project(synthetic_timeline, tmp_path / "out", format="invalid_format")
