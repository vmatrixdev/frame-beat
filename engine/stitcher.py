"""
Stitcher & Exporter for AMV Maker.
Deterministic cut-to-cut concatenation using FFmpeg and project export to OpenTimelineIO.
"""

from pathlib import Path
import ffmpeg
import opentimelineio as otio

from engine.models import Timeline


def render_ffmpeg(timeline: Timeline, output_path: str | Path, preset: str = "fast") -> Path:
    """
    Renders the timeline into a single MP4 video file using FFmpeg filter complex.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    video_streams = []

    for cut in timeline.cuts:
        in_point = cut.source_in
        duration = cut.timeline_end - cut.timeline_start

        # Input video trimmed accurately
        v_stream = (
            ffmpeg.input(cut.source_file, ss=in_point, t=duration)
            .filter("setpts", "PTS-STARTPTS")
            .filter("scale", 1920, 1080, force_original_aspect_ratio="decrease")
            .filter("pad", 1920, 1080, "(ow-iw)/2", "(oh-ih)/2")
        )
        video_streams.append(v_stream)

    # Concat all video clips
    concatenated_video = ffmpeg.concat(*video_streams, v=1, a=0)

    # Audio soundtrack
    audio_stream = ffmpeg.input(timeline.target_audio)

    # Combine video and audio
    pipeline = ffmpeg.output(
        concatenated_video,
        audio_stream,
        str(output_path),
        vcodec="libx264",
        acodec="aac",
        pix_fmt="yuv420p",
        preset=preset,
        shortest=None,
    ).overwrite_output()

    pipeline.run(capture_stdout=True, capture_stderr=True)
    return output_path


def export_otio(timeline: Timeline, output_path: str | Path) -> Path:
    """
    Exports timeline into OpenTimelineIO (.otio) format for DaVinci Resolve or Final Cut Pro.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    otio_timeline = otio.schema.Timeline(name=timeline.project_title)
    video_track = otio.schema.Track(name="Video Track", kind=otio.schema.TrackKind.Video)
    audio_track = otio.schema.Track(name="Audio Track", kind=otio.schema.TrackKind.Audio)

    fps = 24.0

    # Add video clips
    for cut in timeline.cuts:
        duration_frames = int(round((cut.source_out - cut.source_in) * fps))
        start_frame = int(round(cut.source_in * fps))

        media_reference = otio.schema.ExternalReference(
            target_url=f"file://{cut.source_file}",
            available_range=otio.opentime.TimeRange(
                start_time=otio.opentime.RationalTime(0, fps),
                duration=otio.opentime.RationalTime(duration_frames + start_frame, fps),
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

    # Add audio track
    audio_duration_frames = int(round((timeline.cuts[-1].timeline_end if timeline.cuts else 60.0) * fps))
    audio_clip = otio.schema.Clip(
        name=Path(timeline.target_audio).stem,
        media_reference=otio.schema.ExternalReference(
            target_url=f"file://{timeline.target_audio}",
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
