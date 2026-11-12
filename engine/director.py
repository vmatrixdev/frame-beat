"""
LLM Director for AMV Maker.
Uses Gemini Flash with structured output to orchestrate cuts against musical beats and scenes,
with a deterministic fallback director for offline execution and testing.
"""

from __future__ import annotations
import json
import logging
import os
from pathlib import Path
from typing import List, Optional

from engine.models import BeatsData, ScenesCatalog, Timeline, TimelineCut

logger = logging.getLogger(__name__)


def load_dotenv_if_present() -> None:
    """Loads environment variables from .env if present in CWD or project root."""
    candidate_paths = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]
    for env_path in candidate_paths:
        if env_path.is_file():
            try:
                for line in env_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("'\"")
                    if key and key not in os.environ:
                        os.environ[key] = val
            except Exception as e:
                logger.debug(f"Failed to read .env from {env_path}: {e}")
            break

DIRECTOR_SYSTEM_INSTRUCTION = """
You are the AI Director for an Anime Music Video (AMV) Maker.
Your task is to craft a dramatic, tightly paced timeline by aligning visual cuts with musical beats and dynamic energy.

Rules:
1. Always align cuts to detected beats or downbeats in beats.json.
2. High energy music segments (chorus, drops) should feature fast-paced, high sharpness, dynamic scenes.
3. Lower energy segments (intro, outro, verses) should hold longer scenes or emotional cuts.
4. Transitions must be one of: "cut", "crossfade", "flash_white", "zoom_in", "whip_pan".
5. Every cut's timeline_start and timeline_end must seamlessly cover the song from 0.0 to the target duration.
6. The source clip duration (source_out - source_in) must equal (timeline_end - timeline_start).
"""


def direct_amv_deterministic(
    beats: BeatsData,
    catalog: ScenesCatalog,
    user_prompt: str = "",
    project_title: str = "AMV Project",
    target_audio: str = "soundtrack.wav",
) -> Timeline:
    """
    Offline deterministic director: aligns cuts to downbeats and energy profiles.
    Guarantees seamless timeline coverage and accurate source-to-timeline duration mapping.
    """
    if not catalog.scenes:
        raise ValueError("Cannot direct AMV: ScenesCatalog contains no scenes.")

    duration_sec = beats.duration_sec
    if duration_sec <= 0:
        raise ValueError("Cannot direct AMV: Audio duration must be greater than 0.")

    # Collect cut boundary points on the timeline
    cut_points: List[float] = [0.0]

    # Prefer downbeats for cut boundaries
    valid_downbeats = [db for db in beats.downbeats if 0.05 < db < (duration_sec - 0.2)]

    if valid_downbeats:
        cut_points.extend(valid_downbeats)
    elif beats.beats:
        # Fallback to every 4th beat
        step = 4 if len(beats.beats) >= 4 else 1
        for i in range(0, len(beats.beats), step):
            b_t = beats.beats[i]
            if 0.05 < b_t < (duration_sec - 0.2):
                cut_points.append(b_t)
    else:
        # Fallback to 2-second pacing intervals
        interval = 2.0
        cur_t = interval
        while cur_t < (duration_sec - 0.2):
            cut_points.append(cur_t)
            cur_t += interval

    cut_points.append(duration_sec)
    cut_points = sorted(list(set([round(p, 3) for p in cut_points])))

    # Segregate scenes by sharpness for energy-responsive selection
    scenes_by_sharpness = sorted(
        catalog.scenes,
        key=lambda s: s.sharpness_score if s.sharpness_score is not None else 0.0,
        reverse=True,
    )

    cuts: List[TimelineCut] = []
    scene_idx = 0

    for i in range(len(cut_points) - 1):
        t_start = cut_points[i]
        t_end = cut_points[i + 1]
        cut_duration = round(t_end - t_start, 3)

        if cut_duration <= 0:
            continue

        # Determine energy level for this segment
        mid_time = t_start + (cut_duration / 2.0)
        segment_level = "medium"
        for seg in beats.energy_segments:
            if seg.start <= mid_time <= seg.end:
                segment_level = seg.level
                break

        # Select scene based on energy level
        if segment_level in ("high", "drop") and len(scenes_by_sharpness) > 1:
            chosen_scene = scenes_by_sharpness[scene_idx % len(scenes_by_sharpness)]
            transition = "flash_white" if segment_level == "drop" else "cut"
        elif segment_level in ("low", "intro", "outro"):
            chosen_scene = catalog.scenes[scene_idx % len(catalog.scenes)]
            transition = "crossfade" if i > 0 else "cut"
        else:
            chosen_scene = catalog.scenes[scene_idx % len(catalog.scenes)]
            transition = "cut"

        scene_idx += 1

        source_in = chosen_scene.start_time
        source_out = round(source_in + cut_duration, 3)

        cuts.append(
            TimelineCut(
                source_file=chosen_scene.source_file,
                source_in=round(source_in, 3),
                source_out=round(source_out, 3),
                timeline_start=round(t_start, 3),
                timeline_end=round(t_end, 3),
                transition=transition,
                pacing_beat_interval=4,
            )
        )

    return Timeline(
        project_title=project_title,
        target_audio=target_audio,
        cuts=cuts,
    )


def direct_amv(
    beats: BeatsData,
    catalog: ScenesCatalog,
    user_prompt: str,
    project_title: str = "AMV Project",
    api_key: Optional[str] = None,
    model: str = "gemini-2.0-flash",
    target_audio: str = "soundtrack.wav",
    force_fallback: bool = False,
) -> Timeline:
    """
    Calls Gemini structured output API to generate an AMV cut timeline.
    If GEMINI_API_KEY is not set or API call fails, falls back to deterministic offline director.
    """
    load_dotenv_if_present()
    key = api_key or os.environ.get("GEMINI_API_KEY")

    if force_fallback or not key:
        logger.info("GEMINI_API_KEY not configured or offline mode requested. Using deterministic director.")
        return direct_amv_deterministic(
            beats=beats,
            catalog=catalog,
            user_prompt=user_prompt,
            project_title=project_title,
            target_audio=target_audio,
        )

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=key)

        director_input = {
            "user_creative_brief": user_prompt,
            "music_profile": beats.model_dump(),
            "available_scenes": [
                {
                    "scene_id": s.scene_id,
                    "source_file": s.source_file,
                    "duration": s.duration,
                    "start_time": s.start_time,
                    "end_time": s.end_time,
                    "sharpness": s.sharpness_score,
                    "brightness": s.brightness_score,
                }
                for s in catalog.scenes
            ],
        }

        prompt = (
            f"Create an AMV timeline matching this creative prompt: '{user_prompt}'.\n"
            f"Data:\n{json.dumps(director_input, indent=2)}"
        )

        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=DIRECTOR_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=Timeline,
                temperature=0.4,
            ),
        )

        parsed = json.loads(response.text)
        timeline = Timeline.model_validate(parsed)
        return timeline
    except Exception as e:
        logger.warning(f"Gemini API direct call failed ({e}); falling back to deterministic director.")
        return direct_amv_deterministic(
            beats=beats,
            catalog=catalog,
            user_prompt=user_prompt,
            project_title=project_title,
            target_audio=target_audio,
        )
