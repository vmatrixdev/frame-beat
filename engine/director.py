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
You are an expert AI Music Video & Visual Montage Director.
Your task is to craft an emotionally engaging, rhythmically synchronized video timeline by aligning visual media (photos, video clips) with musical beats, downbeats, and energy curves.

You direct across diverse genres and human storytelling formats, adapting your visual pacing, cut selection, and transitions according to the user's creative directive:
- Life Milestones & Memories: Weddings, children growing up, family anniversaries, memorial tributes.
- Celebrations & Events: Birthdays, graduation ceremonies, holiday parties, banquets.
- Travel & Adventures: Vacation recaps, road trips, landscape explorations, festivals.
- Entertainment & Action: Anime music videos (AMV), gaming montages, sports highlights, dance reels.
- Cinematic & Creative: Narrative trailers, aesthetic visualizers, commercial promos.

Core Directing Rules:
1. Musical Synchronization:
   - Always mathematically align cut boundaries (timeline_start and timeline_end) to detected musical beats or downbeats in beats.json.
   - Respect musical structure: Verse sections generally hold shots for 2 to 4 beats; build-ups accelerate cut frequency; chorus drops or climaxes feature punchy rhythm cuts (1 to 2 beats); intros and outros allow room to breathe.
2. Genre-Aware Transition Selection:
   - Allowed transitions: "cut", "crossfade", "flash_white", "zoom_in", "whip_pan".
   - Emotional / Nostalgic / Romantic (Weddings, Family, Milestones, Memorials): Favor gentle "crossfade" (dissolves) and clean "cut" transitions. Avoid aggressive "flash_white" or rapid whip pans unless the music features an upbeat crescendo.
   - Dynamic / Upbeat / Action (Parties, AMVs, Sports, Travel): Use energetic cuts, "whip_pan", "zoom_in", and "flash_white" on major downbeat impacts or bass drops.
3. Media Type Handling:
   - Still Images (media_type == "image" or is_still_image == True): Static photos have elastic duration! They can hold for multi-measure emotional portraits (e.g. 2.0s-4.0s) during quiet verses, or flash rhythmically on downbeats. Set source_in = 0.0 and source_out = (timeline_end - timeline_start).
   - Video Clips (media_type == "video"): Respect the clip's physical source bounds. Ensure source_out <= clip.end_time and (source_out - source_in) == (timeline_end - timeline_start).
4. Visual Quality, Facial Emotions & Subject Prominence:
   - Use sharpness, brightness, and local facial analysis fields (`has_faces`, `face_count`, `dominant_expression`, `smile_score`, `subject_prominence`) intelligently:
   - For Weddings, Family, Birthdays & Milestones: Place `joyful / smiling` or `laughing / ecstatic` `close_up` portraits on emotional chorus peaks and downbeats. Use `scenic` or `wide_shot` establishing shots for intros and transitions.
   - Place the clearest, highest-sharpness scenes during musical climaxes.
5. Continuity & Pacing:
   - The timeline must seamlessly cover from 0.0 seconds to music_profile.duration_sec with zero gaps and zero overlaps.
   - Avoid monotonous repetitions of the exact same shot consecutively.
