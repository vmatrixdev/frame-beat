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


def classify_blendshapes(bs_map: Dict[str, float]) -> Tuple[str, float, Dict[str, float]]:
    """
    Classifies facial blendshape scores into a dominant expression label,
    smile confidence, and a normalized emotion_scores dictionary.
    """
    smile = (bs_map.get("mouthSmileLeft", 0.0) + bs_map.get("mouthSmileRight", 0.0)) / 2.0
    jaw = bs_map.get("jawOpen", 0.0)
    brow_up = bs_map.get("browInnerUp", 0.0)
    brow_down = (bs_map.get("browDownLeft", 0.0) + bs_map.get("browDownRight", 0.0)) / 2.0
    nose_sneer = (bs_map.get("noseSneerLeft", 0.0) + bs_map.get("noseSneerRight", 0.0)) / 2.0
    frown = (bs_map.get("mouthFrownLeft", 0.0) + bs_map.get("mouthFrownRight", 0.0)) / 2.0
    mouth_press = (bs_map.get("mouthPressLeft", 0.0) + bs_map.get("mouthPressRight", 0.0)) / 2.0
    eye_wide = (bs_map.get("eyeWideLeft", 0.0) + bs_map.get("eyeWideRight", 0.0)) / 2.0
    eye_squint = (bs_map.get("eyeSquintLeft", 0.0) + bs_map.get("eyeSquintRight", 0.0)) / 2.0
    mouth_stretch = (bs_map.get("mouthStretchLeft", 0.0) + bs_map.get("mouthStretchRight", 0.0)) / 2.0

    joy_score = min(
        1.0,
        max(
            0.0,
            1.1 * smile
            + 0.15 * eye_squint
            + (0.20 * jaw if smile >= 0.30 and brow_down < 0.25 else 0.0)
            - 0.45 * brow_down
            - 0.35 * frown,
        ),
    )
    surprise_score = min(1.0, max(0.0, 0.45 * eye_wide + 0.35 * brow_up + 0.30 * jaw - 0.30 * smile))
    anger_score = min(
        1.0,
        max(
            0.0,
            0.55 * brow_down + 0.35 * nose_sneer + 0.25 * mouth_press + 0.15 * eye_squint - 0.15 * smile,
        ),
    )
    sadness_score = min(
        1.0, max(0.0, 0.55 * frown + 0.35 * brow_up * (1.0 - eye_wide) + 0.15 * mouth_press - 0.30 * smile)
    )
    worry_score = min(
        1.0, max(0.0, 0.35 * brow_up + 0.35 * mouth_stretch + 0.20 * frown + 0.20 * eye_wide - 0.30 * smile)
    )
    max_expr = max(joy_score, surprise_score, anger_score, sadness_score, worry_score)
    neutral_score = max(0.0, 1.0 - max_expr)

    emotion_scores = {
        "joy": round(float(joy_score), 3),
        "surprise": round(float(surprise_score), 3),
        "anger": round(float(anger_score), 3),
        "sadness": round(float(sadness_score), 3),
        "worry": round(float(worry_score), 3),
        "neutral": round(float(neutral_score), 3),
    }

    if anger_score >= 0.38 or (brow_down >= 0.45 and (nose_sneer >= 0.20 or jaw >= 0.25)):
        expression = "angry / intense"
    elif joy_score >= 0.45 and jaw >= 0.25 and brow_down < 0.25:
        expression = "laughing / ecstatic"
    elif joy_score >= 0.35 and brow_down < 0.25 and anger_score < 0.30:
        expression = "joyful / smiling"
    elif surprise_score >= 0.40 or (eye_wide >= 0.40 and jaw >= 0.25):
        expression = "surprised / amazed"
    elif sadness_score >= 0.35 or frown >= 0.40:
        expression = "sad / melancholic"
    elif worry_score >= 0.35 or (brow_up >= 0.35 and mouth_stretch >= 0.30):
        expression = "worried / tense"
    elif brow_down >= 0.28 or mouth_press >= 0.32:
        expression = "focused / determined"
    else:
        expression = "calm / neutral"

    return expression, round(float(smile), 3), emotion_scores


