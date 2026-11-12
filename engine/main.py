"""
AMV Maker Engine CLI Entrypoint.
Provides JSON-first stdout commands for desktop sidecar integration and direct CLI usage.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Optional

# Ensure project root is on sys.path for direct script execution
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import typer
from rich.console import Console

from engine.audio_analyzer import analyze_audio
from engine.visual_analyzer import analyze_directory
from engine.director import direct_amv, load_dotenv_if_present
from engine.stitcher import render_ffmpeg, export_project, RenderProgress
from engine.models import BeatsData, ScenesCatalog, Timeline

# Auto-load environment variables from .env if present
load_dotenv_if_present()

app = typer.Typer(help="AMV Maker Engine - Media analysis, Director, and Stitcher")
console = Console()


@app.command(name="analyze-soundtrack")
def analyze_soundtrack(
    audio_path: Path = typer.Argument(..., help="Path to audio file (mp3, wav, flac)"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write beats.json"),
):
    """Analyze audio track for BPM, beats, downbeats, and energy curves."""
    try:
        beats = analyze_audio(audio_path)
        result_json = beats.model_dump_json(indent=2)
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(result_json)
            console.print(f"[green]Saved beat markers to {output}[/green]")
        else:
            typer.echo(result_json)
    except Exception as err:
        console.print(f"[bold red]Error analyzing audio: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


@app.command(name="analyze-scenes")
def analyze_scenes(
    video_dir: Path = typer.Argument(..., help="Directory with source video clips"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write scenes.json"),
    thumbnail_dir: Path = typer.Option(Path("cache/thumbnails"), "--thumbs", help="Directory for thumbnail keyframes"),
):
    """Detect visual scene cuts and extract keyframes and metrics."""
    try:
        catalog = analyze_directory(video_dir, output_thumbnail_dir=thumbnail_dir)
        result_json = catalog.model_dump_json(indent=2)
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(result_json)
            console.print(f"[green]Saved scenes catalog to {output}[/green]")
        else:
            typer.echo(result_json)
    except Exception as err:
        console.print(f"[bold red]Error analyzing scenes: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


@app.command(name="direct")
def direct(
    beats_file: Path = typer.Option(..., "--beats", "-b", help="Path to beats.json"),
    scenes_file: Path = typer.Option(..., "--scenes", "-s", help="Path to scenes.json"),
    prompt: str = typer.Option(..., "--prompt", "-p", help="Creative directive for the AMV"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write timeline.json"),
    project_title: str = typer.Option("AMV Project", "--title", help="Project Title"),
):
    """Direct an AMV timeline using Gemini structured output."""
    try:
        if not beats_file.exists():
            raise FileNotFoundError(f"Beats file not found: {beats_file}")
        if not scenes_file.exists():
            raise FileNotFoundError(f"Scenes file not found: {scenes_file}")

        beats = BeatsData.model_validate_json(beats_file.read_text())
        scenes = ScenesCatalog.model_validate_json(scenes_file.read_text())

        timeline = direct_amv(
            beats=beats,
            catalog=scenes,
            user_prompt=prompt,
            project_title=project_title,
        )

        result_json = timeline.model_dump_json(indent=2)
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(result_json)
            console.print(f"[green]Saved timeline to {output}[/green]")
        else:
            typer.echo(result_json)
    except Exception as err:
        console.print(f"[bold red]Error directing AMV: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


@app.command(name="render")
def render(
    timeline_file: Path = typer.Argument(..., help="Path to timeline.json"),
    output: Path = typer.Option(Path("export/amv_final.mp4"), "--output", "-o", help="Path for rendered MP4"),
    codec: Optional[str] = typer.Option(None, "--codec", "-c", help="Video codec: 'libx264', 'h264_videotoolbox', or 'auto'"),
    hwaccel: bool = typer.Option(True, "--hwaccel/--no-hwaccel", help="Enable hardware acceleration (VideoToolbox on macOS)"),
    preset: str = typer.Option("fast", "--preset", help="Encoding preset for libx264 software encoder"),
    resolution: str = typer.Option("1920x1080", "--resolution", "-r", help="Target resolution WxH (e.g. 1920x1080)"),
    fps: float = typer.Option(24.0, "--fps", help="Output frame rate"),
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output for IPC/Tauri integration"),
):
    """Stitch timeline cuts deterministically using FFmpeg filter complex."""
    try:
        if not timeline_file.exists():
            raise FileNotFoundError(f"Timeline file not found: {timeline_file}")

        timeline = Timeline.model_validate_json(timeline_file.read_text())

        try:
            w_str, h_str = resolution.lower().split("x")
            res = (int(w_str), int(h_str))
        except Exception:
            res = (1920, 1080)

        def _on_progress(prog: RenderProgress) -> None:
            if json_output:
                msg = {
                    "type": "progress",
                    "percent": round(prog.percent, 2),
                    "currentTime": round(prog.current_time_sec, 2),
                    "totalTime": round(prog.total_time_sec, 2),
                    "fps": round(prog.fps, 1),
                    "speed": prog.speed,
                    "frame": prog.frame,
                }
                typer.echo(json.dumps(msg))

        out_file = render_ffmpeg(
            timeline=timeline,
            output_path=output,
            preset=preset,
            codec=codec,
            hwaccel=hwaccel,
            resolution=res,
            fps=fps,
            progress_callback=_on_progress,
        )

        total_dur = timeline.cuts[-1].timeline_end if timeline.cuts else 0.0
        if json_output:
            typer.echo(
                json.dumps(
                    {
                        "type": "completed",
                        "status": "success",
                        "outputPath": str(out_file.resolve()),
                        "duration": round(total_dur, 3),
                    }
                )
            )
        else:
            console.print(f"[bold green]Render completed: {out_file}[/bold green]")

    except Exception as err:
        if json_output:
            typer.echo(json.dumps({"type": "error", "status": "failed", "error": str(err)}))
        else:
            console.print(f"[bold red]Render failed: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


@app.command(name="export-project")
def export_project_cmd(
    timeline_file: Path = typer.Argument(..., help="Path to timeline.json"),
    output: Path = typer.Option(Path("export/amv_project.otio"), "--output", "-o", help="Path for project file (.otio or .fcpxml)"),
    format: str = typer.Option("auto", "--format", "-f", help="Export format: 'otio', 'fcpxml', or 'auto'"),
    fps: float = typer.Option(24.0, "--fps", help="Output frame rate"),
    resolution: str = typer.Option("1920x1080", "--resolution", "-r", help="Target resolution WxH"),
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output for IPC/Tauri integration"),
):
    """Export timeline cuts to OpenTimelineIO (.otio) or Final Cut Pro XML (.fcpxml) format."""
    try:
        if not timeline_file.exists():
            raise FileNotFoundError(f"Timeline file not found: {timeline_file}")

        timeline = Timeline.model_validate_json(timeline_file.read_text())

        try:
            w_str, h_str = resolution.lower().split("x")
            width, height = int(w_str), int(h_str)
        except Exception:
            width, height = 1920, 1080

        out_file = export_project(
            timeline=timeline,
            output_path=output,
            format=format,
            fps=fps,
            width=width,
            height=height,
        )

        detected_format = "fcpxml" if out_file.suffix.lower() in (".fcpxml", ".xml") else "otio"
        if json_output:
            typer.echo(
                json.dumps(
                    {
                        "type": "completed",
                        "status": "success",
                        "outputPath": str(out_file.resolve()),
                        "format": detected_format,
                    }
                )
            )
        else:
            console.print(f"[bold green]Exported project: {out_file} ({detected_format})[/bold green]")

    except Exception as err:
        if json_output:
            typer.echo(json.dumps({"type": "error", "status": "failed", "error": str(err)}))
        else:
            console.print(f"[bold red]Export failed: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