"""


def direct_amv_deterministic(
    beats: BeatsData,
    catalog: ScenesCatalog,
    user_prompt: str = "",
    project_title: str = "Montage Project",
    target_audio: str = "soundtrack.wav",
) -> Timeline:
    """
    Offline deterministic director: aligns cuts to downbeats and energy profiles.
    Adapts pacing and transitions based on user prompt (e.g. wedding/family vs action/AMV).
    Guarantees seamless timeline coverage and accurate source-to-timeline duration mapping.
    """
    if not catalog.scenes:
        raise ValueError("Cannot direct timeline: ScenesCatalog contains no scenes.")

    duration_sec = beats.duration_sec
    if duration_sec <= 0:
        raise ValueError("Cannot direct timeline: Audio duration must be greater than 0.")

    prompt_lower = (user_prompt or "").lower()
    is_emotional = any(
        w in prompt_lower
        for w in [
            "wedding",
            "grow",
            "child",
            "family",
            "birthday",
            "graduation",
            "ceremony",
            "memorial",
            "gentle",
            "slow",
            "love",
            "photo",
            "nostalgic",
            "memory",
            "memories",
            "soft",
        ]
    )
    is_action = any(
        w in prompt_lower
        for w in ["action", "fast", "drop", "battle", "amv", "hype", "intense", "rock", "rap", "dance"]
    )

    # Collect cut boundary points on the timeline
    cut_points: List[float] = [0.0]

    # Select downbeats / beat step based on genre pacing
    valid_downbeats = [db for db in beats.downbeats if 0.05 < db < (duration_sec - 0.2)]

    if is_emotional and len(valid_downbeats) > 4:
        # Longer emotional holds: group downbeats every 2 bars (approx 3.0s - 4.5s)
        for i in range(0, len(valid_downbeats), 2):
            db = valid_downbeats[i]
            if 0.05 < db < (duration_sec - 0.2):
                cut_points.append(db)
    elif valid_downbeats:
        cut_points.extend(valid_downbeats)
    elif beats.beats:
        step = 8 if is_emotional else (2 if is_action else 4)
        step = min(step, max(1, len(beats.beats) // 2))
        for i in range(0, len(beats.beats), step):
            b_t = beats.beats[i]
            if 0.05 < b_t < (duration_sec - 0.2):
                cut_points.append(b_t)
    else:
        # Fallback to pacing intervals
        interval = 3.5 if is_emotional else 2.0
        cur_t = interval
        while cur_t < (duration_sec - 0.2):
            cut_points.append(cur_t)
            cur_t += interval

    cut_points.append(duration_sec)
    cut_points = sorted(list(set([round(p, 3) for p in cut_points])))

    # Segregate scenes by sharpness and brightness for intelligent selection
    scenes_by_sharpness = sorted(
        catalog.scenes,
        key=lambda s: s.sharpness_score if s.sharpness_score is not None else 0.0,
        reverse=True,
    )
    scenes_by_brightness = sorted(
        catalog.scenes,
        key=lambda s: s.brightness_score if s.brightness_score is not None else 0.0,
        reverse=True,
    )
    scenes_by_emotion = sorted(
        catalog.scenes,
        key=lambda s: (
            1 if s.has_faces else 0,
            s.smile_score if s.smile_score is not None else 0.0,
            s.brightness_score if s.brightness_score is not None else 0.0,
        ),
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

        # Select scene and transition based on genre and energy level
        if is_emotional:
            # Weddings, family memories, children growing: prioritize smiling faces & warm visuals with soft crossfades
            chosen_scene = (
                scenes_by_emotion[scene_idx % len(scenes_by_emotion)]
                if scenes_by_emotion
                else catalog.scenes[scene_idx % len(catalog.scenes)]
            )
            transition = "crossfade" if i > 0 else "cut"
        elif is_action or segment_level in ("high", "drop"):
            chosen_scene = (
                scenes_by_sharpness[scene_idx % len(scenes_by_sharpness)]
                if len(scenes_by_sharpness) > 1
                else catalog.scenes[scene_idx % len(catalog.scenes)]
            )
            transition = "flash_white" if segment_level == "drop" else ("whip_pan" if (i % 3 == 0) else "cut")
        elif segment_level in ("low", "intro", "outro"):
            chosen_scene = catalog.scenes[scene_idx % len(catalog.scenes)]
            transition = "crossfade" if i > 0 else "cut"
        else:
            chosen_scene = catalog.scenes[scene_idx % len(catalog.scenes)]
            transition = "cut"

        scene_idx += 1

        is_img = chosen_scene.is_still_image or chosen_scene.media_type == "image"
        source_in = 0.0 if is_img else chosen_scene.start_time
        source_out = round(source_in + cut_duration, 3)

        cuts.append(
            TimelineCut(
                source_file=chosen_scene.source_file,
                source_in=round(source_in, 3),
                source_out=round(source_out, 3),
                timeline_start=round(t_start, 3),
                timeline_end=round(t_end, 3),
                transition=transition,
                pacing_beat_interval=8 if is_emotional else 4,
            )
        )

    return Timeline(
        project_title=project_title,
        target_audio=target_audio,
        cuts=cuts,
    )


# General alias
direct_timeline_deterministic = direct_amv_deterministic


def direct_amv(
    beats: BeatsData,
    catalog: ScenesCatalog,
    user_prompt: str,
    project_title: str = "AMV Project",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    target_audio: str = "soundtrack.wav",
    force_fallback: bool = False,
) -> Timeline:
    """
    Calls Gemini structured output API to generate an AMV cut timeline.
    If GEMINI_API_KEY is not set or API call fails, falls back to deterministic offline director.
    """
    load_dotenv_if_present()
    key = api_key or os.environ.get("GEMINI_API_KEY")
    resolved_model = model or os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")

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
        from urllib.parse import parse_qs, urlparse
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
                    "motion_score": s.motion_score,
                    "brightness": s.brightness_score,
                    "media_type": s.media_type,
                    "is_still_image": s.is_still_image,
                    "has_faces": s.has_faces,
                    "face_count": s.face_count,
                    "dominant_expression": s.dominant_expression,
                    "smile_score": s.smile_score,
                    "subject_prominence": s.subject_prominence,
                }
                for s in catalog.scenes
            ],
        }

        prompt = (
            f"Direct a music-synchronized video & photo montage timeline matching this creative prompt: '{user_prompt}'.\n"
            f"Data:\n{json.dumps(director_input, indent=2)}"
        )

        contents: list = [prompt]
        project_root = Path(__file__).resolve().parent.parent
        attached_thumbs = 0
        for s in catalog.scenes:
            if attached_thumbs >= 40 or not s.keyframe_path:
                break
            kp = s.keyframe_path
            if kp.startswith("/api/thumb"):
                qs = parse_qs(urlparse(kp).query)
                kp = qs.get("path", [""])[0]
            if not kp:
                continue
            thumb_file = Path(kp)
            if not thumb_file.is_absolute():
                thumb_file = project_root / thumb_file
            if thumb_file.is_file():
                contents.append(f"Keyframe for scene_id={s.scene_id} ({Path(s.source_file).name}):")
                contents.append(
                    types.Part.from_bytes(
                        data=thumb_file.read_bytes(),
                        mime_type="image/jpeg",
                    )
                )
                attached_thumbs += 1

        response = client.models.generate_content(
            model=resolved_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=DIRECTOR_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=Timeline,
                temperature=0.4,
            ),
        )

        parsed = json.loads(response.text)
        timeline = Timeline.model_validate(parsed)
        if target_audio:
            timeline.target_audio = target_audio
        for cut in timeline.cuts:
            if cut.track_index is None:
                cut.track_index = 0
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


# General alias
direct_timeline = direct_amv
