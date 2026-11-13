"""
Data contracts for AMV Maker pipeline.
Corresponds to specs/schemas.json.
"""

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class AudioCueNote(BaseModel):
    id: str = Field(..., description="Unique identifier for the audio cue note")
    timestamp_ms: int = Field(..., description="Millisecond-accurate position on the audio track")
    tags: List[str] = Field(default_factory=list, description="User-assigned cue tags")
    note: str = Field(default="", description="User note describing the musical moment")


class EnergySegment(BaseModel):
    start: float = Field(..., description="Start timestamp in seconds")
    end: float = Field(..., description="End timestamp in seconds")
    level: Literal["low", "medium", "high", "drop", "outro", "intro", "build"] = Field(
        ..., description="Dynamic energy level"
    )
    label: str = Field(..., description="Segment descriptor (e.g., intro, verse_1, chorus_1)")
    vocal_energy: Optional[float] = Field(default=None, description="Normalized vocal band energy (0.0-1.0)")
    percussive_energy: Optional[float] = Field(default=None, description="Normalized percussive energy (0.0-1.0)")
    bass_energy: Optional[float] = Field(default=None, description="Normalized bass band energy (0.0-1.0)")
    spectral_brightness: Optional[float] = Field(default=None, description="Normalized spectral brightness (0.0-1.0)")
    audio_mood: Optional[str] = Field(
        default=None,
        description="Classified audio mood (e.g., vocal_intimate, vocal_soaring, instrumental_calm, rhythmic_groove, high_energy_drop, dramatic_build)",
    )


class BeatsData(BaseModel):
    duration_sec: float = Field(..., description="Total duration of audio in seconds")
    tempo_bpm: float = Field(..., description="Detected tempo in BPM")
    time_signature: str = Field(default="4/4", description="Musical time signature")
    downbeats: List[float] = Field(..., description="Bar/downbeat timestamps in seconds")
    beats: List[float] = Field(..., description="Detected beat timestamps in seconds")
    energy_segments: List[EnergySegment] = Field(
        default_factory=list, description="Calculated energy segments"
    )
    audio_notes: List[AudioCueNote] = Field(
        default_factory=list, description="User-authored millisecond audio cue notes"
    )


class SceneCut(BaseModel):
    scene_id: int = Field(..., description="Sequential scene index")
    source_file: str = Field(..., description="Absolute path to source video file")
    start_time: float = Field(..., description="In point in seconds")
    end_time: float = Field(..., description="Out point in seconds")
    duration: float = Field(..., description="Duration in seconds (0.0 for static photos/images)")
    media_type: Literal["video", "image"] = Field(
        default="video", description="Source media type: 'video' or 'image'"
    )
    is_still_image: bool = Field(
        default=False, description="True if source is a static image/photo with infinite duration"
    )
    keyframe_path: Optional[str] = Field(default=None, description="Path to thumbnail keyframe image")
    sharpness_score: Optional[float] = Field(default=None, description="Laplacian variance sharpness")
    motion_score: Optional[float] = Field(default=None, description="Motion score")
    brightness_score: Optional[float] = Field(default=None, description="Average frame brightness")
    has_faces: bool = Field(default=False, description="True if one or more faces detected")
    face_count: int = Field(default=0, description="Number of faces detected in keyframe")
    dominant_expression: Optional[str] = Field(
        default=None, description="Detected facial expression (e.g. joyful / smiling, laughing, neutral)"
    )
    smile_score: Optional[float] = Field(default=None, description="Smile confidence score (0.0 to 1.0)")
    subject_prominence: Optional[Literal["close_up", "medium_shot", "wide_shot", "scenic"]] = Field(
        default=None, description="Subject framing prominence based on face bounding box area"
    )
    contrast_score: Optional[float] = Field(default=None, description="Contrast score (0.0-100.0)")
    saturation_score: Optional[float] = Field(default=None, description="Saturation score (0.0-100.0)")
    fluidity_score: Optional[float] = Field(default=None, description="Optical-flow motion fluidity score (0.0-100.0)")
    dramatism_score: Optional[float] = Field(default=None, description="Visual dramatism score (0.0-100.0)")
    color_mood: Optional[str] = Field(
        default=None,
        description="Color mood (e.g. warm_golden, cool_cinematic, vibrant_festive, moody_dark, neutral_balanced)",
    )
    visual_mood: Optional[str] = Field(
        default=None,
        description="Visual mood (e.g. joyful_bright, energetic_action, dramatic_intense, serene_scenic, melancholic_muted, warm_intimate)",
    )
    emotion_scores: Optional[Dict[str, float]] = Field(
        default=None,
        description="Emotion scores dict (keys: joy, surprise, anger, sadness, worry, neutral)",
    )
    user_tags: List[str] = Field(default_factory=list, description="User-assigned scene tags")
    user_note: Optional[str] = Field(default=None, description="User note for this scene")


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
    track_index: Optional[int] = Field(
        default=0, description="Video track index (0 = V1, 1 = V2, etc.)"
    )
    user_tags: List[str] = Field(default_factory=list, description="User-assigned cut tags")
    user_note: Optional[str] = Field(default=None, description="User note for this cut")


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

