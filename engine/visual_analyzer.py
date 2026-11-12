"""
Visual Analyzer for AMV Maker.
Runs PySceneDetect to identify cuts and export representative keyframe thumbnails.
Calculates frame sharpness (Laplacian variance) and brightness metrics.
"""

from __future__ import annotations
from pathlib import Path
from typing import List, Tuple
import cv2
import numpy as np
from scenedetect import open_video, SceneManager, ContentDetector

from engine.models import SceneCut, ScenesCatalog


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm"}


def compute_frame_metrics(frame: np.ndarray) -> tuple[float, float]:
    """Computes Laplacian variance (sharpness) and average brightness."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray))
    return round(sharpness, 2), round(brightness, 2)


def analyze_image(
    image_path: str | Path,
    output_thumbnail_dir: str | Path = "cache/thumbnails",
    default_duration: float = 8.0,
) -> SceneCut:
    """
    Analyzes a still image (JPG, PNG, WebP) and produces a SceneCut.
    Extracts metrics (sharpness, brightness) and saves a preview thumbnail.
    """
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Image file not found: {image_path}")

    output_dir = Path(output_thumbnail_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    frame = cv2.imread(str(image_path))
    if frame is None:
        raise ValueError(f"Could not read image file: {image_path}")

    thumb_name = f"{image_path.stem}_img.jpg"
    thumb_path = output_dir / thumb_name
    h, w = frame.shape[:2]
    target_w = 480
    target_h = int(h * (target_w / w)) if w > 0 else h
    resized = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(thumb_path), resized, [cv2.IMWRITE_JPEG_QUALITY, 85])

    sharpness, brightness = compute_frame_metrics(frame)

    return SceneCut(
        scene_id=0,
        source_file=str(image_path.resolve()),
        start_time=0.0,
        end_time=round(default_duration, 3),
        duration=round(default_duration, 3),
        keyframe_path=str(thumb_path),
        sharpness_score=sharpness,
        motion_score=0.0,
        brightness_score=brightness,
    )


def analyze_video(
    video_path: str | Path,
    output_thumbnail_dir: str | Path = "cache/thumbnails",
    detector_threshold: float = 27.0,
) -> List[SceneCut]:
    """
    Detects scenes in a video file and saves keyframe thumbnails.
    If no scene cuts are detected (e.g. static or single continuous clip),
    treats the entire video as a single scene.
    """
    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    output_dir = Path(output_thumbnail_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    video = open_video(str(video_path))
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=detector_threshold))
    scene_manager.detect_scenes(video)
    scene_list = scene_manager.get_scene_list()

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    total_duration = total_frames / fps if fps > 0 else 0.0

    # If no cuts were detected, treat the entire clip as a single scene
    if not scene_list:
        raw_scenes: List[Tuple[float, float]] = [(0.0, total_duration)]
    else:
        raw_scenes = [
            (
                s.get_seconds() if hasattr(s, "get_seconds") else float(s),
                e.get_seconds() if hasattr(e, "get_seconds") else float(e),
            )
            for s, e in scene_list
        ]

    scene_cuts: List[SceneCut] = []

    for idx, (start_sec, end_sec) in enumerate(raw_scenes):
        duration = max(0.0, end_sec - start_sec)

        # Extract midpoint frame for keyframe preview
        mid_sec = start_sec + (duration / 2.0)
        cap.set(cv2.CAP_PROP_POS_MSEC, mid_sec * 1000.0)
        ret, frame = cap.read()

        thumb_path_str = None
        sharpness, brightness = None, None

        if ret and frame is not None:
            thumb_name = f"{video_path.stem}_scene_{idx:04d}.jpg"
            thumb_path = output_dir / thumb_name
            # Resize thumbnail for lightweight LLM ingestion and fast UI rendering
            h, w = frame.shape[:2]
            target_w = 480
            target_h = int(h * (target_w / w)) if w > 0 else h
            resized = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(thumb_path), resized, [cv2.IMWRITE_JPEG_QUALITY, 85])
            thumb_path_str = str(thumb_path)
            sharpness, brightness = compute_frame_metrics(frame)

        scene_cuts.append(
            SceneCut(
                scene_id=idx,
                source_file=str(video_path.resolve()),
                start_time=round(start_sec, 3),
                end_time=round(end_sec, 3),
                duration=round(duration, 3),
                keyframe_path=thumb_path_str,
                sharpness_score=sharpness,
                motion_score=None,
                brightness_score=brightness,
            )
        )

    cap.release()
    return scene_cuts


def analyze_directory(
    video_dir: str | Path,
    output_thumbnail_dir: str | Path = "cache/thumbnails",
    detector_threshold: float = 27.0,
) -> ScenesCatalog:
    """
    Analyzes all video files in a directory and returns a unified ScenesCatalog.
    """
    video_dir = Path(video_dir)
    if not video_dir.exists():
        raise FileNotFoundError(f"Video directory not found: {video_dir}")
    if not video_dir.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {video_dir}")

    media_extensions = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS
    media_files = [f for f in video_dir.iterdir() if f.suffix.lower() in media_extensions]

    all_scenes: List[SceneCut] = []
    global_scene_id = 0

    for m_file in sorted(media_files):
        ext = m_file.suffix.lower()
        if ext in IMAGE_EXTENSIONS:
            cut = analyze_image(m_file, output_thumbnail_dir)
            cut.scene_id = global_scene_id
            global_scene_id += 1
            all_scenes.append(cut)
        else:
            cuts = analyze_video(m_file, output_thumbnail_dir, detector_threshold=detector_threshold)
            for cut in cuts:
                cut.scene_id = global_scene_id
                global_scene_id += 1
                all_scenes.append(cut)

    return ScenesCatalog(
        source_files=[str(f.resolve()) for f in sorted(media_files)],
        total_scenes=len(all_scenes),
        scenes=all_scenes,
    )
