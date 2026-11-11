"""
Visual Analyzer for AMV Maker.
Runs PySceneDetect to identify cuts and export representative keyframe thumbnails.
Calculates frame sharpness (Laplacian variance) and brightness metrics.
"""

from pathlib import Path
from typing import List
import cv2
import numpy as np
from scenedetect import open_video, SceneManager, ContentDetector

from engine.models import SceneCut, ScenesCatalog


def compute_frame_metrics(frame: np.ndarray) -> tuple[float, float]:
    """Computes Laplacian variance (sharpness) and average brightness."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray))
    return round(sharpness, 2), round(brightness, 2)


def analyze_video(video_path: str | Path, output_thumbnail_dir: str | Path = "cache/thumbnails") -> List[SceneCut]:
    """
    Detects scenes in a video file and saves keyframe thumbnails.
    """
    video_path = Path(video_path)
    output_dir = Path(output_thumbnail_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    video = open_video(str(video_path))
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=27.0))
    scene_manager.detect_scenes(video)
    scene_list = scene_manager.get_scene_list()

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0

    scene_cuts: List[SceneCut] = []

    for idx, (start_time, end_time) in enumerate(scene_list):
        start_sec = start_time.get_seconds()
        end_sec = end_time.get_seconds()
        duration = end_sec - start_sec

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
            target_h = int(h * (target_w / w))
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


def analyze_directory(video_dir: str | Path, output_thumbnail_dir: str | Path = "cache/thumbnails") -> ScenesCatalog:
    """Analyzes all video files in a directory."""
    video_dir = Path(video_dir)
    video_extensions = {".mp4", ".mkv", ".mov", ".avi", ".webm"}
    video_files = [f for f in video_dir.iterdir() if f.suffix.lower() in video_extensions]

    all_scenes: List[SceneCut] = []
    global_scene_id = 0

    for v_file in sorted(video_files):
        cuts = analyze_video(v_file, output_thumbnail_dir)
        for cut in cuts:
            cut.scene_id = global_scene_id
            global_scene_id += 1
            all_scenes.append(cut)

    return ScenesCatalog(
        source_files=[str(f.resolve()) for f in video_files],
        total_scenes=len(all_scenes),
        scenes=all_scenes,
    )
