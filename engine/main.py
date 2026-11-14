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
from engine.visual_analyzer import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    analyze_directory,
    analyze_image,
    analyze_single_segment,
    analyze_video,
)
from engine.director import direct_amv, load_dotenv_if_present, shortlist_clips_for_segment
from engine.stitcher import render_ffmpeg, export_project, RenderProgress
from engine.models import AudioCueNote, BeatsData, ScenesCatalog, Timeline

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
    video_dir: Path = typer.Argument(..., help="Directory or single media file with source video/image"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write scenes.json"),
    thumbnail_dir: Path = typer.Option(Path("cache/thumbnails"), "--thumbs", help="Directory for thumbnail keyframes"),
    detector_threshold: float = typer.Option(27.0, "--threshold", help="PySceneDetect ContentDetector threshold"),
    max_scene_duration: float = typer.Option(5.5, "--max-scene-duration", help="Subdivide scenes longer than this (seconds)"),
    target_window_duration: float = typer.Option(3.5, "--target-window-duration", help="Target highlight window duration (seconds)"),
    min_window_duration: float = typer.Option(2.0, "--min-window-duration", help="Minimum highlight window duration (seconds)"),
    embed_semantics: bool = typer.Option(True, "--embed-semantics/--no-embed-semantics", help="Embed sampled frames in memory with SigLIP when available"),
    cache_dir: Optional[Path] = typer.Option(None, "--cache-dir", help="Cache directory for SigLIP embeddings"),
    stream: bool = typer.Option(False, "--stream", help="Emit progressive NDJSON updates per file"),
):
    """Detect visual scene cuts and extract keyframes and metrics."""
    try:
        if stream:
            if not video_dir.exists():
                raise FileNotFoundError(f"Media path not found: {video_dir}")
            media_extensions = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS
            media_files = (
                [video_dir]
                if video_dir.is_file()
                else sorted(f for f in video_dir.iterdir() if f.suffix.lower() in media_extensions)
            )
            resolved_files = [str(f.resolve()) for f in media_files]
            sys.stdout.write(json.dumps({"event": "discovered", "source_files": resolved_files}) + "\n")
            sys.stdout.flush()

            all_scenes = []
            global_scene_id = 0
            for m_file in media_files:
                if m_file.suffix.lower() in IMAGE_EXTENSIONS:
                    cut = analyze_image(m_file, output_thumbnail_dir=thumbnail_dir)
                    cuts = [cut]
                else:
                    cuts = analyze_video(
                        m_file,
                        output_thumbnail_dir=thumbnail_dir,
                        detector_threshold=detector_threshold,
                        max_scene_duration=max_scene_duration,
                        target_window_duration=target_window_duration,
                        min_window_duration=min_window_duration,
                        embed_semantics=embed_semantics,
                        semantic_cache_dir=cache_dir,
                    )
                for c in cuts:
                    c.scene_id = global_scene_id
                    global_scene_id += 1
                    all_scenes.append(c)
                sys.stdout.write(
                    json.dumps(
                        {
                            "event": "file_done",
                            "source_file": str(m_file.resolve()),
                            "scenes": [c.model_dump() for c in cuts],
                        }
                    )
                    + "\n"
                )
                sys.stdout.flush()

            catalog = ScenesCatalog(
                source_files=resolved_files,
                total_scenes=len(all_scenes),
                scenes=all_scenes,
            )
            sys.stdout.write(json.dumps({"event": "complete", "catalog": catalog.model_dump()}) + "\n")
            sys.stdout.flush()
            return

        if video_dir.is_file():
            if video_dir.suffix.lower() in IMAGE_EXTENSIONS:
                cut = analyze_image(video_dir, output_thumbnail_dir=thumbnail_dir)
                cuts = [cut]
            else:
                cuts = analyze_video(
                    video_dir,
                    output_thumbnail_dir=thumbnail_dir,
                    detector_threshold=detector_threshold,
                    max_scene_duration=max_scene_duration,
                    target_window_duration=target_window_duration,
                    min_window_duration=min_window_duration,
                    embed_semantics=embed_semantics,
                    semantic_cache_dir=cache_dir,
                )
            catalog = ScenesCatalog(
                source_files=[str(video_dir.resolve())],
                total_scenes=len(cuts),
                scenes=cuts,
            )
        else:
            catalog = analyze_directory(
                video_dir,
                output_thumbnail_dir=thumbnail_dir,
                detector_threshold=detector_threshold,
                max_scene_duration=max_scene_duration,
                target_window_duration=target_window_duration,
                min_window_duration=min_window_duration,
                embed_semantics=embed_semantics,
                semantic_cache_dir=cache_dir,
            )
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


