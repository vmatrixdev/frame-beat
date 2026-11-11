"""
Unit tests for Audio Analyzer (engine.audio_analyzer).
"""

from __future__ import annotations
from pathlib import Path
import pytest

from engine.audio_analyzer import analyze_audio
from engine.models import BeatsData
from tests.fixtures import generate_synthetic_audio


def test_analyze_audio_synthetic(synthetic_audio_path: Path):
    """Verifies analyze_audio on deterministic 120 BPM synthetic WAV file."""
    result = analyze_audio(synthetic_audio_path)

    assert isinstance(result, BeatsData)
    assert pytest.approx(result.duration_sec, rel=0.05) == 8.0
    # 120 BPM detection tolerance (librosa frame quantization tolerance)
    assert 110.0 <= result.tempo_bpm <= 130.0
    assert result.time_signature == "4/4"

    # Beats validation
    assert len(result.beats) > 10
    for i in range(len(result.beats) - 1):
        assert result.beats[i] < result.beats[i + 1]

    # Downbeats validation
    assert len(result.downbeats) >= 3
    assert result.downbeats[0] == result.beats[0]

    # Energy segments validation (8 seconds / 2-second windows = 4 segments)
    assert len(result.energy_segments) == 4
    assert result.energy_segments[0].start == 0.0
    assert result.energy_segments[-1].end == result.duration_sec

    # Dynamic energy validation: first half (low amplitude) vs second half (high amplitude)
    first_half_levels = [result.energy_segments[0].level, result.energy_segments[1].level]
    second_half_levels = [result.energy_segments[2].level, result.energy_segments[3].level]
    assert "low" in first_half_levels or "medium" in first_half_levels
    assert "high" in second_half_levels


def test_analyze_audio_file_not_found(tmp_path: Path):
    """Verifies that analyzing a non-existent file raises FileNotFoundError."""
    non_existent = tmp_path / "ghost_audio.wav"
    with pytest.raises(FileNotFoundError):
        analyze_audio(non_existent)


def test_analyze_audio_empty_file(tmp_path: Path):
    """Verifies that analyzing an empty file raises ValueError or FileNotFoundError."""
    empty_file = tmp_path / "empty.wav"
    empty_file.write_bytes(b"")
    with pytest.raises(Exception):
        analyze_audio(empty_file)


def test_analyze_short_audio(tmp_path: Path):
    """Verifies that audio shorter than 2 seconds is handled gracefully."""
    short_wav = tmp_path / "short.wav"
    generate_synthetic_audio(short_wav, duration_sec=1.5, bpm=120.0)
    result = analyze_audio(short_wav)

    assert isinstance(result, BeatsData)
    assert pytest.approx(result.duration_sec, rel=0.1) == 1.5
    assert len(result.energy_segments) == 1
    assert result.energy_segments[0].start == 0.0
    assert result.energy_segments[0].end == result.duration_sec
