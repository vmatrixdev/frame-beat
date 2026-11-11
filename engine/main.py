"""
AMV Maker Engine CLI Entrypoint.
Provides JSON-first stdout commands for desktop sidecar integration and direct CLI usage.
"""

from pathlib import Path
from typing import Optional
import typer
from rich.console import Console

from engine.audio_analyzer import analyze_audio
from engine.visual_analyzer import analyze_directory, analyze_video
from engine.director import direct_amv
from engine.stitcher import render_ffmpeg, export_otio
from engine.models import BeatsData, ScenesCatalog, Timeline

app = typer.Typer(help="AMV Maker Engine - Media analysis, Director, and Stitcher")
console = Console()


@app.command()
def analyze_soundtrack(
    audio_path: Path = typer.Argument(..., help="Path to audio file (mp3, wav, flac)"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write beats.json"),
):
    """Analyze audio track for BPM, beats, downbeats, and energy curves."""
    beats = analyze_audio(audio_path)
    result_json = beats.model_dump_json(indent=2)
    if output:
        output.write_text(result_json)
        console.print(f"[green]Saved beat markers to {output}[/green]")
    else:
        typer.echo(result_json)


@app.command()
def analyze_scenes(
    video_dir: Path = typer.Argument(..., help="Directory with source video clips"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write scenes.json"),
    thumbnail_dir: Path = typer.Option("cache/thumbnails", "--thumbs", help="Directory for thumbnail keyframes"),
):
    """Detect visual scene cuts and extract keyframes and metrics."""
    catalog = analyze_directory(video_dir, output_thumbnail_dir=thumbnail_dir)
    result_json = catalog.model_dump_json(indent=2)
    if output:
        output.write_text(result_json)
        console.print(f"[green]Saved scenes catalog to {output}[/green]")
    else:
        typer.echo(result_json)


@app.command()
def direct(
    beats_file: Path = typer.Option(..., "--beats", "-b", help="Path to beats.json"),
    scenes_file: Path = typer.Option(..., "--scenes", "-s", help="Path to scenes.json"),
    prompt: str = typer.Option(..., "--prompt", "-p", help="Creative directive for the AMV"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write timeline.json"),
    project_title: str = typer.Option("AMV Project", "--title", help="Project Title"),
):
    """Direct an AMV timeline using Gemini structured output."""
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
        output.write_text(result_json)
        console.print(f"[green]Saved timeline to {output}[/green]")
    else:
        typer.echo(result_json)


@app.command()
def render(
    timeline_file: Path = typer.Argument(..., help="Path to timeline.json"),
    output: Path = typer.Option(Path("export/amv_final.mp4"), "--output", "-o", help="Path for rendered MP4"),
):
    """Stitch timeline cuts deterministically using FFmpeg."""
    timeline = Timeline.model_validate_json(timeline_file.read_text())
    out_file = render_ffmpeg(timeline, output)
    console.print(f"[bold green]Render completed: {out_file}[/bold green]")


@app.command()
def export_project(
    timeline_file: Path = typer.Argument(..., help="Path to timeline.json"),
    output: Path = typer.Option(Path("export/amv_project.otio"), "--output", "-o", help="Path for OpenTimelineIO file"),
):
    """Export timeline cuts to OpenTimelineIO (.otio) format."""
    timeline = Timeline.model_validate_json(timeline_file.read_text())
    out_file = export_otio(timeline, output)
    console.print(f"[bold green]Exported OTIO project: {out_file}[/bold green]")


if __name__ == "__main__":
    app()
