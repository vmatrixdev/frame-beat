"""
Stitcher & Exporter for AMV Maker.
Deterministic cut-to-cut concatenation using FFmpeg and project export to OpenTimelineIO / FCPXML.
"""

from __future__ import annotations

from collections import Counter
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Callable, Optional, Tuple
import xml.etree.ElementTree as ET

import ffmpeg

try:
    import opentimelineio as otio
except ImportError:
    otio = None

from engine.models import RenderProgress, Timeline

logger = logging.getLogger(__name__)

COMMON_BINARY_DIRS = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
]


def ensure_ffmpeg_in_path() -> None:
    """Ensure standard homebrew and local bin directories are in PATH for macOS/Linux."""
    current_path = os.environ.get("PATH", "")
    paths = current_path.split(os.pathsep)
    new_dirs = [d for d in COMMON_BINARY_DIRS if d not in paths and Path(d).exists()]
    if new_dirs:
        os.environ["PATH"] = os.pathsep.join(new_dirs + paths)


# Automatically update PATH on module import
ensure_ffmpeg_in_path()


def find_ffmpeg_binary() -> str:
    """Finds the absolute path to the ffmpeg executable."""
    ensure_ffmpeg_in_path()
    bin_path = shutil.which("ffmpeg")
    if bin_path:
        return bin_path
    for d in COMMON_BINARY_DIRS:
        candidate = Path(d) / "ffmpeg"
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise FileNotFoundError("FFmpeg binary not found. Please install FFmpeg (e.g., brew install ffmpeg).")


def find_ffprobe_binary() -> str:
    """Finds the absolute path to the ffprobe executable."""
    ensure_ffmpeg_in_path()
    bin_path = shutil.which("ffprobe")
    if bin_path:
        return bin_path
    for d in COMMON_BINARY_DIRS:
        candidate = Path(d) / "ffprobe"
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise FileNotFoundError("FFprobe binary not found. Please install FFprobe.")


def is_videotoolbox_available() -> bool:
    """Checks if macOS VideoToolbox hardware encoding (h264_videotoolbox) is supported."""
    if sys.platform != "darwin":
        return False
    try:
        ffmpeg_bin = find_ffmpeg_binary()
        res = subprocess.run(
            [ffmpeg_bin, "-encoders"],
            capture_output=True,
            text=True,
            check=True,
        )
        return "h264_videotoolbox" in res.stdout
    except Exception:
        return False


