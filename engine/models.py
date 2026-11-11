"""
Data contracts for AMV Maker pipeline.
Corresponds to specs/schemas.json.
"""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class EnergySegment(BaseModel):
    start: float = Field(..., description="Start timestamp in seconds")
    end: float = Field(..., description="End timestamp in seconds")
    level: Literal["low", "medium", "high", "drop", "outro", "intro", "build"] = Field(
        ..., description="Dynamic energy level"
    )
    label: str = Field(..., description="Segment descriptor (e.g., intro, verse_1, chorus_1)")


class BeatsData(BaseModel):
    duration_sec: float = Field(..., description="Total duration of audio in seconds")
    tempo_bpm: float = Field(..., description="Detected tempo in BPM")
    time_signature: str = Field(default="4/4", description="Musical time signature")
    downbeats: List[float] = Field(..., description="Bar/downbeat timestamps in seconds")
    beats: List[float] = Field(..., description="Detected beat timestamps in seconds")
    energy_segments: List[EnergySegment] = Field(
        default_factory=list, description="Calculated energy segments"
    )


class SceneCut(BaseModel):
    scene_id: int = Field(..., description="Sequential scene index")
    source_file: str = Field(..., description="Absolute path to source video file")
    start_time: float = Field(..., description="In point in seconds")
    end_time: float = Field(..., description="Out point in seconds")
    duration: float = Field(..., description="Duration in seconds")
    keyframe_path: Optional[str] = Field(default=None, description="Path to thumbnail keyframe image")
    sharpness_score: Optional[float] = Field(default=None, description="Laplacian variance sharpness")
    motion_score: Optional[float] = Field(default=None, description="Motion score")
    brightness_score: Optional[float] = Field(default=None, description="Average frame brightness")


class ScenesCatalog(BaseModel):
    source_files: List[str] = Field(..., description="List of source video files analyzed")
    total_scenes: int = Field(..., description="Total number of scenes detected")
    scenes: List[SceneCut] = Field(..., description="Detected visual scene cuts")


class TimelineCut(BaseModel):
    source_file: str = Field(..., description="Path to source video file")
    source_in: float = Field(..., description="Source clip in-point timestamp in seconds")
    source_out: float = Field(..., description="Source clip out-point timestamp in seconds")
    timeline_start: float = Field(..., description="Placement start time on AMV timeline in seconds")
    timeline_end: float = Field(..., description="Placement end time on AMV timeline in seconds")
    transition: Literal["cut", "crossfade", "flash_white", "zoom_in", "whip_pan"] = Field(
        default="cut", description="Transition effect"
    )
    pacing_beat_interval: Optional[int] = Field(
        default=4, description="Cuts synchronized every N beats"
    )


class Timeline(BaseModel):
    project_title: str = Field(..., description="AMV project title")
    target_audio: str = Field(..., description="Path to audio soundtrack file")
    cuts: List[TimelineCut] = Field(..., description="Ordered sequence of cuts placed against the audio")


class RenderProgress(BaseModel):
    percent: float = Field(default=0.0, description="Progress percentage from 0.0 to 100.0")
    current_time_sec: float = Field(default=0.0, description="Current rendered time in seconds")
    total_time_sec: float = Field(default=0.0, description="Total timeline duration in seconds")
    fps: float = Field(default=0.0, description="Current encoding FPS")
    speed: str = Field(default="0x", description="Current encoding speed")
    frame: int = Field(default=0, description="Current encoded frame count")

