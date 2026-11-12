"""
Unit tests for Visual Analyzer (engine.visual_analyzer).
"""

from __future__ import annotations
from pathlib import Path
import numpy as np
import pytest

from engine.visual_analyzer import (
    analyze_video,
    analyze_directory,
    analyze_image,
    compute_frame_metrics,
    IMAGE_EXTENSIONS,
)
from engine.models import ScenesCatalog, SceneCut
from tests.fixtures import generate_synthetic_video


def test_compute_frame_metrics():
    """Verifies sharpness (Laplacian variance) and brightness metrics."""
    # Flat grey frame -> zero variance
    flat_frame = np.full((100, 100, 3), 128, dtype=np.uint8)
    sharpness, brightness = compute_frame_metrics(flat_frame)
    assert sharpness == 0.0
    assert pytest.approx(brightness, abs=0.5) == 128.0

    # High frequency / high contrast pattern -> high variance
    checker = np.zeros((100, 100, 3), dtype=np.uint8)
    checker[::2, ::2] = 255
    checker[1::2, 1::2] = 255
    sharpness_checker, brightness_checker = compute_frame_metrics(checker)
    assert sharpness_checker > 1000.0
    assert brightness_checker > 0.0


def test_analyze_video_cuts(synthetic_video_path: Path, tmp_path: Path):
    """Verifies scene detection on 6s synthetic video with 3 distinct color cuts."""
    thumb_dir = tmp_path / "thumbs"
    cuts = analyze_video(synthetic_video_path, output_thumbnail_dir=thumb_dir)

    assert len(cuts) == 3
    # Check timings around 0s, 2s, 4s, 6s
    assert pytest.approx(cuts[0].start_time, abs=0.15) == 0.0
    assert pytest.approx(cuts[0].end_time, abs=0.15) == 2.0
    assert pytest.approx(cuts[1].start_time, abs=0.15) == 2.0
    assert pytest.approx(cuts[1].end_time, abs=0.15) == 4.0
    assert pytest.approx(cuts[2].start_time, abs=0.15) == 4.0
    assert pytest.approx(cuts[2].end_time, abs=0.15) == 6.0

    # Keyframe verification
    for cut in cuts:
        assert cut.keyframe_path is not None
        assert Path(cut.keyframe_path).exists()
        assert Path(cut.keyframe_path).stat().st_size > 500
        assert cut.sharpness_score is not None and cut.sharpness_score > 0
        assert cut.brightness_score is not None and cut.brightness_score > 0


def test_analyze_video_single_scene_fallback(tmp_path: Path):
    """Verifies that a video with no cuts falls back to 1 scene covering the full duration."""
    single_clip = tmp_path / "single_scene.mp4"
    generate_synthetic_video(
        single_clip,
        duration_sec=3.0,
        scenes=[{"duration": 3.0, "color": (100, 100, 100), "label": "Static", "shape": "rect"}],
    )

    cuts = analyze_video(single_clip, output_thumbnail_dir=tmp_path / "single_thumbs")
    assert len(cuts) == 1
    assert cuts[0].scene_id == 0
    assert pytest.approx(cuts[0].start_time, abs=0.1) == 0.0
    assert pytest.approx(cuts[0].duration, abs=0.1) == 3.0
    assert cuts[0].keyframe_path is not None
    assert Path(cuts[0].keyframe_path).exists()


def test_analyze_video_file_not_found(tmp_path: Path):
    """Verifies that analyzing a non-existent video raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        analyze_video(tmp_path / "does_not_exist.mp4")


def test_analyze_directory(synthetic_video_dir: Path, tmp_path: Path):
    """Verifies directory analysis cataloging multiple video files."""
    thumb_dir = tmp_path / "dir_thumbs"
    catalog = analyze_directory(synthetic_video_dir, output_thumbnail_dir=thumb_dir)

    assert isinstance(catalog, ScenesCatalog)
    assert len(catalog.source_files) == 2
    # 2 files with 2 scenes each = 4 total scenes
    assert catalog.total_scenes == 4
    assert len(catalog.scenes) == 4

    # Sequential scene IDs
    scene_ids = [s.scene_id for s in catalog.scenes]
    assert scene_ids == [0, 1, 2, 3]


def test_analyze_directory_not_found(tmp_path: Path):
    """Verifies that analyzing a non-existent directory raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        analyze_directory(tmp_path / "non_existent_dir")


def test_analyze_image(tmp_path: Path):
    """Verifies still image analysis (JPG/PNG) for AMV visual inputs."""
    import cv2
    img_path = tmp_path / "anime_art.jpg"
    thumb_dir = tmp_path / "img_thumbs"

    # Create synthetic test image
    img = np.zeros((720, 1280, 3), dtype=np.uint8)
    cv2.rectangle(img, (200, 200), (600, 500), (0, 0, 255), -1)
    cv2.circle(img, (900, 360), 150, (255, 255, 0), -1)
    cv2.imwrite(str(img_path), img)

    cut = analyze_image(img_path, output_thumbnail_dir=thumb_dir)
    assert isinstance(cut, SceneCut)
    assert cut.source_file == str(img_path.resolve())
    assert cut.duration > 0
    assert cut.start_time == 0.0
    assert cut.keyframe_path is not None
    assert Path(cut.keyframe_path).exists()
    assert cut.sharpness_score is not None and cut.sharpness_score > 0
    assert cut.brightness_score is not None and cut.brightness_score > 0


def test_analyze_directory_with_images_and_videos(synthetic_video_dir: Path, tmp_path: Path):
    """Verifies that analyze_directory seamlessly catalogs both video clips and still images."""
    import cv2
    # Add a PNG image into the directory
    img_path = synthetic_video_dir / "wallpaper.png"
    img = np.full((360, 640, 3), (120, 40, 200), dtype=np.uint8)
    cv2.imwrite(str(img_path), img)

    catalog = analyze_directory(synthetic_video_dir, output_thumbnail_dir=tmp_path / "mixed_thumbs")
    assert catalog.total_scenes == 5 # 4 video scenes + 1 image cut
    source_files = [Path(s).name for s in catalog.source_files]
    assert "wallpaper.png" in source_files
