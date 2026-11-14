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
    assert cut.is_still_image is True
    assert cut.media_type == "image"
    assert cut.duration == 0.0
    assert cut.start_time == 0.0
    assert cut.keyframe_path is not None
    assert Path(cut.keyframe_path).exists()
    assert cut.sharpness_score is not None and cut.sharpness_score > 0
    assert cut.brightness_score is not None and cut.brightness_score > 0
    assert cut.has_faces is False
    assert cut.face_count == 0
    assert cut.subject_prominence == "scenic"


def test_analyze_frame_semantics_fallback():
    """Verifies facial emotion / subject prominence analyzer handles blank frames cleanly."""
    from engine.face_analyzer import analyze_frame_semantics

    blank = np.zeros((240, 320, 3), dtype=np.uint8)
    result = analyze_frame_semantics(blank)
    assert result["has_faces"] is False
    assert result["face_count"] == 0
    assert result["subject_prominence"] == "scenic"
    assert result["dominant_expression"] is None
    assert result["smile_score"] is None


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


def test_analyze_single_segment_custom_range(synthetic_video_path: Path, tmp_path: Path):
    """Verifies on-demand single-segment analysis with configurable sampling."""
    from engine.visual_analyzer import analyze_single_segment

    cut = analyze_single_segment(
        source_path=synthetic_video_path,
        start_time=1.0,
        end_time=3.5,
        sample_frames=8,
        output_thumbnail_dir=tmp_path / "seg_thumbs",
        scene_id=7,
    )
    assert cut.scene_id == 7
    assert pytest.approx(cut.start_time, abs=0.05) == 1.0
    assert pytest.approx(cut.end_time, abs=0.05) == 3.5
    assert pytest.approx(cut.duration, abs=0.05) == 2.5
    assert cut.keyframe_path is not None and Path(cut.keyframe_path).exists()
    assert cut.sharpness_score is not None
    assert cut.brightness_score is not None


def test_analyze_video_highlight_windowing_long_continuous_clip(tmp_path: Path):
    """Verifies that long continuous videos (> 5.5s) are subdivided into tight highlight windows."""
    long_clip = tmp_path / "long_continuous.mp4"
    generate_synthetic_video(
        long_clip,
        duration_sec=12.0,
        scenes=[{"duration": 12.0, "color": (80, 140, 200), "label": "Continuous", "shape": "circle"}],
    )

    cuts = analyze_video(long_clip, output_thumbnail_dir=tmp_path / "long_thumbs")
    assert len(cuts) >= 2
    for idx, cut in enumerate(cuts):
        assert cut.scene_id == idx
        assert 2.0 <= cut.duration <= 5.5
        assert cut.motion_score is not None
        assert cut.keyframe_path is not None and Path(cut.keyframe_path).exists()
        if idx > 0:
            assert cut.start_time >= cuts[idx - 1].end_time - 1e-3


def test_analyze_video_quick_cut_parametrization(tmp_path: Path):
    """Verifies parameterized quick cuts (e.g. 0.5s target window) on a continuous clip."""
    clip = tmp_path / "quick_cut_source.mp4"
    generate_synthetic_video(
        clip,
        duration_sec=5.0,
        scenes=[{"duration": 5.0, "color": (50, 180, 120), "label": "Fast", "shape": "rect"}],
    )

    cuts = analyze_video(
        clip,
        output_thumbnail_dir=tmp_path / "quick_thumbs",
        max_scene_duration=1.5,
        target_window_duration=0.5,
        min_window_duration=0.35,
    )
    assert len(cuts) >= 3
    for cut in cuts:
        assert 0.3 <= cut.duration <= 0.6


