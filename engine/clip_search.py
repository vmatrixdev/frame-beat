"""
Static Clip Search & Indexing Tools (`engine/clip_search.py`).

Provides deterministic, local query tools over an already-analyzed
`ScenesCatalog` so both the offline heuristic shortlister and Gemini tool-calling
can search, filter, and inspect clips without stuffing raw catalogs into prompts.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from engine.models import ClipSearchQuery, SceneCut, ScenesCatalog


def _scene_to_compact_dict(scene: SceneCut) -> Dict[str, Any]:
    """Serialize a SceneCut into a compact metadata dict for tool responses."""
    return {
        "scene_id": scene.scene_id,
        "source_file": scene.source_file,
        "file_name": Path(scene.source_file).name,
        "start_time": scene.start_time,
        "end_time": scene.end_time,
        "duration": scene.duration,
        "media_type": scene.media_type,
        "is_still_image": scene.is_still_image,
        "visual_mood": scene.visual_mood,
        "color_mood": scene.color_mood,
        "dominant_expression": scene.dominant_expression,
        "has_faces": scene.has_faces,
        "face_count": scene.face_count,
        "subject_prominence": scene.subject_prominence,
        "fluidity_score": scene.fluidity_score,
        "dramatism_score": scene.dramatism_score,
        "contrast_score": scene.contrast_score,
        "saturation_score": scene.saturation_score,
        "sharpness_score": scene.sharpness_score,
        "emotion_scores": scene.emotion_scores,
        "user_tags": scene.user_tags,
        "user_note": scene.user_note,
        "semantic_tags": scene.semantic_tags,
    }


def list_source_summaries(catalog: ScenesCatalog) -> List[Dict[str, Any]]:
    """Summarize each indexed source media file (clip count, moods, and user tags)."""
    by_file: Dict[str, List[SceneCut]] = {}
    for s in catalog.scenes:
        by_file.setdefault(s.source_file, []).append(s)

    summaries: List[Dict[str, Any]] = []
    for src in catalog.source_files:
        clips = by_file.get(src, [])
        moods = Counter(c.visual_mood for c in clips if c.visual_mood)
        color_moods = Counter(c.color_mood for c in clips if c.color_mood)
        tags = sorted({t for c in clips for t in c.user_tags})
        summaries.append(
            {
                "source_file": src,
                "file_name": Path(src).name,
                "clip_count": len(clips),
                "top_visual_moods": [m for m, _ in moods.most_common(3)],
                "top_color_moods": [m for m, _ in color_moods.most_common(3)],
                "user_tags": tags[:20],
            }
        )
    return summaries


def search_scenes(
    catalog: ScenesCatalog,
    query_text: Optional[str] = None,
    tags: Optional[List[str]] = None,
    semantic_tag: Optional[str] = None,
    visual_mood: Optional[str] = None,
    color_mood: Optional[str] = None,
    expression: Optional[str] = None,
    min_duration: Optional[float] = None,
    max_duration: Optional[float] = None,
    min_fluidity: Optional[float] = None,
    min_dramatism: Optional[float] = None,
    has_faces: Optional[bool] = None,
    media_type: Optional[str] = None,
    source_file: Optional[str] = None,
    sort_by: str = "relevance",
    limit: int = 12,
    cache_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """
    Filter and rank analyzed scenes from the catalog by mood, tags, notes,
    facial expression, motion fluidity, dramatism, duration, or media type.
    Shared by both the UI clip browser and Gemini agent tool calls.
    """
    stopwords = {
        "of", "the", "and", "or", "in", "on", "at", "to", "for",
        "with", "by", "from", "is", "are", "was", "were", "be", "an", "as", "into",
    }
    tokens = [
        tok.strip().lower()
        for tok in (query_text or "").replace(",", " ").split()
        if len(tok.strip()) >= 2 and tok.strip().lower() not in stopwords
    ]
    tag_set = {t.strip().lower() for t in (tags or []) if t.strip()}

    semantic_raw: Dict[int, float] = {}
    semantic_boost: Dict[int, float] = {}
    if query_text and query_text.strip():
        try:
            from engine.semantic_indexer import semantic_search_scenes

            top_k = max(50, len(catalog.scenes))
            for sid, sim in semantic_search_scenes(
                catalog, query_text, cache_dir=cache_dir or Path("cache"), top_k=top_k
            ):
                semantic_raw[sid] = round(float(sim), 4)
                semantic_boost[sid] = max(0.0, float(sim))
        except Exception:
            pass

    scored: List[tuple[float, SceneCut]] = []
    for s in catalog.scenes:
        if source_file and source_file.lower() not in s.source_file.lower():
            continue
        if media_type and s.media_type != media_type:
            continue
        if has_faces is not None and s.has_faces != has_faces:
            continue
        if min_duration is not None and not s.is_still_image and s.duration < min_duration:
            continue
        if max_duration is not None and not s.is_still_image and s.duration > max_duration:
            continue
        if min_fluidity is not None and (s.fluidity_score or 0.0) < min_fluidity:
            continue
        if min_dramatism is not None and (s.dramatism_score or 0.0) < min_dramatism:
            continue
        if visual_mood and (s.visual_mood or "").lower() != visual_mood.lower():
            continue
        if color_mood and (s.color_mood or "").lower() != color_mood.lower():
            continue
        if expression and expression.lower() not in (s.dominant_expression or "").lower():
            continue
        if semantic_tag and semantic_tag.lower() not in {t.lower() for t in s.semantic_tags}:
            continue

        score = 0.25  # Base score for passing hard filters
        scene_tags = {t.lower() for t in s.user_tags}
        if tag_set:
            overlap = len(tag_set & scene_tags)
            if overlap == 0:
                # Softly penalize if explicit tags were requested and none matched
                score -= 0.1
            else:
                score += 0.35 * (overlap / len(tag_set))

        hits = 0
        if tokens:
            searchable = " ".join(
                filter(
                    None,
                    [
                        Path(s.source_file).name,
                        s.user_note or "",
                        " ".join(s.user_tags),
                        " ".join(s.semantic_tags),
                        s.visual_mood or "",
                        s.color_mood or "",
                        s.dominant_expression or "",
                        s.subject_prominence or "",
                    ],
                )
            ).lower()
            hits = sum(1 for tok in tokens if tok in searchable)
            if hits > 0:
                score += 0.35 * (hits / len(tokens))

        raw_sem = semantic_raw.get(s.scene_id)
        if query_text and query_text.strip() and hits == 0:
            # Skip non-matching clips when a text/vibe query was provided
            if raw_sem is None or raw_sem <= 0.0:
                continue

        if s.scene_id in semantic_boost:
            # SigLIP cosine similarities for strong matches typically sit in [0.05, 0.15]
            score += min(0.60, semantic_boost[s.scene_id] * 4.0)

        # Slight quality tie-breaker from sharpness & fluidity
        score += min(0.1, ((s.fluidity_score or 40.0) / 1000.0))
        scored.append((round(score, 4), s))

    if sort_by == "index":
        scored.sort(key=lambda item: (item[1].scene_id,))
    elif sort_by == "sharpness":
        scored.sort(key=lambda item: (-(item[1].sharpness_score or 0.0), item[1].scene_id))
    elif sort_by == "brightness":
        scored.sort(key=lambda item: (-(item[1].brightness_score or 0.0), item[1].scene_id))
    elif sort_by == "fluidity":
        scored.sort(key=lambda item: (-(item[1].fluidity_score or 0.0), item[1].scene_id))
    elif sort_by == "dramatism":
        scored.sort(key=lambda item: (-(item[1].dramatism_score or 0.0), item[1].scene_id))
    else:
        scored.sort(key=lambda item: (-item[0], item[1].scene_id))

    results: List[Dict[str, Any]] = []
    for sc, scene in scored[: max(1, min(limit, 200))]:
        entry = _scene_to_compact_dict(scene)
        entry["match_score"] = sc
        if scene.scene_id in semantic_raw:
            entry["semantic_score"] = semantic_raw[scene.scene_id]
        results.append(entry)
    return results


def search_scenes_from_query(
    catalog: ScenesCatalog,
    query: ClipSearchQuery,
    cache_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Execute `search_scenes` from a validated `ClipSearchQuery` model."""
    return search_scenes(
        catalog=catalog,
        query_text=query.query_text,
        tags=query.tags,
        semantic_tag=query.semantic_tag,
        visual_mood=query.visual_mood,
        color_mood=query.color_mood,
        expression=query.expression,
        min_duration=query.min_duration,
        max_duration=query.max_duration,
        min_fluidity=query.min_fluidity,
        min_dramatism=query.min_dramatism,
        has_faces=query.has_faces,
        media_type=query.media_type,
        source_file=query.source_file,
        sort_by=query.sort_by,
        limit=query.limit,
        cache_dir=cache_dir,
    )


