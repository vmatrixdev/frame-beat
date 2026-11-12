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
from engine.face_analyzer import analyze_frame_semantics, analyze_frames_semantics


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm"}


def compute_frame_metrics(frame: np.ndarray) -> tuple[float, float]:
    """Computes Laplacian variance (sharpness) and average brightness."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray))
    return round(sharpness, 2), round(brightness, 2)


def compute_motion_score(frames: List[np.ndarray]) -> float:
    """
    Computes an average 0-100 motion score across a sequence of BGR frames
    using downscaled grayscale frame differences.
    """
    if len(frames) < 2:
        return 0.0
    prev_gray = cv2.cvtColor(
        cv2.resize(frames[0], (160, 90), interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2GRAY,
    )
    diffs: List[float] = []
    for f in frames[1:]:
        curr_gray = cv2.cvtColor(
            cv2.resize(f, (160, 90), interpolation=cv2.INTER_AREA),
            cv2.COLOR_BGR2GRAY,
        )
        diff = float(np.mean(np.abs(curr_gray.astype(np.float32) - prev_gray.astype(np.float32))))
        diffs.append(min(100.0, diff * 3.0))
        prev_gray = curr_gray
    return round(sum(diffs) / len(diffs), 2) if diffs else 0.0


def extract_highlight_windows(
    cap: cv2.VideoCapture,
    start_sec: float,
    end_sec: float,
    max_scene_duration: float = 5.5,
    target_window_duration: float = 3.5,
    min_window_duration: float = 2.0,
) -> List[Tuple[float, float, Optional[float]]]:
    """
    Subdivides long continuous scenes (> max_scene_duration) into tight highlight
    windows using Visual Highlight Windowing (motion, sharpness, exposure,
    colorfulness, and MediaPipe face/smile peaks).
    Short scenes are returned as a single window.
    Returns a list of (win_start, win_end, motion_score_or_none).
    """
    duration = max(0.0, end_sec - start_sec)
    if duration <= max_scene_duration:
        return [(start_sec, end_sec, None)]

    # Sample evenly across the long scene (at ~0.5s intervals, capped at 60 samples)
    step_sec = max(0.5, duration / 60.0)
    sample_times: List[float] = []
    t = start_sec + step_sec * 0.5
    while t < end_sec:
        sample_times.append(t)
        t += step_sec
    if len(sample_times) < 2:
        return [(start_sec, end_sec, None)]

    scores: List[float] = []
    motions: List[float] = []
    prev_gray: np.ndarray | None = None

    for t_sec in sample_times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t_sec * 1000.0)
        ret, frame = cap.read()
        if not ret or frame is None:
            scores.append(0.0)
            motions.append(0.0)
            continue

        small = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)

        if prev_gray is None:
            motion_val = 15.0
        else:
            diff = float(np.mean(np.abs(gray.astype(np.float32) - prev_gray.astype(np.float32))))
            motion_val = min(100.0, diff * 3.0)
        prev_gray = gray
        motions.append(motion_val)

        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        mean_bright = float(np.mean(gray))
        sat_norm = float(np.mean(hsv[:, :, 1])) / 255.0

        exposure_ok = 1.0 if 25.0 <= mean_bright <= 235.0 else 0.35
        sharp_norm = min(1.0, lap_var / 400.0)
        motion_norm = (
            min(1.0, motion_val / 60.0)
            if motion_val <= 75.0
            else max(0.2, 1.0 - (motion_val - 75.0) / 50.0)
        )

        sem = analyze_frame_semantics(frame)
        face_bonus = (0.30 if sem["has_faces"] else 0.0) + (0.50 * (sem["smile_score"] or 0.0))

        interest = exposure_ok * (
            0.30 * sharp_norm + 0.35 * motion_norm + 0.15 * sat_norm + face_bonus
        )
        scores.append(interest)

    # Smooth scores with a 3-tap kernel [0.25, 0.5, 0.25] to favor sustained moments
    smoothed: List[float] = []
    for i in range(len(scores)):
        left = scores[i - 1] if i > 0 else scores[i]
        right = scores[i + 1] if i + 1 < len(scores) else scores[i]
        smoothed.append(0.25 * left + 0.5 * scores[i] + 0.25 * right)

    target_count = max(2, min(8, int(round(duration / 4.5))))
    half_win = target_window_duration / 2.0
    ranked_indices = sorted(range(len(smoothed)), key=lambda i: smoothed[i], reverse=True)

    selected: List[Tuple[float, float, float]] = []
    for idx in ranked_indices:
        if len(selected) >= target_count:
            break
        peak_t = sample_times[idx]
        w_start = max(start_sec, peak_t - half_win)
        w_end = min(end_sec, peak_t + half_win)

        # Preserve full window length when peak is near a scene edge
        if w_end - w_start < target_window_duration:
            if w_start <= start_sec + 1e-6:
                w_end = min(end_sec, start_sec + target_window_duration)
            elif w_end >= end_sec - 1e-6:
                w_start = max(start_sec, end_sec - target_window_duration)

        # Clip against any already-selected windows to prevent overlap
        for s_start, s_end, _ in selected:
            if w_start < s_end and w_end > s_start:
                if peak_t >= s_end:
                    w_start = max(w_start, s_end)
                elif peak_t <= s_start:
                    w_end = min(w_end, s_start)
                else:
                    w_end = w_start
                    break

        if w_end - w_start < min_window_duration:
            continue

        win_motions = [
            motions[j]
            for j, tj in enumerate(sample_times)
            if w_start <= tj <= w_end
        ]
        avg_motion = round(sum(win_motions) / len(win_motions), 2) if win_motions else 0.0
        selected.append((round(w_start, 3), round(w_end, 3), avg_motion))

    if not selected:
        # Uniform fallback if peaks were too close to yield valid windows
        cur = start_sec
        while cur < end_sec - 0.1:
            nxt = min(end_sec, cur + target_window_duration)
            if nxt - cur >= min_window_duration or not selected:
                selected.append((round(cur, 3), round(nxt, 3), None))
            cur = nxt

    selected.sort(key=lambda w: w[0])
    return selected


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
    semantics = analyze_frame_semantics(frame)

    return SceneCut(
        scene_id=0,
        source_file=str(image_path.resolve()),
        start_time=0.0,
        end_time=0.0,
        duration=0.0,
        media_type="image",
        is_still_image=True,
        keyframe_path=str(thumb_path),
        sharpness_score=sharpness,
        motion_score=0.0,
        brightness_score=brightness,
        has_faces=semantics["has_faces"],
        face_count=semantics["face_count"],
        dominant_expression=semantics["dominant_expression"],
        smile_score=semantics["smile_score"],
        subject_prominence=semantics["subject_prominence"],
    )


def analyze_video(
    video_path: str | Path,
    output_thumbnail_dir: str | Path = "cache/thumbnails",
    detector_threshold: float = 27.0,
    max_scene_duration: float = 5.5,
    target_window_duration: float = 3.5,
) -> List[SceneCut]:
    """
    Detects scenes in a video file and saves keyframe thumbnails.
    Long continuous scenes (> max_scene_duration) are subdivided into tight
    highlight windows using Visual Highlight Windowing.
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

    # Subdivide overly long or continuous scenes into tight highlight windows
    highlight_windows: List[Tuple[float, float, Optional[float]]] = []
    for raw_start, raw_end in raw_scenes:
        highlight_windows.extend(
            extract_highlight_windows(
                cap,
                raw_start,
                raw_end,
                max_scene_duration=max_scene_duration,
                target_window_duration=target_window_duration,
            )
        )

    scene_cuts: List[SceneCut] = []

    for idx, (start_sec, end_sec, win_motion) in enumerate(highlight_windows):
        duration = max(0.0, end_sec - start_sec)

        # Sample evenly spaced frames across the highlight segment (up to 5)
        sample_fracs = [0.5] if duration <= 1.0 else [0.15, 0.35, 0.5, 0.65, 0.85]
        sampled_frames: List[np.ndarray] = []
        for frac in sample_fracs:
            t_sec = start_sec + (duration * frac)
            cap.set(cv2.CAP_PROP_POS_MSEC, t_sec * 1000.0)
            ret, f = cap.read()
            if ret and f is not None:
                sampled_frames.append(f)

        thumb_path_str = None
        sharpness, brightness = None, None
        motion = win_motion
        semantics = {
            "has_faces": False,
            "face_count": 0,
            "dominant_expression": None,
            "smile_score": None,
            "subject_prominence": "scenic",
        }

        if sampled_frames:
            semantics, best_idx = analyze_frames_semantics(sampled_frames)
            frame = sampled_frames[best_idx]
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
            if motion is None and len(sampled_frames) >= 2:
                motion = compute_motion_score(sampled_frames)

        scene_cuts.append(
            SceneCut(
                scene_id=idx,
                source_file=str(video_path.resolve()),
                start_time=round(start_sec, 3),
                end_time=round(end_sec, 3),
                duration=round(duration, 3),
                keyframe_path=thumb_path_str,
                sharpness_score=sharpness,
                motion_score=motion,
                brightness_score=brightness,
                has_faces=semantics["has_faces"],
                face_count=semantics["face_count"],
                dominant_expression=semantics["dominant_expression"],
                smile_score=semantics["smile_score"],
                subject_prominence=semantics["subject_prominence"],
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


def analyze_single_segment(
    source_path: str | Path,
    start_time: float = 0.0,
    end_time: float = 0.0,
    sample_frames: int = 5,
    output_thumbnail_dir: str | Path = "cache/thumbnails",
    scene_id: int = 0,
) -> SceneCut:
    """
    Runs static visual + MediaPipe face/emotion analysis on a single image or
    a specific [start_time, end_time] segment of a video with configurable sampling.
    """
    source_path = Path(source_path)
    if not source_path.exists():
        raise FileNotFoundError(f"Source file not found: {source_path}")

    if source_path.suffix.lower() in IMAGE_EXTENSIONS:
        cut = analyze_image(source_path, output_thumbnail_dir=output_thumbnail_dir)
        cut.scene_id = scene_id
        return cut

    output_dir = Path(output_thumbnail_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(source_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    total_duration = total_frames / fps if fps > 0 else 0.0

    start_sec = max(0.0, start_time)
    end_sec = end_time if end_time > start_sec else total_duration
    duration = max(0.0, end_sec - start_sec)

    n_samples = max(1, min(30, int(sample_frames)))
    if n_samples == 1 or duration <= 0.2:
        sample_fracs = [0.5]
    else:
        sample_fracs = [0.05 + (0.9 * i / (n_samples - 1)) for i in range(n_samples)]

    sampled_frames: List[np.ndarray] = []
    for frac in sample_fracs:
        t_sec = start_sec + (duration * frac)
        cap.set(cv2.CAP_PROP_POS_MSEC, t_sec * 1000.0)
        ret, f = cap.read()
        if ret and f is not None:
            sampled_frames.append(f)
    cap.release()

    thumb_path_str = None
    sharpness, brightness, motion = None, None, None
    semantics = {
        "has_faces": False,
        "face_count": 0,
        "dominant_expression": None,
        "smile_score": None,
        "subject_prominence": "scenic",
    }

    if sampled_frames:
        semantics, best_idx = analyze_frames_semantics(sampled_frames)
        frame = sampled_frames[best_idx]
        thumb_name = f"{source_path.stem}_seg_{int(start_sec * 1000)}_{int(end_sec * 1000)}.jpg"
        thumb_path = output_dir / thumb_name
        h, w = frame.shape[:2]
        target_w = 480
        target_h = int(h * (target_w / w)) if w > 0 else h
        resized = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(thumb_path), resized, [cv2.IMWRITE_JPEG_QUALITY, 85])
        thumb_path_str = str(thumb_path)
        sharpness, brightness = compute_frame_metrics(frame)
        if len(sampled_frames) >= 2:
            motion = compute_motion_score(sampled_frames)

    return SceneCut(
        scene_id=scene_id,
        source_file=str(source_path.resolve()),
        start_time=round(start_sec, 3),
        end_time=round(end_sec, 3),
        duration=round(duration, 3),
        keyframe_path=thumb_path_str,
        sharpness_score=sharpness,
        motion_score=motion,
        brightness_score=brightness,
        has_faces=semantics["has_faces"],
        face_count=semantics["face_count"],
        dominant_expression=semantics["dominant_expression"],
        smile_score=semantics["smile_score"],
        subject_prominence=semantics["subject_prominence"],
    )