def test_compute_visual_mood_metrics_image_and_video():
    """Verifies visual mood, contrast, saturation, dramatism, and Farneback fluidity metrics."""
    import cv2
    from engine.visual_analyzer import compute_visual_mood_metrics

    # Single warm golden frame -> fluidity_score must be None
    warm_frame = np.full((180, 320, 3), (40, 150, 220), dtype=np.uint8)  # BGR: warm orange/gold
    cv2.rectangle(warm_frame, (40, 40), (160, 140), (20, 200, 240), -1)
    img_metrics = compute_visual_mood_metrics([warm_frame])
    assert img_metrics["fluidity_score"] is None
    assert 0.0 <= img_metrics["contrast_score"] <= 100.0
    assert 0.0 <= img_metrics["saturation_score"] <= 100.0
    assert 0.0 <= img_metrics["dramatism_score"] <= 100.0
    assert img_metrics["color_mood"] in {
        "warm_golden",
        "cool_cinematic",
        "vibrant_festive",
        "moody_dark",
        "neutral_balanced",
    }
    assert img_metrics["visual_mood"] in {
        "joyful_bright",
        "energetic_action",
        "dramatic_intense",
        "serene_scenic",
        "melancholic_muted",
        "warm_intimate",
    }

    # Multi-frame smooth horizontal pan -> fluidity_score populated in [0, 100]
    frames = []
    for i in range(4):
        f = np.zeros((180, 320, 3), dtype=np.uint8)
        cv2.circle(f, (60 + i * 20, 90), 30, (220, 120, 40), -1)
        frames.append(f)
    vid_metrics = compute_visual_mood_metrics(frames)
    assert vid_metrics["fluidity_score"] is not None
    assert 0.0 <= vid_metrics["fluidity_score"] <= 100.0
    assert vid_metrics["color_mood"] == "moody_dark"


def test_analyze_image_and_video_populate_mood_fields(synthetic_video_path: Path, tmp_path: Path):
    """Verifies analyze_image, analyze_video, and analyze_single_segment populate new mood fields."""
    import cv2
    from engine.visual_analyzer import analyze_single_segment

    img_path = tmp_path / "bright.jpg"
    img = np.full((240, 320, 3), (200, 220, 180), dtype=np.uint8)
    cv2.imwrite(str(img_path), img)
    img_cut = analyze_image(img_path, output_thumbnail_dir=tmp_path / "t_img")
    assert img_cut.fluidity_score is None
    assert img_cut.contrast_score is not None
    assert img_cut.saturation_score is not None
    assert img_cut.dramatism_score is not None
    assert img_cut.color_mood is not None
    assert img_cut.visual_mood is not None

    vid_cuts = analyze_video(synthetic_video_path, output_thumbnail_dir=tmp_path / "t_vid")
    assert len(vid_cuts) >= 1
    assert vid_cuts[0].fluidity_score is not None
    assert vid_cuts[0].visual_mood is not None

    seg_cut = analyze_single_segment(
        source_path=synthetic_video_path,
        start_time=0.5,
        end_time=1.8,
        sample_frames=4,
        output_thumbnail_dir=tmp_path / "t_seg",
    )
    assert seg_cut.fluidity_score is not None
    assert seg_cut.dramatism_score is not None


def test_classify_blendshapes_expanded_emotions():
    """Verifies all 8 expanded facial expressions and emotion_scores keys."""
    from engine.face_analyzer import classify_blendshapes

    cases = [
        ({"mouthSmileLeft": 0.7, "mouthSmileRight": 0.7, "jawOpen": 0.4}, "laughing / ecstatic", "joy"),
        ({"mouthSmileLeft": 0.5, "mouthSmileRight": 0.5, "jawOpen": 0.05}, "joyful / smiling", "joy"),
        ({"eyeWideLeft": 0.7, "eyeWideRight": 0.7, "browInnerUp": 0.6, "jawOpen": 0.5}, "surprised / amazed", "surprise"),
        ({"browDownLeft": 0.7, "browDownRight": 0.7, "noseSneerLeft": 0.5, "noseSneerRight": 0.5}, "angry / intense", "anger"),
        ({"mouthFrownLeft": 0.7, "mouthFrownRight": 0.7, "browInnerUp": 0.5}, "sad / melancholic", "sadness"),
        ({"browInnerUp": 0.6, "mouthStretchLeft": 0.6, "mouthStretchRight": 0.6}, "worried / tense", "worry"),
        ({"browDownLeft": 0.4, "browDownRight": 0.4, "mouthPressLeft": 0.5, "mouthPressRight": 0.5}, "focused / determined", None),
        ({"browDownLeft": 0.65, "browDownRight": 0.65, "noseSneerLeft": 0.3, "noseSneerRight": 0.3, "mouthSmileLeft": 0.4, "mouthSmileRight": 0.4}, "angry / intense", "anger"),
        ({}, "calm / neutral", "neutral"),
    ]
    expected_keys = {"joy", "surprise", "anger", "sadness", "worry", "neutral"}
    for bs_map, expected_expr, dominant_key in cases:
        expr, smile, scores = classify_blendshapes(bs_map)
        assert expr == expected_expr
        assert 0.0 <= smile <= 1.0
        assert set(scores.keys()) == expected_keys
        for val in scores.values():
            assert 0.0 <= val <= 1.0
        if dominant_key == "neutral":
            assert scores["neutral"] == max(scores.values())
        elif dominant_key is not None:
            non_neutral_max = max(scores[k] for k in expected_keys if k != "neutral")
            assert scores[dominant_key] == non_neutral_max and non_neutral_max > 0.35


