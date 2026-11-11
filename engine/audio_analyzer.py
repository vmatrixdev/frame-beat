"""
Audio Analyzer for AMV Maker.
Extracts millisecond-accurate tempo, beats, downbeats, and energy curves using librosa.
"""

from __future__ import annotations
from pathlib import Path
from typing import List, Union
import numpy as np
import librosa

from engine.models import BeatsData, EnergySegment


def analyze_audio(audio_path: str | Path) -> BeatsData:
    """
    Analyzes an audio file and returns deterministic timing and energy markers.
    Computes tempo, beat timestamps, downbeats (4/4 time signature),
    and 2-second sliding window RMS energy levels.
    """
    audio_path = Path(audio_path)
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    y, sr = librosa.load(str(audio_path), sr=22050)
    if len(y) == 0:
        raise ValueError(f"Audio file contains no audio data: {audio_path}")

    duration_sec = float(librosa.get_duration(y=y, sr=sr))
    if duration_sec <= 0.0:
        raise ValueError(f"Audio duration is 0: {audio_path}")

    # Beat tracking
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    bpm_val = np.atleast_1d(tempo)
    bpm = float(bpm_val[0]) if len(bpm_val) > 0 else 120.0

    # Downbeat estimation (approximated 4/4 bar grouping by default)
    # Group beats into 4-beat measures
    downbeat_times = [beat_times[i] for i in range(0, len(beat_times), 4)]

    # Dynamic RMS energy across 2-second windows
    hop_length = 512
    frame_length = 2048
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)

    energy_segments: List[EnergySegment] = []
    window_sec = 2.0
    num_windows = max(1, int(np.ceil(duration_sec / window_sec)))
    mean_rms = float(np.mean(rms)) if len(rms) > 0 else 0.0

    for idx in range(num_windows):
        start = idx * window_sec
        end = min((idx + 1) * window_sec, duration_sec)
        mask = (rms_times >= start) & (rms_times < end)
        window_energy = float(np.mean(rms[mask])) if np.any(mask) else 0.0

        if mean_rms > 0:
            ratio = window_energy / (mean_rms + 1e-6)
            if ratio > 1.25:
                level = "high"
            elif ratio < 0.75:
                level = "low"
            else:
                level = "medium"
        else:
            level = "medium"

        label = f"segment_{idx+1}"
        energy_segments.append(
            EnergySegment(start=round(start, 3), end=round(end, 3), level=level, label=label)
        )

    return BeatsData(
        duration_sec=round(duration_sec, 3),
        tempo_bpm=round(bpm, 2),
        time_signature="4/4",
        downbeats=[round(t, 3) for t in downbeat_times],
        beats=[round(t, 3) for t in beat_times],
        energy_segments=energy_segments,
    )