def render_ffmpeg(
    timeline: Timeline,
    output_path: str | Path,
    preset: str = "fast",
    codec: Optional[str] = None,
    hwaccel: bool = True,
    resolution: Tuple[int, int] = (1920, 1080),
    fps: float = 24.0,
    progress_callback: Optional[Callable[[RenderProgress], None]] = None,
) -> Path:
    """
    Renders the timeline into a single MP4 video file using FFmpeg filter complex.

    Features:
    - Deterministic concatenation with filter complexes (trim, setpts, scale, pad, setsar, fps).
    - Muxes soundtrack audio deterministically up to the exact timeline duration.
    - Automatic hardware acceleration via VideoToolbox on macOS with graceful fallback to libx264.
    - Real-time progress updates via progress_callback.
    """
    if not timeline.cuts:
        raise ValueError("Timeline contains no cuts to render.")

    target_audio_path = Path(timeline.target_audio).resolve()
    if not target_audio_path.exists():
        raise FileNotFoundError(f"Target audio file not found: {timeline.target_audio}")

    for idx, cut in enumerate(timeline.cuts):
        src_path = Path(cut.source_file).resolve()
        if not src_path.exists():
            raise FileNotFoundError(f"Source video file for cut {idx} not found: {cut.source_file}")

    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    width, height = resolution
    total_duration = max(timeline.cuts[-1].timeline_end, 0.1)

    video_streams = []
    for cut in timeline.cuts:
        in_point = max(cut.source_in, 0.0)
        duration = cut.timeline_end - cut.timeline_start
        if duration <= 0:
            duration = max(cut.source_out - cut.source_in, 0.1)

        # Check if source file is a still image (JPG, PNG, WebP)
        src_resolved = Path(cut.source_file).resolve()
        src_ext = src_resolved.suffix.lower()
        if src_ext in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
            inp = ffmpeg.input(str(src_resolved), loop=1, t=duration, framerate=fps)
        else:
            inp = ffmpeg.input(str(src_resolved), ss=in_point, t=duration)

        # Apply trim, setpts, scale, pad, setsar, and fps filters for deterministic alignment
        v_stream = (
            inp
            .filter("trim", duration=duration)
            .filter("setpts", "PTS-STARTPTS")
            .filter("scale", width, height, force_original_aspect_ratio="decrease")
            .filter("pad", width, height, "(ow-iw)/2", "(oh-ih)/2")
            .filter("setsar", 1)
            .filter("fps", fps=fps)
        )
        video_streams.append(v_stream)

    # In FFmpeg filter graph, if a clip/scene stream appears multiple times,
    # ffmpeg-python requires a split filter rather than multiple edges from the same node.
    stream_counts = Counter(video_streams)
    split_streams = {}
    for stream, count in stream_counts.items():
        if count > 1:
            split_node = stream.split()
            split_streams[stream] = [split_node[idx] for idx in range(count)]

    final_video_streams = []
    for stream in video_streams:
        if stream in split_streams:
            final_video_streams.append(split_streams[stream].pop(0))
        else:
            final_video_streams.append(stream)

    concatenated_video = ffmpeg.concat(*final_video_streams, v=1, a=0)
    audio_stream = ffmpeg.input(str(target_audio_path))

    # Resolve video encoder codec
    selected_codec = codec
    if not selected_codec or selected_codec.lower() == "auto":
        if hwaccel and is_videotoolbox_available():
            selected_codec = "h264_videotoolbox"
        else:
            selected_codec = "libx264"

    ffmpeg_bin = find_ffmpeg_binary()

    def _execute_ffmpeg(chosen_codec: str) -> None:
        out_kwargs = {
            "vcodec": chosen_codec,
            "acodec": "aac",
            "ar": "48000",
            "pix_fmt": "yuv420p",
            "t": total_duration,
            "progress": "pipe:1",
        }
        if chosen_codec == "h264_videotoolbox":
            out_kwargs["b:v"] = "8000k"
        else:
            out_kwargs["preset"] = preset
            out_kwargs["crf"] = 18

        pipeline = ffmpeg.output(
            concatenated_video,
            audio_stream,
            str(output_path),
            **out_kwargs,
        ).overwrite_output()

        cmd_args = ffmpeg.compile(pipeline, cmd=ffmpeg_bin, overwrite_output=True)

        proc = subprocess.Popen(
            cmd_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        prog = RenderProgress(
            percent=0.0,
            current_time_sec=0.0,
            total_time_sec=total_duration,
            fps=0.0,
            speed="0x",
            frame=0,
        )

        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if "=" in line:
                k, v = line.split("=", 1)
                if k == "out_time_us":
                    try:
                        us = int(v)
                        prog.current_time_sec = us / 1_000_000.0
                        if total_duration > 0:
                            prog.percent = min(100.0, (prog.current_time_sec / total_duration) * 100.0)
                    except ValueError:
                        pass
                elif k == "fps":
                    try:
                        prog.fps = float(v)
                    except ValueError:
                        pass
                elif k == "speed":
                    prog.speed = v.strip()
                elif k == "frame":
                    try:
                        prog.frame = int(v)
                    except ValueError:
                        pass
                elif k == "progress":
                    if v == "end":
                        prog.percent = 100.0
                        prog.current_time_sec = total_duration
                    if progress_callback:
                        progress_callback(prog)

        _, stderr_data = proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(
                f"FFmpeg render failed (code {proc.returncode}) with codec {chosen_codec}:\n{stderr_data}"
            )

    try:
        _execute_ffmpeg(selected_codec)
    except Exception as err:
        if selected_codec == "h264_videotoolbox":
            logger.warning(
                f"Hardware acceleration with h264_videotoolbox failed ({err}). Falling back to libx264 software encoder."
            )
            _execute_ffmpeg("libx264")
        else:
            raise

    # Ensure 100% progress emitted at completion
    if progress_callback:
        progress_callback(
            RenderProgress(
                percent=100.0,
                current_time_sec=total_duration,
                total_time_sec=total_duration,
                fps=0.0,
                speed="1x",
                frame=int(round(total_duration * fps)),
            )
        )

    return output_path


def export_otio(timeline: Timeline, output_path: str | Path, fps: float = 24.0) -> Path:
    """
    Exports timeline into OpenTimelineIO (.otio) format for DaVinci Resolve or Final Cut Pro.
    Accurately records video clip cuts, source ranges, and soundtrack audio track.
    """
    if otio is None:
        raise RuntimeError("OpenTimelineIO is not installed. Please install opentimelineio package.")

    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    otio_timeline = otio.schema.Timeline(name=timeline.project_title)
    video_track = otio.schema.Track(name="Video Track", kind=otio.schema.TrackKind.Video)
    audio_track = otio.schema.Track(name="Audio Track", kind=otio.schema.TrackKind.Audio)

    current_timeline_time = 0.0

    for cut in timeline.cuts:
        # Check for gap before this cut
        if cut.timeline_start > current_timeline_time:
            gap_duration = cut.timeline_start - current_timeline_time
            gap_frames = int(round(gap_duration * fps))
            if gap_frames > 0:
                video_track.append(
                    otio.schema.Gap(
                        source_range=otio.opentime.TimeRange(
                            start_time=otio.opentime.RationalTime(0, fps),
                            duration=otio.opentime.RationalTime(gap_frames, fps),
                        )
                    )
                )

        cut_duration = cut.timeline_end - cut.timeline_start
        duration_frames = max(1, int(round(cut_duration * fps)))
        start_frame = max(0, int(round(cut.source_in * fps)))

        src_resolved = Path(cut.source_file).resolve().as_posix()
        media_reference = otio.schema.ExternalReference(
            target_url=f"file://{src_resolved}",
            available_range=otio.opentime.TimeRange(
                start_time=otio.opentime.RationalTime(0, fps),
                duration=otio.opentime.RationalTime(start_frame + duration_frames, fps),
            ),
        )

        clip = otio.schema.Clip(
            name=Path(cut.source_file).stem,
            media_reference=media_reference,
            source_range=otio.opentime.TimeRange(
                start_time=otio.opentime.RationalTime(start_frame, fps),
                duration=otio.opentime.RationalTime(duration_frames, fps),
            ),
        )
        video_track.append(clip)
        current_timeline_time = cut.timeline_end

    # Add audio soundtrack track
    total_audio_sec = timeline.cuts[-1].timeline_end if timeline.cuts else 60.0
    audio_duration_frames = max(1, int(round(total_audio_sec * fps)))
    audio_resolved = Path(timeline.target_audio).resolve().as_posix()

    audio_clip = otio.schema.Clip(
        name=Path(timeline.target_audio).stem,
        media_reference=otio.schema.ExternalReference(
            target_url=f"file://{audio_resolved}",
            available_range=otio.opentime.TimeRange(
                start_time=otio.opentime.RationalTime(0, fps),
                duration=otio.opentime.RationalTime(audio_duration_frames, fps),
            ),
        ),
        source_range=otio.opentime.TimeRange(
            start_time=otio.opentime.RationalTime(0, fps),
            duration=otio.opentime.RationalTime(audio_duration_frames, fps),
        ),
    )
    audio_track.append(audio_clip)

    otio_timeline.tracks.append(video_track)
    otio_timeline.tracks.append(audio_track)

    otio.adapters.write_to_file(otio_timeline, str(output_path))
    return output_path


def export_fcpxml(
    timeline: Timeline,
    output_path: str | Path,
    fps: float = 24.0,
    width: int = 1920,
    height: int = 1080,
) -> Path:
    """
    Exports timeline into Apple Final Cut Pro XML (FCPXML v1.9) format.
    Fully compatible with Final Cut Pro and DaVinci Resolve.
    """
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    root = ET.Element("fcpxml", version="1.9")
    resources = ET.SubElement(root, "resources")

    fps_round = int(round(fps)) if fps else 24
    ET.SubElement(
        resources,
        "format",
        id="r1",
        name=f"FFVideoFormat{height}p{fps_round}",
        frameDuration=f"1/{fps_round}s",
        width=str(width),
        height=str(height),
    )

    source_to_asset_id = {}
    asset_counter = 2

    # Video resources
    for cut in timeline.cuts:
        src = str(Path(cut.source_file).resolve())
        if src not in source_to_asset_id:
            asset_id = f"r{asset_counter}"
            asset_counter += 1
            source_to_asset_id[src] = asset_id
            ET.SubElement(
                resources,
                "asset",
                id=asset_id,
                name=Path(src).name,
                src=f"file://{src}",
                hasVideo="1",
                hasAudio="1",
                format="r1",
            )

    # Audio resource
    audio_path = str(Path(timeline.target_audio).resolve())
    audio_asset_id = f"r{asset_counter}"
    source_to_asset_id[audio_path] = audio_asset_id
    total_duration = timeline.cuts[-1].timeline_end if timeline.cuts else 0.0
    ET.SubElement(
        resources,
        "asset",
        id=audio_asset_id,
        name=Path(audio_path).name,
        src=f"file://{audio_path}",
        hasAudio="1",
    )

    library = ET.SubElement(root, "library")
    event = ET.SubElement(library, "event", name=timeline.project_title)
    project = ET.SubElement(event, "project", name=timeline.project_title)
    sequence = ET.SubElement(
        project,
        "sequence",
        format="r1",
        duration=f"{total_duration:.4f}s",
    )
    spine = ET.SubElement(sequence, "spine")

    for i, cut in enumerate(timeline.cuts):
        cut_duration = cut.timeline_end - cut.timeline_start
        clip_elem = ET.SubElement(
            spine,
            "asset-clip",
            ref=source_to_asset_id[str(Path(cut.source_file).resolve())],
            name=Path(cut.source_file).stem,
            offset=f"{cut.timeline_start:.4f}s",
            start=f"{cut.source_in:.4f}s",
            duration=f"{cut_duration:.4f}s",
            format="r1",
        )
        if i == 0:
            # Secondary audio track attached to first spine cut with lane=-1
            ET.SubElement(
                clip_elem,
                "asset-clip",
                ref=audio_asset_id,
                name=Path(audio_path).stem,
                lane="-1",
                offset=f"{cut.timeline_start:.4f}s",
                start="0s",
                duration=f"{total_duration:.4f}s",
            )

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ", level=0)
    tree.write(str(output_path), encoding="utf-8", xml_declaration=True)
    return output_path


def export_project(
    timeline: Timeline,
    output_path: str | Path,
    format: str = "auto",
    fps: float = 24.0,
    width: int = 1920,
    height: int = 1080,
) -> Path:
    """
    Exports timeline into an NLE interchange format (OpenTimelineIO or FCPXML).
    Auto-detects format from extension if format='auto'.
    """
    output_path = Path(output_path).resolve()
    fmt = format.lower()
    if fmt == "auto":
        suffix = output_path.suffix.lower()
        if suffix in (".fcpxml", ".xml"):
            fmt = "fcpxml"
        else:
            fmt = "otio"

    if fmt == "fcpxml":
        return export_fcpxml(timeline, output_path, fps=fps, width=width, height=height)
    elif fmt == "otio":
        return export_otio(timeline, output_path, fps=fps)
    else:
        raise ValueError(f"Unsupported export format: {format}. Supported: 'otio', 'fcpxml'")
