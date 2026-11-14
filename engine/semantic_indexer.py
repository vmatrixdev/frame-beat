"""
Local SigLIP Semantic Indexer (`engine/semantic_indexer.py`).

Computes and caches L2-normalized vision-language embeddings for scene keyframes
using Google's SigLIP (`google/siglip-base-patch16-224` by default) on Apple
Silicon MPS or CPU, enabling style-agnostic (anime + live-action) vibe/expression
tagging and natural-language semantic search without cloud API calls.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import numpy as np

from engine.models import SceneCut, ScenesCatalog

logger = logging.getLogger(__name__)

DEFAULT_SIGLIP_MODEL = os.environ.get("SIGLIP_MODEL", "google/siglip-base-patch16-224")

VIBE_PROMPTS: Dict[str, str] = {
    "joyful / smiling": "a happy smiling joyful person or animated character",
    "angry / intense": "an angry intense furious scowling face or expression",
    "brave / determined": "a brave determined fierce heroic expression",
    "cheeky / playful": "a cheeky playful smirking mischievous expression",
    "silly / goofy": "a silly goofy funny comedic reaction",
    "sad / melancholic": "a sad crying sorrowful melancholic expression",
    "surprised / shocked": "a surprised shocked amazed wide-eyed expression",
    "calm / serene": "a calm peaceful serene relaxed scene or face",
    "epic action / fight": "an intense epic action battle fight dynamic motion scene",
    "warm / intimate": "a warm affectionate emotional close moment or hug",
}

EXPRESSION_VIBES = {
    "joyful / smiling",
    "angry / intense",
    "brave / determined",
    "cheeky / playful",
    "silly / goofy",
    "sad / melancholic",
    "surprised / shocked",
}

_MODEL_CACHE: Dict[str, object] = {}


def is_siglip_available() -> bool:
    """Return True if torch and transformers are importable."""
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
        return True
    except ImportError:
        return False


def _get_siglip(model_name: str = DEFAULT_SIGLIP_MODEL):
    """Lazily load and cache SigLIP model, processor, and device."""
    if model_name in _MODEL_CACHE:
        return _MODEL_CACHE[model_name]

    import torch
    from transformers import AutoModel, AutoProcessor

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name).to(device)
    model.eval()
    bundle = (model, processor, device)
    _MODEL_CACHE[model_name] = bundle
    return bundle


def resolve_keyframe_path(keyframe_path: Optional[str], project_root: Optional[Path] = None) -> Optional[Path]:
    """Resolve a SceneCut keyframe_path (including `/api/thumb?path=...`) to a local file."""
    if not keyframe_path:
        return None
    kp = keyframe_path
    if kp.startswith("/api/thumb"):
        qs = parse_qs(urlparse(kp).query)
        kp = qs.get("path", [""])[0]
    if not kp:
        return None
    p = Path(kp)
    if not p.is_absolute():
        root = project_root or Path(__file__).resolve().parent.parent
        p = root / p
    return p if p.is_file() else None


def _scene_cache_key(scene: SceneCut) -> str:
    return f"{scene.source_file}|{scene.start_time:.3f}|{scene.end_time:.3f}"


def _load_embedding_cache(cache_file: Path) -> Dict[str, np.ndarray]:
    if not cache_file.is_file():
        return {}
    try:
        data = np.load(cache_file, allow_pickle=False)
        keys = data["keys"]
        vecs = data["embeddings"]
        return {str(k): vecs[i] for i, k in enumerate(keys)}
    except Exception as e:
        logger.warning(f"Failed to load SigLIP cache {cache_file}: {e}")
        return {}


def _save_embedding_cache(cache_file: Path, cache_map: Dict[str, np.ndarray]) -> None:
    if not cache_map:
        return
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    keys = np.array(list(cache_map.keys()))
    vecs = np.stack(list(cache_map.values()), axis=0).astype(np.float32)
    np.savez_compressed(cache_file, keys=keys, embeddings=vecs)


def encode_texts(texts: List[str], model_name: str = DEFAULT_SIGLIP_MODEL) -> np.ndarray:
    """Encode text queries into L2-normalized SigLIP embeddings `[N, D]`."""
    import torch

    model, processor, device = _get_siglip(model_name)
    inputs = processor(text=texts, padding="max_length", truncation=True, return_tensors="pt").to(device)
    with torch.no_grad():
        feats = model.get_text_features(**inputs)
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats.detach().cpu().numpy().astype(np.float32)


def encode_bgr_frames(
    frames_bgr: List[np.ndarray], model_name: str = DEFAULT_SIGLIP_MODEL, batch_size: int = 16
) -> np.ndarray:
    """Encode in-memory OpenCV BGR frames into L2-normalized SigLIP embeddings `[N, D]`."""
    import cv2
    import torch
    from PIL import Image

    model, processor, device = _get_siglip(model_name)
    all_vecs: List[np.ndarray] = []
    for i in range(0, len(frames_bgr), batch_size):
        batch = frames_bgr[i : i + batch_size]
        imgs = [Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)) for f in batch]
        inputs = processor(images=imgs, return_tensors="pt").to(device)
        with torch.no_grad():
            feats = model.get_image_features(**inputs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        all_vecs.append(feats.detach().cpu().numpy().astype(np.float32))
    return np.concatenate(all_vecs, axis=0) if all_vecs else np.zeros((0, 768), dtype=np.float32)


def score_scene_vectors(
    frame_vecs: np.ndarray,
    vibe_vecs: np.ndarray,
    vibe_labels: List[str],
) -> Tuple[List[str], Dict[str, float], Optional[str]]:
    """
    Score `[K, D]` frame vectors against `[V, D]` vibe prompt vectors using
    max-pooling across the K sampled frames so brief reactions are preserved.
    """
    if frame_vecs.ndim == 1:
        frame_vecs = frame_vecs[None, :]
    sims = np.einsum(
        "kd,vd->kv",
        frame_vecs.astype(np.float64),
        vibe_vecs.astype(np.float64),
    ).max(axis=0)
    min_s = float(sims.min())
    max_s = float(sims.max())
    denom = max(1e-5, max_s - min_s)
    rel_scores = {
        label: round(float((sims[idx] - min_s) / denom), 3)
        for idx, label in enumerate(vibe_labels)
    }
    ranked_vibes = sorted(rel_scores.items(), key=lambda kv: -kv[1])
    top_tags = [label for label, sc in ranked_vibes[:3] if sc >= 0.55]
    top_expr = next((lbl for lbl, sc in ranked_vibes if lbl in EXPRESSION_VIBES and sc >= 0.65), None)
    return top_tags, rel_scores, top_expr


def encode_images(image_paths: List[Path], model_name: str = DEFAULT_SIGLIP_MODEL, batch_size: int = 16) -> np.ndarray:
    """Encode image files into L2-normalized SigLIP embeddings `[N, D]`."""
    import torch
    from PIL import Image

    model, processor, device = _get_siglip(model_name)
    all_vecs: List[np.ndarray] = []
    for i in range(0, len(image_paths), batch_size):
        batch_paths = image_paths[i : i + batch_size]
        imgs = [Image.open(p).convert("RGB") for p in batch_paths]
        inputs = processor(images=imgs, return_tensors="pt").to(device)
        with torch.no_grad():
            feats = model.get_image_features(**inputs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        all_vecs.append(feats.detach().cpu().numpy().astype(np.float32))
    return np.concatenate(all_vecs, axis=0) if all_vecs else np.zeros((0, 768), dtype=np.float32)


def index_catalog_semantics(
    catalog: ScenesCatalog,
    cache_dir: Optional[Path] = None,
    force_recompute: bool = False,
    model_name: str = DEFAULT_SIGLIP_MODEL,
) -> ScenesCatalog:
    """
    Compute & cache SigLIP embeddings for all scenes with keyframes in `catalog`,
    populating `semantic_tags`, `vibe_scores`, and upgrading missing/neutral
    `dominant_expression` on anime/stylized footage.
    """
    if not is_siglip_available():
        logger.info("SigLIP dependencies (torch/transformers) not installed; skipping semantic indexing.")
        return catalog

    project_root = Path(__file__).resolve().parent.parent
    resolved_cache_dir = cache_dir or (project_root / "cache")
    cache_file = resolved_cache_dir / "siglip_embeddings.npz"
    cache_map = {} if force_recompute else _load_embedding_cache(cache_file)

    to_encode: List[Tuple[str, Path]] = []
    for scene in catalog.scenes:
        key = _scene_cache_key(scene)
        if key not in cache_map:
            kp = resolve_keyframe_path(scene.keyframe_path, project_root)
            if kp is not None:
                to_encode.append((key, kp))

    if to_encode:
        vecs = encode_images([p for _, p in to_encode], model_name=model_name)
        for (key, _), vec in zip(to_encode, vecs):
            cache_map[key] = vec
        _save_embedding_cache(cache_file, cache_map)

    vibe_labels = list(VIBE_PROMPTS.keys())
    vibe_vecs = encode_texts([VIBE_PROMPTS[k] for k in vibe_labels], model_name=model_name)

    updated_scenes: List[SceneCut] = []
    for scene in catalog.scenes:
        key = _scene_cache_key(scene)
        vec = cache_map.get(key)
        if vec is None:
            updated_scenes.append(scene)
            continue

        # Cosine similarities across vibe prompts, normalized relatively per scene (0..1)
        sims = np.einsum(
            "d,vd->v",
            vec.astype(np.float64),
            vibe_vecs.astype(np.float64),
        )
        min_s = float(sims.min())
        max_s = float(sims.max())
        denom = max(1e-5, max_s - min_s)
        rel_scores = {
            label: round(float((sims[idx] - min_s) / denom), 3)
            for idx, label in enumerate(vibe_labels)
        }

        ranked_vibes = sorted(rel_scores.items(), key=lambda kv: -kv[1])
        top_tags = [label for label, sc in ranked_vibes[:3] if sc >= 0.55]

        next_expr = scene.dominant_expression
        if not next_expr or next_expr == "calm / neutral":
            top_expr = next((lbl for lbl, sc in ranked_vibes if lbl in EXPRESSION_VIBES and sc >= 0.65), None)
            if top_expr:
                next_expr = top_expr

        updated_scenes.append(
            scene.model_copy(
                update={
                    "semantic_tags": top_tags,
                    "vibe_scores": rel_scores,
                    "dominant_expression": next_expr,
                }
            )
        )

    return ScenesCatalog(
        source_files=list(catalog.source_files),
        total_scenes=len(updated_scenes),
        scenes=updated_scenes,
    )


def _get_scene_vectors_from_cache(
    cache_map: Dict[str, np.ndarray], base_key: str
) -> List[np.ndarray]:
    vecs: List[np.ndarray] = []
    if base_key in cache_map:
        vecs.append(cache_map[base_key])
    idx = 0
    while f"{base_key}#{idx}" in cache_map:
        vecs.append(cache_map[f"{base_key}#{idx}"])
        idx += 1
    return vecs


class BatchSemanticEmbedder:
    """
    Reuses a loaded SigLIP model and vibe prompt embeddings across all scenes
    in an `analyze_video` run so sampled frames are embedded in-memory with zero
    video re-seeks, and persists all vectors to `siglip_embeddings.npz` on flush.
    """

    def __init__(self, cache_dir: Optional[Path] = None, model_name: str = DEFAULT_SIGLIP_MODEL):
        project_root = Path(__file__).resolve().parent.parent
        self.cache_dir = cache_dir or (project_root / "cache")
        self.cache_file = self.cache_dir / "siglip_embeddings.npz"
        self.model_name = model_name
        self.enabled = is_siglip_available()
        self.cache_map: Dict[str, np.ndarray] = (
            _load_embedding_cache(self.cache_file) if self.enabled else {}
        )
        self.vibe_labels = list(VIBE_PROMPTS.keys())
        self.vibe_vecs: Optional[np.ndarray] = None
        self._dirty = False

    def embed_scene_frames(
        self, scene_key: str, frames_bgr: List[np.ndarray]
    ) -> Tuple[List[str], Optional[Dict[str, float]], Optional[str]]:
        if not self.enabled or not frames_bgr:
            return [], None, None
        try:
            if self.vibe_vecs is None:
                self.vibe_vecs = encode_texts(
                    [VIBE_PROMPTS[k] for k in self.vibe_labels], model_name=self.model_name
                )
            vecs = encode_bgr_frames(frames_bgr, model_name=self.model_name)
            if len(vecs) == 0:
                return [], None, None
            for i, vec in enumerate(vecs):
                self.cache_map[f"{scene_key}#{i}"] = vec
            self._dirty = True
            top_tags, rel_scores, top_expr = score_scene_vectors(
                vecs, self.vibe_vecs, self.vibe_labels
            )
            return top_tags, rel_scores, top_expr
        except Exception as e:
            logger.warning(f"In-memory SigLIP embedding failed for {scene_key}: {e}")
            return [], None, None

    def flush(self) -> None:
        if self.enabled and self._dirty:
            _save_embedding_cache(self.cache_file, self.cache_map)
            self._dirty = False


def semantic_search_scenes(
    catalog: ScenesCatalog,
    query_text: str,
    cache_dir: Optional[Path] = None,
    top_k: int = 20,
    model_name: str = DEFAULT_SIGLIP_MODEL,
) -> List[Tuple[int, float]]:
    """
    Rank scenes in `catalog` against a natural-language `query_text` using cached
    SigLIP embeddings (taking max similarity across all sampled frames of a clip).
    """
    if not query_text.strip() or not is_siglip_available():
        return []

    project_root = Path(__file__).resolve().parent.parent
    resolved_cache_dir = cache_dir or (project_root / "cache")
    cache_file = resolved_cache_dir / "siglip_embeddings.npz"
    cache_map = _load_embedding_cache(cache_file)
    if not cache_map:
        return []

    query_vec = encode_texts([query_text.strip()], model_name=model_name)[0].astype(np.float64)
    scored: List[Tuple[int, float]] = []
    for scene in catalog.scenes:
        vecs = _get_scene_vectors_from_cache(cache_map, _scene_cache_key(scene))
        if vecs:
            sim = max(float(np.dot(v.astype(np.float64), query_vec)) for v in vecs)
            scored.append((scene.scene_id, round(sim, 4)))

    scored.sort(key=lambda item: -item[1])
    return scored[: max(1, top_k)]
