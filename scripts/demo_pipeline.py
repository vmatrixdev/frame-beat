#!/usr/bin/env python3
"""
End-to-End Autonomous Pipeline Demo for AMV Maker.
Generates synthetic media, analyzes audio/video, directs cuts, stitches final MP4,
and exports NLE interchange projects (OTIO / FCPXML).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import wave
import cv2
import numpy as np

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Ensure standard binary paths (like Homebrew) are in PATH
for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]:
    if p not in os.environ.get("PATH", "") and Path(p).exists():
        os.environ["PATH"] = f"{p}:{os.environ.get('PATH', '')}"

import ffmpeg
from rich.console import Console
from rich.table import Table

from engine.audio_analyzer import analyze_audio
from engine.visual_analyzer import analyze_directory
from engine.director import direct_amv
from engine.stitcher import (
    render_ffmpeg,
    export_project,
    find_ffmpeg_binary,
    find_ffprobe_binary,
    RenderProgress,
)
from engine.models import BeatsData, ScenesCatalog, Timeline

console = Console()


def generate_demo_audio(output_path: Path, duration_sec: float = 15.0, bpm: float = 128.0, sample_rate: int = 22050) -> Path:
    """Generate a synthetic 128 BPM electronic WAV audio track with intro/drop energy curves."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    num_samples = int(duration_sec * sample_rate)
    samples = np.zeros(num_samples, dtype=np.float32)

    beat_interval = 60.0 / bpm
    decay_sec = 0.12
    decay_samples = int(decay_sec * sample_rate)
    decay_t = np.linspace(0, decay_sec, decay_samples, endpoint=False)

    num_beats = int(duration_sec / beat_interval)
    drop_time = duration_sec * 0.45  # Drop starts at ~45% into track

    for b in range(num_beats):
        beat_t = b * beat_interval
        start_idx = int(beat_t * sample_rate)
        end_idx = min(start_idx + decay_samples, num_samples)
        cur_decay = decay_t[: end_idx - start_idx]

        # Dynamic energy envelope: low in intro verse, high punch after drop
        is_drop = beat_t >= drop_time
        energy_scale = 0.95 if is_drop else 0.40

        is_downbeat = (b % 4 == 0)
        if is_downbeat:
            # Low kick punch: 130Hz
            freq = 130.0 if not is_drop else 110.0
            pulse = energy_scale * 1.3 * np.sin(2 * np.pi * freq * cur_decay) * np.exp(-cur_decay * 22.0)
        else:
            # High click/snare: 750Hz
            freq = 750.0 if not is_drop else 900.0
            pulse = energy_scale * 0.7 * np.sin(2 * np.pi * freq * cur_decay) * np.exp(-cur_decay * 40.0)

        samples[start_idx:end_idx] += pulse

    max_val = np.max(np.abs(samples))
    if max_val > 0:
        samples = (samples / max_val) * 32000.0
    int_samples = samples.astype(np.int16)

    with wave.open(str(output_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int_samples.tobytes())

    return output_path


def generate_demo_video(
    output_path: Path,
    scenes: list[dict],
    fps: float = 24.0,
    width: int = 640,
    height: int = 360,
) -> Path:
    """Generate a synthetic multi-scene MP4 video clip with distinct color scenes and geometric features."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

    try:
        for scene in scenes:
            dur = scene["duration"]
            color = scene["color"]
            label = scene.get("label", "")
            shape = scene.get("shape", "rect")
            num_frames = int(dur * fps)

            for f in range(num_frames):
                frame = np.full((height, width, 3), color, dtype=np.uint8)

                # Draw high-contrast shape to give distinctive sharpness scores
                if shape == "rect":
                    cv2.rectangle(frame, (100, 60), (width - 100, height - 60), (255, 255, 255), 4)
                elif shape == "circle":
                    cv2.circle(frame, (width // 2, height // 2), 80, (255, 255, 255), 4)
                elif shape == "cross":
                    cv2.line(frame, (width // 2, 40), (width // 2, height - 40), (255, 255, 255), 4)
                    cv2.line(frame, (80, height // 2), (width - 80, height // 2), (255, 255, 255), 4)
                elif shape == "grid":
                    for gx in range(60, width, 60):
                        cv2.line(frame, (gx, 0), (gx, height), (220, 220, 220), 2)
                    for gy in range(40, height, 40):
                        cv2.line(frame, (0, gy), (width, gy), (220, 220, 220), 2)

                # Render scene label text
                cv2.putText(
                    frame,
                    f"{label} [{f}/{num_frames}]",
                    (30, height - 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )
                out.write(frame)
    finally:
        out.release()

    return output_path


def main() -> int:
    console.print("[bold cyan]══════════════════════════════════════════════════════════════════════[/bold cyan]")
    console.print("[bold cyan]           AMV Maker: Autonomous Production Pipeline Demo             [/bold cyan]")
    console.print("[bold cyan]══════════════════════════════════════════════════════════════════════[/bold cyan]\n")

    # 1. Setup paths
    demo_assets = PROJECT_ROOT / "demo_assets"
    videos_dir = demo_assets / "videos"
    audio_path = demo_assets / "demo_soundtrack_128bpm.wav"
    export_dir = PROJECT_ROOT / "export"
    cache_thumbs = PROJECT_ROOT / "cache" / "thumbnails"

    demo_assets.mkdir(parents=True, exist_ok=True)
    videos_dir.mkdir(parents=True, exist_ok=True)
    export_dir.mkdir(parents=True, exist_ok=True)
    cache_thumbs.mkdir(parents=True, exist_ok=True)

    # 2. Generate Synthetic Media Assets
    console.print("[bold yellow]Step 1: Generating Synthetic Media in demo_assets/...[/bold yellow]")

    console.print(f"  • Generating 15.0s 128 BPM electronic WAV audio at {audio_path.name}...")
    generate_demo_audio(audio_path, duration_sec=15.0, bpm=128.0)
    console.print("    [green]✓ Audio track generated.[/green]")

    clip1_path = videos_dir / "demo_clip_cyberpunk.mp4"
    clip2_path = videos_dir / "demo_clip_action.mp4"

    console.print(f"  • Generating 10.0s multi-scene video {clip1_path.name} (4 colored scenes)...")
    generate_demo_video(
        clip1_path,
        scenes=[
            {"duration": 2.5, "color": (20, 20, 200), "label": "Scene 1: Neon Crimson", "shape": "rect"},
            {"duration": 2.5, "color": (20, 180, 20), "label": "Scene 2: Cyber Emerald", "shape": "circle"},
            {"duration": 2.5, "color": (190, 20, 20), "label": "Scene 3: Deep Sapphire", "shape": "cross"},
            {"duration": 2.5, "color": (20, 200, 200), "label": "Scene 4: Electric Amber", "shape": "grid"},
        ],
    )
    console.print("    [green]✓ Clip 1 generated.[/green]")

    console.print(f"  • Generating 10.0s multi-scene video {clip2_path.name} (4 colored scenes)...")
    generate_demo_video(
        clip2_path,
        scenes=[
            {"duration": 2.5, "color": (180, 20, 180), "label": "Scene A: Synth Magenta", "shape": "cross"},
            {"duration": 2.5, "color": (190, 190, 20), "label": "Scene B: Laser Cyan", "shape": "grid"},
            {"duration": 2.5, "color": (20, 120, 240), "label": "Scene C: Solar Flare", "shape": "rect"},
            {"duration": 2.5, "color": (10, 220, 90), "label": "Scene D: Acid Green", "shape": "circle"},
        ],
    )
    console.print("    [green]✓ Clip 2 generated.[/green]\n")

    # 3. Audio Analysis
    console.print("[bold yellow]Step 2: Audio Feature Extraction (BPM, Beats, Downbeats, Energy)...[/bold yellow]")
    beats_data = analyze_audio(audio_path)
    beats_json_path = export_dir / "demo_beats.json"
    beats_json_path.write_text(beats_data.model_dump_json(indent=2))
    console.print(f"  • Detected BPM: [bold green]{beats_data.tempo_bpm:.1f}[/bold green]")
    console.print(f"  • Detected Beats: [bold]{len(beats_data.beats)}[/bold] | Downbeats: [bold]{len(beats_data.downbeats)}[/bold]")
    console.print(f"  • Energy Segments: [bold]{len(beats_data.energy_segments)}[/bold]")
    console.print(f"  [green]✓ Saved beats analysis to {beats_json_path.relative_to(PROJECT_ROOT)}[/green]\n")

    # 4. Visual Scene Analysis & Thumbnail Extraction
    console.print("[bold yellow]Step 3: Visual Scene Detection & Keyframe Extraction...[/bold yellow]")
    catalog = analyze_directory(videos_dir, output_thumbnail_dir=cache_thumbs)
    scenes_json_path = export_dir / "demo_scenes.json"
    scenes_json_path.write_text(catalog.model_dump_json(indent=2))
    console.print(f"  • Total Video Files Analyzed: [bold]{len(catalog.source_files)}[/bold]")
    console.print(f"  • Total Visual Scenes Detected: [bold]{len(catalog.scenes)}[/bold]")
    for sc in catalog.scenes[:4]:
        console.print(f"    - [{Path(sc.source_file).name}] {sc.start_time:.2f}s -> {sc.end_time:.2f}s | sharp={sc.sharpness_score:.1f} | bright={sc.brightness_score:.1f}")
    console.print(f"  [green]✓ Saved scenes catalog to {scenes_json_path.relative_to(PROJECT_ROOT)}[/green]\n")

    # 5. AMV Direction
    console.print("[bold yellow]Step 4: AMV Direction & Cut Alignment...[/bold yellow]")
    timeline = direct_amv(
        beats=beats_data,
        catalog=catalog,
        user_prompt="Fast-paced cyberpunk action AMV synchronized with drum kicks and synth drops",
        project_title="Neon Resonance Demo",
        target_audio=str(audio_path),
        force_fallback=True,
    )
    timeline_json_path = export_dir / "demo_timeline.json"
    timeline_json_path.write_text(timeline.model_dump_json(indent=2))
    console.print(f"  • Directed Timeline Cuts: [bold]{len(timeline.cuts)}[/bold]")
    for i, cut in enumerate(timeline.cuts):
        cut_dur = cut.timeline_end - cut.timeline_start
        console.print(f"    [{i+1}] {cut.timeline_start:.2f}s - {cut.timeline_end:.2f}s ({cut_dur:.2f}s) | {Path(cut.source_file).name} ({cut.source_in:.2f}s-{cut.source_out:.2f}s) | {cut.transition}")
    console.print(f"  [green]✓ Saved timeline specification to {timeline_json_path.relative_to(PROJECT_ROOT)}[/green]\n")

    # 6. Render Final AMV with FFmpeg
    console.print("[bold yellow]Step 5: Stitching Final AMV Video using FFmpeg...[/bold yellow]")
    ffmpeg_bin = find_ffmpeg_binary()
    console.print(f"  • Using FFmpeg binary: [cyan]{ffmpeg_bin}[/cyan]")

    rendered_mp4_path = export_dir / "demo_amv.mp4"

    def progress_monitor(p: RenderProgress) -> None:
        if int(p.percent) % 20 == 0 or p.percent >= 99.0:
            console.print(f"    Progress: {p.percent:.1f}% | Time: {p.current_time_sec:.2f}s / {p.total_time_sec:.2f}s | FPS: {p.fps:.1f} | Speed: {p.speed}")

    render_ffmpeg(
        timeline=timeline,
        output_path=rendered_mp4_path,
        resolution=(640, 360),
        fps=24.0,
        preset="ultrafast",
        codec="libx264",
        hwaccel=False,
        progress_callback=progress_monitor,
    )
    console.print(f"  [green]✓ Successfully rendered AMV to {rendered_mp4_path.relative_to(PROJECT_ROOT)} ({rendered_mp4_path.stat().st_size:,} bytes)[/green]\n")

    # 7. Export NLE Projects (OTIO & FCPXML)
    console.print("[bold yellow]Step 6: Exporting NLE Interchange Projects (OTIO / FCPXML)...[/bold yellow]")
    otio_path = export_dir / "demo_project.otio"
    fcpxml_path = export_dir / "demo_project.fcpxml"

    export_project(timeline=timeline, output_path=otio_path, format="otio", fps=24.0, width=640, height=360)
    console.print(f"  [green]✓ Exported OpenTimelineIO project to {otio_path.relative_to(PROJECT_ROOT)}[/green]")

    export_project(timeline=timeline, output_path=fcpxml_path, format="fcpxml", fps=24.0, width=640, height=360)
    console.print(f"  [green]✓ Exported Final Cut Pro XML to {fcpxml_path.relative_to(PROJECT_ROOT)}[/green]\n")

    # 8. Verification with FFprobe
    console.print("[bold yellow]Step 7: Validating Render Output via FFprobe...[/bold yellow]")
    ffprobe_bin = find_ffprobe_binary()
    console.print(f"  • Using FFprobe binary: [cyan]{ffprobe_bin}[/cyan]")

    probe_data = ffmpeg.probe(str(rendered_mp4_path))
    streams = probe_data.get("streams", [])
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]

    if not video_streams:
        console.print("[bold red]Verification Error: No video stream found in rendered MP4![/bold red]", file=sys.stderr)
        return 1
    if not audio_streams:
        console.print("[bold red]Verification Error: No audio stream found in rendered MP4![/bold red]", file=sys.stderr)
        return 1

    v_codec = video_streams[0].get("codec_name", "")
    a_codec = audio_streams[0].get("codec_name", "")
    v_width = video_streams[0].get("width")
    v_height = video_streams[0].get("height")
    dur_str = probe_data.get("format", {}).get("duration", "0")
    total_dur = float(dur_str)

    console.print(f"  • Video Stream: Codec=[bold green]{v_codec}[/bold green], Resolution={v_width}x{v_height}")
    console.print(f"  • Audio Stream: Codec=[bold green]{a_codec}[/bold green], Sample Rate={audio_streams[0].get('sample_rate')}Hz")
    console.print(f"  • Media Duration: [bold]{total_dur:.2f}s[/bold]")

    assert v_codec.lower() in ("h264", "avc1"), f"Expected H.264 video codec, got {v_codec}"
    assert a_codec.lower() == "aac", f"Expected AAC audio codec, got {a_codec}"
    assert total_dur > 0, "Video duration must be greater than 0"

    console.print("  [bold green]✓ Validated H.264 video and AAC audio stream integrity.[/bold green]\n")

    # Summary table
    table = Table(title="AMV Maker Demo Pipeline Execution Summary", style="cyan")
    table.add_column("Pipeline Stage", style="bold white")
    table.add_column("Artifact Output", style="green")
    table.add_column("Details", style="yellow")

    table.add_row("1. Audio Generation", str(audio_path.relative_to(PROJECT_ROOT)), "15.0s @ 128 BPM WAV")
    table.add_row("2. Video Generation", f"{clip1_path.name}, {clip2_path.name}", "2x 10.0s multi-scene MP4 clips")
    table.add_row("3. Beat Analysis", str(beats_json_path.relative_to(PROJECT_ROOT)), f"{len(beats_data.beats)} beats, {len(beats_data.downbeats)} downbeats")
    table.add_row("4. Scene Catalog", str(scenes_json_path.relative_to(PROJECT_ROOT)), f"{len(catalog.scenes)} scenes detected with keyframe thumbs")
    table.add_row("5. Timeline Direction", str(timeline_json_path.relative_to(PROJECT_ROOT)), f"{len(timeline.cuts)} synchronized cuts")
    table.add_row("6. FFmpeg Video Render", str(rendered_mp4_path.relative_to(PROJECT_ROOT)), f"H.264 / AAC 640x360 @ 24fps ({total_dur:.2f}s)")
    table.add_row("7. OpenTimelineIO Export", str(otio_path.relative_to(PROJECT_ROOT)), "Compatible with DaVinci Resolve & Premiere")
    table.add_row("8. FCPXML Export", str(fcpxml_path.relative_to(PROJECT_ROOT)), "Compatible with Final Cut Pro X")

    console.print(table)
    console.print("\n[bold green]🎉 FULL PIPELINE COMPLETED SUCCESSFULLY WITH EXIT CODE 0![/bold green]\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