@app.command(name="analyze-segment")
def analyze_segment(
    source_path: Path = typer.Argument(..., help="Path to source video or image file"),
    start_time: float = typer.Option(0.0, "--start", help="Segment start time in seconds"),
    end_time: float = typer.Option(0.0, "--end", help="Segment end time in seconds (0 = full)"),
    sample_frames: int = typer.Option(5, "--samples", help="Number of frames to sample for face/emotion"),
    scene_id: int = typer.Option(0, "--scene-id", help="Scene ID to assign"),
    thumbnail_dir: Path = typer.Option(Path("cache/thumbnails"), "--thumbs", help="Directory for thumbnail keyframes"),
):
    """Run static visual + MediaPipe face/emotion analysis on a single asset or custom segment."""
    try:
        cut = analyze_single_segment(
            source_path=source_path,
            start_time=start_time,
            end_time=end_time,
            sample_frames=sample_frames,
            output_thumbnail_dir=thumbnail_dir,
            scene_id=scene_id,
        )
        typer.echo(cut.model_dump_json(indent=2))
    except Exception as err:
        console.print(f"[bold red]Error analyzing segment: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


@app.command(name="direct")
def direct(
    beats_file: Path = typer.Option(..., "--beats", "-b", help="Path to beats.json"),
    scenes_file: Path = typer.Option(..., "--scenes", "-s", help="Path to scenes.json"),
    prompt: str = typer.Option(..., "--prompt", "-p", help="Creative directive for the AMV"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write timeline.json"),
    project_title: str = typer.Option("AMV Project", "--title", help="Project Title"),
    target_audio: str = typer.Option("soundtrack.wav", "--audio", help="Target audio path/filename"),
):
    """Direct a beat-synchronized music video or photo/video montage timeline using Gemini or offline fallback."""
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
            target_audio=target_audio,
        )

        result_json = timeline.model_dump_json(indent=2)
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(result_json)
            console.print(f"[green]Saved timeline to {output}[/green]")
        else:
            typer.echo(result_json)
    except Exception as err:
        console.print(f"[bold red]Error directing timeline: {err}[/bold red]", file=sys.stderr)
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


@app.command(name="shortlist-clips")
def shortlist_clips(
    beats_file: Path = typer.Option(..., "--beats", help="Path to beats.json"),
    scenes_file: Path = typer.Option(..., "--scenes", help="Path to scenes.json"),
    start_ms: int = typer.Option(..., "--start-ms", help="Segment start timestamp in milliseconds"),
    end_ms: int = typer.Option(..., "--end-ms", help="Segment end timestamp in milliseconds"),
    cue_note_file: Optional[Path] = typer.Option(None, "--cue-note-file", help="Optional JSON file containing AudioCueNote"),
    limit: int = typer.Option(8, "--limit", help="Maximum number of shortlisted candidates"),
    offline: bool = typer.Option(False, "--offline", help="Force deterministic offline shortlister"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write shortlist JSON"),
):
    """Shortlist best-matching indexed clips for a specific audio segment [start_ms, end_ms]."""
    try:
        beats = BeatsData.model_validate_json(beats_file.read_text(encoding="utf-8"))
        catalog = ScenesCatalog.model_validate_json(scenes_file.read_text(encoding="utf-8"))
        cue_note = (
            AudioCueNote.model_validate_json(cue_note_file.read_text(encoding="utf-8"))
            if cue_note_file and cue_note_file.exists()
            else None
        )
        shortlist = shortlist_clips_for_segment(
            beats=beats,
            catalog=catalog,
            start_ms=start_ms,
            end_ms=end_ms,
            cue_note=cue_note,
            limit=limit,
            force_fallback=offline,
        )
        result_json = shortlist.model_dump_json(indent=2)
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(result_json, encoding="utf-8")
        else:
            typer.echo(result_json)
    except Exception as err:
        console.print(f"[bold red]Shortlist failed: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


@app.command(name="index-semantics")
def index_semantics(
    scenes_file: Path = typer.Option(..., "--scenes", help="Path to scenes.json"),
    cache_dir: Optional[Path] = typer.Option(None, "--cache-dir", help="Cache directory for SigLIP embeddings"),
    force: bool = typer.Option(False, "--force", help="Recompute all SigLIP embeddings"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Path to write updated scenes.json"),
):
    """Run local SigLIP vision-language indexing on scene keyframes to populate semantic_tags & vibe_scores."""
    try:
        from engine.semantic_indexer import index_catalog_semantics

        catalog = ScenesCatalog.model_validate_json(scenes_file.read_text(encoding="utf-8"))
        updated = index_catalog_semantics(catalog, cache_dir=cache_dir, force_recompute=force)
        result_json = updated.model_dump_json(indent=2)
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(result_json, encoding="utf-8")
        else:
            typer.echo(result_json)
    except Exception as err:
        console.print(f"[bold red]Semantic indexing failed: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


@app.command(name="semantic-search")
def semantic_search_cmd(
    scenes_file: Path = typer.Option(..., "--scenes", help="Path to scenes.json"),
    query: str = typer.Option(..., "--query", "-q", help="Natural-language vibe/action/expression query"),
    cache_dir: Optional[Path] = typer.Option(None, "--cache-dir", help="Cache directory for SigLIP embeddings"),
    top_k: int = typer.Option(20, "--top-k", help="Maximum number of results"),
):
    """Search indexed scenes using local SigLIP text-to-image similarity."""
    try:
        from engine.semantic_indexer import semantic_search_scenes

        catalog = ScenesCatalog.model_validate_json(scenes_file.read_text(encoding="utf-8"))
        hits = semantic_search_scenes(catalog, query_text=query, cache_dir=cache_dir, top_k=top_k)
        typer.echo(
            json.dumps(
                {
                    "query": query,
                    "results": [{"scene_id": sid, "score": sc} for sid, sc in hits],
                },
                indent=2,
            )
        )
    except Exception as err:
        console.print(f"[bold red]Semantic search failed: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


@app.command(name="search-clips")
def search_clips_cmd(
    scenes_file: Path = typer.Option(..., "--scenes", help="Path to scenes.json"),
    query_file: Optional[Path] = typer.Option(None, "--query-file", help="Path to ClipSearchQuery JSON"),
    query_text: Optional[str] = typer.Option(None, "--query", "-q", help="Natural-language vibe/text query"),
    cache_dir: Optional[Path] = typer.Option(None, "--cache-dir", help="Cache directory for SigLIP embeddings"),
    limit: int = typer.Option(50, "--limit", help="Maximum number of results"),
):
    """Unified clip search & filter endpoint shared by the UI and AI agent tool calls."""
    try:
        from engine.clip_search import search_scenes_from_query
        from engine.models import ClipSearchQuery

        catalog = ScenesCatalog.model_validate_json(scenes_file.read_text(encoding="utf-8"))
        if query_file and query_file.exists():
            query_obj = ClipSearchQuery.model_validate_json(query_file.read_text(encoding="utf-8"))
        else:
            query_obj = ClipSearchQuery(query_text=query_text, limit=limit)

        results = search_scenes_from_query(catalog, query_obj, cache_dir=cache_dir)
        typer.echo(
            json.dumps(
                {
                    "results": results,
                    "total_matched": len(results),
                    "total_catalog": len(catalog.scenes),
                },
                indent=2,
            )
        )
    except Exception as err:
        console.print(f"[bold red]Clip search failed: {err}[/bold red]", file=sys.stderr)
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
