"""
LLM Director for AMV Maker.
Uses Gemini Flash with structured output to orchestrate cuts against musical beats and scenes.
"""

import json
import os
from typing import Optional
from google import genai
from google.genai import types

from engine.models import BeatsData, ScenesCatalog, Timeline


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


def direct_amv(
    beats: BeatsData,
    catalog: ScenesCatalog,
    user_prompt: str,
    project_title: str = "AMV Project",
    api_key: Optional[str] = None,
    model: str = "gemini-2.0-flash",
) -> Timeline:
    """
    Calls Gemini structured output API to generate an AMV cut timeline.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ValueError("GEMINI_API_KEY is not set in environment or arguments.")

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
