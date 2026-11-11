"""
Pytest configuration for AMV Maker tests.
Imports shared fixtures.
"""

from __future__ import annotations
from tests.fixtures import (
    synthetic_audio_path,
    synthetic_video_path,
    synthetic_video_dir,
    generate_synthetic_audio,
    generate_synthetic_video,
)

__all__ = [
    "synthetic_audio_path",
    "synthetic_video_path",
    "synthetic_video_dir",
    "generate_synthetic_audio",
    "generate_synthetic_video",
]
