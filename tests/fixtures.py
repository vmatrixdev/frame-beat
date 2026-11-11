"""
Synthetic Test Fixtures for AMV Maker.
Generates deterministic synthetic audio (WAV) and video (MP4) files for unit and integration testing.
"""

from __future__ import annotations
from pathlib import Path
from typing import List, Tuple
import wave
import struct
import math
import numpy as np
import cv2
import pytest


def generate_synthetic_audio(
    output_path: str | Path,
    duration_sec: float = 8.0,
    bpm: float = 120.0,
    sample_rate: int = 22050,
) -> Path:
    """
    Generates a synthetic WAV audio file with rhythmic beats and dynamic energy.
    At 120 BPM, beats occur every 0.5s.
    Downbeats occur every 4 beats (every 2.0s).
    First half has lower energy; second half has higher energy.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    num_samples = int(duration_sec * sample_rate)
    samples = np.zeros(num_samples, dtype=np.float32)

    beat_interval = 60.0 / bpm
    decay_sec = 0.12
    decay_samples = int(decay_sec * sample_rate)
    decay_t = np.linspace(0, decay_sec, decay_samples, endpoint=False)

    num_beats = int(duration_sec / beat_interval)
    for b in range(num_beats):
        beat_t = b * beat_interval
        start_idx = int(beat_t * sample_rate)
        end_idx = min(start_idx + decay_samples, num_samples)
        cur_decay = decay_t[: end_idx - start_idx]

        # Dynamic energy: low amplitude first half, higher amplitude second half
        energy_scale = 0.35 if beat_t < (duration_sec / 2.0) else 0.95

        is_downbeat = (b % 4 == 0)
        if is_downbeat:
            # Low punch kick: 130 Hz with fast pitch envelope decay
            freq = 130.0
            pulse = energy_scale * 1.2 * np.sin(2 * np.pi * freq * cur_decay) * np.exp(-cur_decay * 25.0)
        else:
            # High click/snare: 750 Hz
            freq = 750.0
            pulse = energy_scale * 0.7 * np.sin(2 * np.pi * freq * cur_decay) * np.exp(-cur_decay * 45.0)

        samples[start_idx:end_idx] += pulse

    # Normalize samples to 16-bit integer range [-32767, 32767]
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


def generate_synthetic_video(
    output_path: str | Path,
    duration_sec: float = 6.0,
    fps: float = 25.0,
    width: int = 320,
    height: int = 240,
    scenes: list[dict] | None = None,
) -> Path:
    """
    Generates a synthetic MP4 video file with distinct scene color changes.
    Default: 3 scenes of 2.0 seconds each (Red, Green, Blue).
    Draws text and shapes to provide high sharpness and brightness contrast.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if scenes is None:
        scenes = [
            {"duration": 2.0, "color": (0, 0, 220), "label": "Scene A - Red", "shape": "rect"},
            {"duration": 2.0, "color": (0, 200, 0), "label": "Scene B - Green", "shape": "circle"},
            {"duration": 2.0, "color": (220, 0, 0), "label": "Scene C - Blue", "shape": "line"},
        ]

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))
    if not out.isOpened():
        raise RuntimeError(f"Failed to open VideoWriter for {output_path}")

    for scene in scenes:
        num_frames = int(scene["duration"] * fps)
        base_color = scene["color"]
        label = scene["label"]
        shape = scene.get("shape", "rect")

        for f in range(num_frames):
            frame = np.full((height, width, 3), base_color, dtype=np.uint8)

            # Draw shapes and text for high sharpness variance
            if shape == "rect":
                cv2.rectangle(frame, (40, 40), (width - 40, height - 40), (255, 255, 255), 3)
            elif shape == "circle":
                cv2.circle(frame, (width // 2, height // 2), min(width, height) // 4, (255, 255, 255), 3)
            elif shape == "line":
                cv2.line(frame, (20, 20), (width - 20, height - 20), (255, 255, 255), 3)
                cv2.line(frame, (20, height - 20), (width - 20, 20), (255, 255, 255), 3)

            cv2.putText(
                frame,
                f"{label} F:{f}",
                (20, height // 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
            out.write(frame)

    out.release()
    return output_path


@pytest.fixture
def synthetic_audio_path(tmp_path: Path) -> Path:
    """Pytest fixture providing an 8-second 120 BPM audio track."""
    path = tmp_path / "test_soundtrack.wav"
    return generate_synthetic_audio(path, duration_sec=8.0, bpm=120.0)


@pytest.fixture
def synthetic_video_path(tmp_path: Path) -> Path:
    """Pytest fixture providing a 6-second MP4 video with 3 cuts."""
    path = tmp_path / "test_clip.mp4"
    return generate_synthetic_video(path, duration_sec=6.0)


@pytest.fixture
def synthetic_video_dir(tmp_path: Path) -> Path:
    """Pytest fixture providing a directory with two distinct synthetic MP4 videos."""
    v_dir = tmp_path / "video_clips"
    v_dir.mkdir(parents=True, exist_ok=True)
    generate_synthetic_video(
        v_dir / "clip_01.mp4",
        duration_sec=4.0,
        scenes=[
            {"duration": 2.0, "color": (0, 0, 255), "label": "Clip1 Scene1", "shape": "rect"},
            {"duration": 2.0, "color": (255, 0, 0), "label": "Clip1 Scene2", "shape": "circle"},
        ],
    )
    generate_synthetic_video(
        v_dir / "clip_02.mp4",
        duration_sec=4.0,
        scenes=[
            {"duration": 2.0, "color": (0, 255, 0), "label": "Clip2 Scene1", "shape": "line"},
            {"duration": 2.0, "color": (0, 0, 255), "label": "Clip2 Scene2", "shape": "rect"},
        ],
    )
    return v_dir