def get_scene_details(catalog: ScenesCatalog, scene_id: int) -> Optional[Dict[str, Any]]:
    """Return full static analysis metadata for a single scene_id."""
    for s in catalog.scenes:
        if s.scene_id == scene_id:
            data = _scene_to_compact_dict(s)
            data["keyframe_path"] = s.keyframe_path
            return data
    return None


def build_search_tool_functions(catalog: ScenesCatalog) -> List[Callable[..., Any]]:
    """
    Create bound Python tool callables for Gemini function calling over `catalog`.
    """

    def tool_list_source_summaries() -> List[Dict[str, Any]]:
        """List all indexed source videos/photos with clip counts, top moods, and user tags."""
        return list_source_summaries(catalog)

    def tool_search_scenes(
        query_text: Optional[str] = None,
        tags: Optional[List[str]] = None,
        semantic_tag: Optional[str] = None,
        visual_mood: Optional[str] = None,
        color_mood: Optional[str] = None,
        expression: Optional[str] = None,
        min_duration: Optional[float] = None,
        max_duration: Optional[float] = None,
        min_fluidity: Optional[float] = None,
        min_dramatism: Optional[float] = None,
        has_faces: Optional[bool] = None,
        media_type: Optional[str] = None,
        source_file: Optional[str] = None,
        sort_by: str = "relevance",
        limit: int = 12,
    ) -> List[Dict[str, Any]]:
        """Search indexed clips by text/tags/mood/expression/fluidity/dramatism/duration/media_type."""
        return search_scenes(
            catalog=catalog,
            query_text=query_text,
            tags=tags,
            semantic_tag=semantic_tag,
            visual_mood=visual_mood,
            color_mood=color_mood,
            expression=expression,
            min_duration=min_duration,
            max_duration=max_duration,
            min_fluidity=min_fluidity,
            min_dramatism=min_dramatism,
            has_faces=has_faces,
            media_type=media_type,
            source_file=source_file,
            sort_by=sort_by,
            limit=limit,
        )

    def tool_get_scene_details(scene_id: int) -> Optional[Dict[str, Any]]:
        """Get full static metadata for a specific scene_id."""
        return get_scene_details(catalog, scene_id)

    return [tool_list_source_summaries, tool_search_scenes, tool_get_scene_details]
