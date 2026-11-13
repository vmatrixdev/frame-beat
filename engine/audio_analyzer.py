"""
Audio Analyzer for AMV Maker.
Extracts millisecond-accurate tempo, beats, downbeats, and energy curves using librosa.
"""

from __future__ import annotations
from pathlib import Path
from typing import List, Optional
import numpy as np
import librosa

from engine.models import BeatsData, EnergySegment


def _normalize_band_series(values: List[float]) -> List[float]:
    """Normalizes a non-negative per-window energy series to [0.0, 1.0]."""
    if not values:
        return []
    max_val = max(values)
    if max_val <= 1e-6:
        return [0.0 for _ in values]
    return [round(min(1.0, max(0.0, v / max_val)), 3) for v in values]


def _classify_audio_mood(
    level: str,
    vocal_energy: float,
    percussive_energy: float,
    bass_energy: float,
    spectral_brightness: float,
    window_energy: float,
    prev_energy: Optional[float],
) -> str:
    """Classifies a 2s audio window into a descriptive musical mood."""
    if level in ("high", "drop") and (bass_energy >= 0.6 or percussive_energy >= 0.65):
        return "vocal_soaring" if vocal_energy >= 0.65 else "high_energy_drop"
    if vocal_energy >= 0.55 and vocal_energy >= percussive_energy:
        if level == "low" or percussive_energy < 0.35:
            return "vocal_intimate"
        return "vocal_soaring"
    if percussive_energy >= 0.5 or bass_energy >= 0.55:
        if level == "build" or (prev_energy is not None and window_energy > prev_energy * 1.15):
            return "dramatic_build"
        return "rhythmic_groove"
    if level == "low":
        return "vocal_intimate" if vocal_energy >= 0.35 else "instrumental_calm"
    if prev_energy is not None and window_energy > prev_energy * 1.2:
        return "dramatic_build"
    if percussive_energy >= 0.35 or spectral_brightness >= 0.55:
        return "rhythmic_groove"
    return "instrumental_calm"


def analyze_audio(audio_path: str | Path) -> BeatsData:
    """
    Analyzes an audio file and returns deterministic timing and energy markers.
    Computes tempo, beat timestamps, downbeats (4/4 time signature),
    and 2-second sliding window RMS, vocal, percussive, bass, and brightness curves.
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

    # Harmonic-Percussive Source Separation & STFT band energies
    hop_length = 512
    frame_length = 2048
    y_harm, y_perc = librosa.effects.hpss(y)

    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)

    perc_rms = librosa.feature.rms(y=y_perc, frame_length=frame_length, hop_length=hop_length)[0]
    perc_times = librosa.frames_to_time(np.arange(len(perc_rms)), sr=sr, hop_length=hop_length)

    S_harm = np.abs(librosa.stft(y_harm, n_fft=frame_length, hop_length=hop_length))
    S_full = np.abs(librosa.stft(y, n_fft=frame_length, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=frame_length)
    stft_times = librosa.frames_to_time(np.arange(S_full.shape[1]), sr=sr, hop_length=hop_length)

    vocal_mask = (freqs >= 300.0) & (freqs <= 3400.0)
    bass_mask = (freqs >= 20.0) & (freqs <= 250.0)
    vocal_frames = (
        np.sqrt(np.mean(S_harm[vocal_mask, :] ** 2, axis=0))
        if np.any(vocal_mask)
        else np.zeros(S_harm.shape[1], dtype=np.float32)
    )
    bass_frames = (
        np.sqrt(np.mean(S_full[bass_mask, :] ** 2, axis=0))
        if np.any(bass_mask)
        else np.zeros(S_full.shape[1], dtype=np.float32)
    )

    centroid_frames = librosa.feature.spectral_centroid(
        y=y, sr=sr, n_fft=frame_length, hop_length=hop_length
    )[0]
    cent_times = librosa.frames_to_time(np.arange(len(centroid_frames)), sr=sr, hop_length=hop_length)

    window_sec = 2.0
    num_windows = max(1, int(np.ceil(duration_sec / window_sec)))
    mean_rms = float(np.mean(rms)) if len(rms) > 0 else 0.0

    raw_windows = []
    raw_vocal: List[float] = []
    raw_perc: List[float] = []
    raw_bass: List[float] = []
    raw_bright: List[float] = []

    for idx in range(num_windows):
        start = idx * window_sec
        end = min((idx + 1) * window_sec, duration_sec)

        rms_mask = (rms_times >= start) & (rms_times < end)
        window_energy = float(np.mean(rms[rms_mask])) if np.any(rms_mask) else 0.0

        stft_mask = (stft_times >= start) & (stft_times < end)
        v_val = float(np.mean(vocal_frames[stft_mask])) if np.any(stft_mask) else 0.0
        b_val = float(np.mean(bass_frames[stft_mask])) if np.any(stft_mask) else 0.0

        perc_mask = (perc_times >= start) & (perc_times < end)
        p_val = float(np.mean(perc_rms[perc_mask])) if np.any(perc_mask) else 0.0

        cent_mask = (cent_times >= start) & (cent_times < end)
        c_val = float(np.mean(centroid_frames[cent_mask])) if np.any(cent_mask) else 0.0

        raw_windows.append((start, end, window_energy))
        raw_vocal.append(v_val)
        raw_perc.append(p_val)
        raw_bass.append(b_val)
        raw_bright.append(round(min(1.0, max(0.0, c_val / 5000.0)), 3))

    norm_vocal = _normalize_band_series(raw_vocal)
    norm_perc = _normalize_band_series(raw_perc)
    norm_bass = _normalize_band_series(raw_bass)

    energy_segments: List[EnergySegment] = []
    prev_energy: Optional[float] = None

    for idx, (start, end, window_energy) in enumerate(raw_windows):
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

        v_e = norm_vocal[idx]
        p_e = norm_perc[idx]
        b_e = norm_bass[idx]
        s_b = raw_bright[idx]
        mood = _classify_audio_mood(level, v_e, p_e, b_e, s_b, window_energy, prev_energy)
        prev_energy = window_energy

        label = f"segment_{idx+1}"
        energy_segments.append(
            EnergySegment(
                start=round(start, 3),
                end=round(end, 3),
                level=level,
                label=label,
                vocal_energy=v_e,
                percussive_energy=p_e,
                bass_energy=b_e,
                spectral_brightness=s_b,
                audio_mood=mood,
            )
        )

    return BeatsData(
        duration_sec=round(duration_sec, 3),
        tempo_bpm=round(bpm, 2),
        time_signature="4/4",
        downbeats=[round(t, 3) for t in downbeat_times],
        beats=[round(t, 3) for t in beat_times],
        energy_segments=energy_segments,
    )
