"""
Local Facial Emotion & Subject Prominence Analyzer.
Uses Google MediaPipe FaceLandmarker (52 blendshapes) locally on CPU/XNNPACK
to extract face count, smile confidence, expression, and framing prominence.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np

logger = logging.getLogger(__name__)

_DEFAULT_MODEL_PATH = Path(__file__).resolve().parent / "assets" / "face_landmarker.task"
_LANDMARKER_INSTANCE: Optional[Any] = None
_LANDMARKER_INIT_FAILED: bool = False


def _get_landmarker(model_path: Path = _DEFAULT_MODEL_PATH) -> Optional[Any]:
    """Lazily initializes and caches the MediaPipe FaceLandmarker singleton."""
    global _LANDMARKER_INSTANCE, _LANDMARKER_INIT_FAILED
    if _LANDMARKER_INSTANCE is not None:
        return _LANDMARKER_INSTANCE
    if _LANDMARKER_INIT_FAILED:
        return None

    if not model_path.is_file():
        logger.debug(f"MediaPipe FaceLandmarker model not found at {model_path}; skipping face analysis.")
        _LANDMARKER_INIT_FAILED = True
        return None

    try:
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        base_options = mp_python.BaseOptions(model_asset_path=str(model_path))
        options = mp_vision.FaceLandmarkerOptions(
            base_options=base_options,
            output_face_blendshapes=True,
            num_faces=5,
            min_face_detection_confidence=0.3,
            min_face_presence_confidence=0.3,
        )
        _LANDMARKER_INSTANCE = mp_vision.FaceLandmarker.create_from_options(options)
        return _LANDMARKER_INSTANCE
    except Exception as e:
        logger.warning(f"Could not initialize MediaPipe FaceLandmarker: {e}")
        _LANDMARKER_INIT_FAILED = True
        return None


def analyze_frame_semantics(frame_bgr: np.ndarray) -> Dict[str, Any]:
    """
    Runs local face landmark & blendshape inference on an OpenCV BGR frame.
    Returns dictionary with has_faces, face_count, dominant_expression,
    smile_score, and subject_prominence.
    """
    default_result: Dict[str, Any] = {
        "has_faces": False,
        "face_count": 0,
        "dominant_expression": None,
        "smile_score": None,
        "subject_prominence": "scenic",
    }

    if frame_bgr is None or frame_bgr.size == 0:
        return default_result

    landmarker = _get_landmarker()
    if landmarker is None:
        return default_result

    try:
        import mediapipe as mp

        # Downscale very large frames before inference for speed (<5ms)
        h, w = frame_bgr.shape[:2]
        if w > 960:
            scale = 960.0 / w
            resized = cv2.resize(frame_bgr, (960, int(h * scale)), interpolation=cv2.INTER_AREA)
        else:
            resized = frame_bgr

        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect(mp_image)

        landmarks_list = result.face_landmarks or []
        face_count = len(landmarks_list)
        if face_count == 0:
            return default_result

        # Calculate max normalized face bounding box area for framing prominence
        max_area = 0.0
        for landmarks in landmarks_list:
            xs = [lm.x for lm in landmarks]
            ys = [lm.y for lm in landmarks]
            area = max(0.0, (max(xs) - min(xs)) * (max(ys) - min(ys)))
            if area > max_area:
                max_area = area

        if max_area >= 0.06:
            prominence = "close_up"
        elif max_area >= 0.015:
            prominence = "medium_shot"
        else:
            prominence = "wide_shot"

        # Extract facial blendshapes (pick most expressive / highest smile across faces)
        best_smile = 0.0
        best_jaw = 0.0
        best_brow = 0.0

        blendshapes_list = result.face_blendshapes or []
        for face_bs in blendshapes_list:
            bs_map = {b.category_name: b.score for b in face_bs}
            smile = (bs_map.get("mouthSmileLeft", 0.0) + bs_map.get("mouthSmileRight", 0.0)) / 2.0
            jaw = bs_map.get("jawOpen", 0.0)
            brow = bs_map.get("browInnerUp", 0.0)
            if smile >= best_smile:
                best_smile = smile
                best_jaw = jaw
                best_brow = brow

        smile_score = round(float(best_smile), 3)

        if best_smile >= 0.45 and best_jaw >= 0.25:
            expression = "laughing / ecstatic"
        elif best_smile >= 0.35:
            expression = "joyful / smiling"
        elif best_brow >= 0.40:
            expression = "surprised / expressive"
        else:
            expression = "calm / neutral"

        return {
            "has_faces": True,
            "face_count": face_count,
            "dominant_expression": expression,
            "smile_score": smile_score,
            "subject_prominence": prominence,
        }
    except Exception as e:
        logger.debug(f"Face semantic analysis error: {e}")
        return default_result


def analyze_frames_semantics(frames_bgr: List[np.ndarray]) -> Tuple[Dict[str, Any], int]:
    """
    Evaluates multiple sampled frames from a video highlight segment and returns
    (aggregated_semantics, best_frame_index). Prioritizes frames with detected
    faces, highest smile_score, and highest face_count.
    """
    if not frames_bgr:
        return {
            "has_faces": False,
            "face_count": 0,
            "dominant_expression": None,
            "smile_score": None,
            "subject_prominence": "scenic",
        }, 0

    best_idx = len(frames_bgr) // 2
    best_res = analyze_frame_semantics(frames_bgr[best_idx])
    best_score = (
        1 if best_res["has_faces"] else 0,
        best_res["smile_score"] or 0.0,
        best_res["face_count"] or 0,
    )

    for idx, frame in enumerate(frames_bgr):
        if idx == best_idx:
            continue
        res = analyze_frame_semantics(frame)
        score = (
            1 if res["has_faces"] else 0,
            res["smile_score"] or 0.0,
            res["face_count"] or 0,
        )
        if score > best_score:
            best_score = score
            best_res = res
            best_idx = idx

    return best_res, best_idx