def test_semantic_indexer_cache_and_search(tmp_path: Path, monkeypatch):
    """Verifies SigLIP semantic_indexer caching, vibe scoring, and search ranking with mocked embeddings."""
    import numpy as np
    from PIL import Image
    from engine.models import SceneCut, ScenesCatalog
    import engine.semantic_indexer as si

    thumb0 = tmp_path / "thumb0.jpg"
    thumb1 = tmp_path / "thumb1.jpg"
    Image.new("RGB", (64, 64), color=(255, 80, 30)).save(thumb0)
    Image.new("RGB", (64, 64), color=(30, 180, 255)).save(thumb1)

    catalog = ScenesCatalog(
        source_files=["/media/atla.mp4"],
        total_scenes=2,
        scenes=[
            SceneCut(
                scene_id=0,
                source_file="/media/atla.mp4",
                start_time=0.0,
                end_time=2.0,
                duration=2.0,
                keyframe_path=str(thumb0),
            ),
            SceneCut(
                scene_id=1,
                source_file="/media/atla.mp4",
                start_time=2.0,
                end_time=4.0,
                duration=2.0,
                keyframe_path=str(thumb1),
            ),
        ],
    )

    monkeypatch.setattr(si, "is_siglip_available", lambda: True)
    # Two orthogonal unit vectors in R^4: [1, 0, 0, 0] for thumb0, [0, 1, 0, 0] for thumb1
    monkeypatch.setattr(
        si,
        "encode_images",
        lambda paths, **kwargs: np.array([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]], dtype=np.float32),
    )

    def fake_encode_texts(texts, **kwargs):
        out = []
        for t in texts:
            tl = t.lower()
            if "angry" in tl or "intense" in tl:
                out.append([1.0, 0.0, 0.0, 0.0])
            elif "cheeky" in tl or "silly" in tl:
                out.append([0.0, 1.0, 0.0, 0.0])
            else:
                out.append([0.0, 0.0, 1.0, 0.0])
        return np.array(out, dtype=np.float32)

    monkeypatch.setattr(si, "encode_texts", fake_encode_texts)

    indexed = si.index_catalog_semantics(catalog, cache_dir=tmp_path)
    assert "angry / intense" in indexed.scenes[0].semantic_tags
    assert indexed.scenes[0].dominant_expression == "angry / intense"
    assert "cheeky / playful" in indexed.scenes[1].semantic_tags

    hits = si.semantic_search_scenes(indexed, "silly goofy reaction", cache_dir=tmp_path, top_k=2)
    assert hits[0][0] == 1
    assert hits[0][1] > hits[1][1]

    # Multi-frame in-memory BatchSemanticEmbedder stores #0..#K-1 and uses max similarity
    frames = [np.zeros((32, 32, 3), dtype=np.uint8) for _ in range(3)]
    monkeypatch.setattr(
        si,
        "encode_bgr_frames",
        lambda fs, **kwargs: np.array(
            [[0.0, 0.0, 0.0, 1.0], [1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]],
            dtype=np.float32,
        ),
    )
    embedder = si.BatchSemanticEmbedder(cache_dir=tmp_path)
    tags, scores, expr = embedder.embed_scene_frames("/media/atla.mp4|10.000|15.000", frames)
    embedder.flush()
    assert "angry / intense" in tags
    assert expr == "angry / intense"
    assert scores is not None

    multi_cat = ScenesCatalog(
        source_files=["/media/atla.mp4"],
        total_scenes=1,
        scenes=[
            SceneCut(
                scene_id=0,
                source_file="/media/atla.mp4",
                start_time=10.0,
                end_time=15.0,
                duration=5.0,
            )
        ],
    )
    multi_hits = si.semantic_search_scenes(multi_cat, "angry intense scowl", cache_dir=tmp_path, top_k=1)
    assert multi_hits == [(0, 1.0)]