def analyze_frame_semantics(frame_bgr: np.ndarray) -> Dict[str, Any]:
    """
    Runs local face landmark & blendshape inference on an OpenCV BGR frame.
    Returns dictionary with has_faces, face_count, dominant_expression,
    smile_score, subject_prominence, and emotion_scores.
    """
    default_result: Dict[str, Any] = {
        "has_faces": False,
        "face_count": 0,
        "dominant_expression": None,
        "smile_score": None,
        "subject_prominence": "scenic",
        "emotion_scores": None,
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

        # Extract facial blendshapes (pick most expressive face across detected faces)
        best_expression = "calm / neutral"
        best_smile = 0.0
        best_emotions: Optional[Dict[str, float]] = {
            "joy": 0.0,
            "surprise": 0.0,
            "anger": 0.0,
            "sadness": 0.0,
            "worry": 0.0,
            "neutral": 1.0,
        }
        best_rank = (-1.0, -1.0)

        blendshapes_list = result.face_blendshapes or []
        for face_bs in blendshapes_list:
            bs_map = {b.category_name: b.score for b in face_bs}
            expr, smile_val, emotions = classify_blendshapes(bs_map)
            expressiveness = max(
                emotions["joy"],
                emotions["surprise"],
                emotions["anger"],
                emotions["sadness"],
                emotions["worry"],
            )
            rank = (expressiveness, smile_val)
            if rank > best_rank:
                best_rank = rank
                best_expression = expr
                best_smile = smile_val
                best_emotions = emotions

        return {
            "has_faces": True,
            "face_count": face_count,
            "dominant_expression": best_expression,
            "smile_score": best_smile,
            "subject_prominence": prominence,
            "emotion_scores": best_emotions,
        }
    except Exception as e:
        logger.debug(f"Face semantic analysis error: {e}")
        return default_result


def _frame_intensity(res: Dict[str, Any]) -> Tuple[int, float, int]:
    emotions = res.get("emotion_scores") or {}
    peak_emotion = max(
        (float(v) for k, v in emotions.items() if k != "neutral"),
        default=0.0,
    )
    return (
        1 if res["has_faces"] else 0,
        peak_emotion,
        res["face_count"] or 0,
    )


def analyze_frames_semantics(frames_bgr: List[np.ndarray]) -> Tuple[Dict[str, Any], int]:
    """
    Evaluates multiple sampled frames from a video highlight segment and returns
    (aggregated_semantics, best_frame_index). Prioritizes frames with detected
    faces, highest overall emotional intensity (not just smile), and face count,
    and averages emotion_scores across face-detected frames to reduce outlier noise.
    """
    if not frames_bgr:
        return {
            "has_faces": False,
            "face_count": 0,
            "dominant_expression": None,
            "smile_score": None,
            "subject_prominence": "scenic",
            "emotion_scores": None,
        }, 0

    results: List[Dict[str, Any]] = [analyze_frame_semantics(f) for f in frames_bgr]
    best_idx = len(frames_bgr) // 2
    best_res = results[best_idx]
    best_score = _frame_intensity(best_res)

    for idx, res in enumerate(results):
        score = _frame_intensity(res)
        if score > best_score:
            best_score = score
            best_res = res
            best_idx = idx

    face_results = [r for r in results if r["has_faces"] and r.get("emotion_scores")]
    if face_results:
        keys = ("joy", "surprise", "anger", "sadness", "worry", "neutral")
        avg_emotions = {
            k: round(
                sum(float(r["emotion_scores"].get(k, 0.0)) for r in face_results) / len(face_results),
                3,
            )
            for k in keys
        }
        best_res = {**best_res, "emotion_scores": avg_emotions}

    return best_res, best_idx
