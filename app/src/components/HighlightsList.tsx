import React, { useState, useMemo } from "react";
import type { SceneCut, ScenesCatalog } from "../types/schemas";
import {
  Film,
  Zap,
  Sun,
  Activity,
  Search,
  Filter,
  Play,
  Smile,
  SlidersHorizontal,
  RefreshCw,
} from "lucide-react";

export interface HighlightAnalysisSettings {
  detectorThreshold: number;
  maxSceneDuration: number;
  targetWindowDuration: number;
  minWindowDuration: number;
}

export interface HighlightsListProps {
  catalog: ScenesCatalog | null;
  activeScene: SceneCut | null;
  onSelectScene: (scene: SceneCut) => void;
  highlightSettings?: HighlightAnalysisSettings;
  onChangeHighlightSettings?: (next: HighlightAnalysisSettings) => void;
  onReanalyzeHighlights?: () => void;
  isReanalyzing?: boolean;
}

export const HighlightsList: React.FC<HighlightsListProps> = ({
  catalog,
  activeScene,
  onSelectScene,
  highlightSettings,
  onChangeHighlightSettings,
  onReanalyzeHighlights,
  isReanalyzing = false,
}) => {
  const [filterType, setFilterType] = useState<"all" | "video" | "image" | "faces">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"index" | "sharpness" | "brightness">("index");
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const scenes = catalog?.scenes || [];

  const filteredScenes = useMemo(() => {
    return scenes
      .filter((s) => {
        const isImg = s.is_still_image || s.media_type === "image";
        if (filterType === "video" && isImg) return false;
        if (filterType === "image" && !isImg) return false;
        if (filterType === "faces" && !s.has_faces) return false;
        if (searchQuery.trim()) {
          const fname = s.source_file.split("/").pop() || "";
          return fname.toLowerCase().includes(searchQuery.toLowerCase());
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "sharpness") {
          return (b.sharpness_score ?? 0) - (a.sharpness_score ?? 0);
        }
        if (sortBy === "brightness") {
          return (b.brightness_score ?? 0) - (a.brightness_score ?? 0);
        }
        return a.scene_id - b.scene_id;
      });
  }, [scenes, filterType, searchQuery, sortBy]);

  const videoCount = scenes.filter((s) => !s.is_still_image && s.media_type !== "image").length;
  const imageCount = scenes.filter((s) => s.is_still_image || s.media_type === "image").length;
  const faceCount = scenes.filter((s) => Boolean(s.has_faces)).length;

  if (scenes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
        <Film className="w-8 h-8 text-slate-600 mb-2" />
        <p className="text-xs font-medium text-slate-400">No Analyzed Highlights Yet</p>
        <p className="text-[11px] text-slate-600 mt-1">
          Import source videos/photos or a scene catalog (.json) to inspect statically analyzed shots.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Header Stats & Counts */}
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-300">
        <span>Analyzed Highlights</span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/50">
            {scenes.length} items ({videoCount} videos • {imageCount} photos)
          </span>
          {highlightSettings && onChangeHighlightSettings && (
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              className={`p-1 rounded border transition ${
                showSettings
                  ? "bg-indigo-600/30 text-indigo-300 border-indigo-500/50"
                  : "bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200"
              }`}
              title="Highlight Windowing Parameters"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Highlight Windowing Parameters */}
      {showSettings && highlightSettings && onChangeHighlightSettings && (
        <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-300">Highlight Windowing</span>
            <div className="flex items-center gap-1">
              {[
                { label: "0.5s Quick", target: 0.5, max: 1.5, min: 0.35 },
                { label: "1.5s Fast", target: 1.5, max: 3.0, min: 0.9 },
                { label: "3.5s Balanced", target: 3.5, max: 5.5, min: 2.0 },
                { label: "5.0s Slow", target: 5.0, max: 8.0, min: 2.5 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    onChangeHighlightSettings({
                      ...highlightSettings,
                      targetWindowDuration: preset.target,
                      maxSceneDuration: preset.max,
                      minWindowDuration: preset.min,
                    })
                  }
                  className={`px-1.5 py-0.5 rounded text-[10px] border transition ${
                    Math.abs(highlightSettings.targetWindowDuration - preset.target) < 0.05
                      ? "bg-indigo-600 text-white border-indigo-400"
                      : "bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-0.5 text-slate-400">
              <span className="text-[10px]">Target Cut (s)</span>
              <input
                type="number"
                min={0.3}
                max={15}
                step={0.1}
                value={highlightSettings.targetWindowDuration}
                onChange={(e) => {
                  const val = Math.max(0.3, Math.min(15, Number(e.target.value) || 0.5));
                  onChangeHighlightSettings({
                    ...highlightSettings,
                    targetWindowDuration: val,
                    minWindowDuration: Math.min(highlightSettings.minWindowDuration, val * 0.7),
                  });
                }}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 font-mono text-[11px]"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-slate-400">
              <span className="text-[10px]">Max Scene (s)</span>
              <input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={highlightSettings.maxSceneDuration}
                onChange={(e) => {
                  const val = Math.max(0.5, Math.min(30, Number(e.target.value) || 1.0));
                  onChangeHighlightSettings({
                    ...highlightSettings,
                    maxSceneDuration: val,
                  });
                }}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 font-mono text-[11px]"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-slate-400">
              <span className="text-[10px]">Cut Threshold</span>
              <input
                type="number"
                min={5}
                max={80}
                step={1}
                value={highlightSettings.detectorThreshold}
                onChange={(e) => {
                  const val = Math.max(5, Math.min(80, Number(e.target.value) || 27));
                  onChangeHighlightSettings({
                    ...highlightSettings,
                    detectorThreshold: val,
                  });
                }}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 font-mono text-[11px]"
              />
            </label>
          </div>

          {onReanalyzeHighlights && (
            <button
              type="button"
              onClick={onReanalyzeHighlights}
              disabled={isReanalyzing}
              className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-[11px] flex items-center justify-center gap-1.5 transition"
            >
              <RefreshCw className={`w-3 h-3 ${isReanalyzing ? "animate-spin" : ""}`} />
              {isReanalyzing ? "Re-scanning Clips..." : "Re-run Highlights on All Clips"}
            </button>
          )}
        </div>
      )}

      {/* Filter and Search Controls */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search filenames..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
          />
        </div>

        <div className="flex items-center justify-between gap-1 text-[11px]">
          {/* Media Type Filters */}
          <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setFilterType("all")}
              className={`px-2 py-0.5 rounded transition ${
                filterType === "all" ? "bg-purple-600 text-white font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              All ({scenes.length})
            </button>
            <button
              onClick={() => setFilterType("video")}
              className={`px-2 py-0.5 rounded transition ${
                filterType === "video" ? "bg-purple-600 text-white font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Videos ({videoCount})
            </button>
            <button
              onClick={() => setFilterType("image")}
              className={`px-2 py-0.5 rounded transition ${
                filterType === "image" ? "bg-purple-600 text-white font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Photos ({imageCount})
            </button>
            <button
              onClick={() => setFilterType("faces")}
              className={`px-2 py-0.5 rounded transition ${
                filterType === "faces" ? "bg-rose-600 text-white font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Faces ({faceCount})
            </button>
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-1 text-slate-400">
            <Filter className="w-3 h-3 text-slate-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "index" | "sharpness" | "brightness")}
              className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-purple-500 font-mono"
            >
              <option value="index">Index</option>
              <option value="sharpness">Sharpness ↓</option>
              <option value="brightness">Brightness ↓</option>
            </select>
          </div>
        </div>
      </div>

      {/* Highlights Scrollable List */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2 max-h-[460px]">
        {filteredScenes.map((scene) => {
          const isSelected = activeScene?.scene_id === scene.scene_id && activeScene.source_file === scene.source_file;
          const isImg = scene.is_still_image || scene.media_type === "image";
          const filename = scene.source_file.split("/").pop() || "";
          const thumbUrl = scene.keyframe_path || (isImg ? `/api/media-stream?path=${encodeURIComponent(scene.source_file)}` : undefined);

          return (
            <div
              key={`${scene.scene_id}-${scene.source_file}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-amv-scene", JSON.stringify(scene));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onSelectScene(scene)}
              className={`p-2 rounded-xl border transition cursor-pointer flex gap-2.5 items-center group relative overflow-hidden ${
                isSelected
                  ? "bg-purple-950/60 border-purple-500 shadow-md shadow-purple-900/30"
                  : "bg-slate-950/50 border-slate-800/80 hover:border-purple-500/50 hover:bg-slate-900/60"
              }`}
            >
              {/* Thumbnail Container */}
              <div className="w-16 h-12 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden shrink-0 relative flex items-center justify-center">
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={filename}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                  />
                ) : (
                  <Film className="w-5 h-5 text-slate-600" />
                )}
                {/* Media Type Icon Badge */}
                <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-0.2 rounded text-[9px] font-mono text-slate-300">
                  {isImg ? "IMG" : `${scene.duration.toFixed(1)}s`}
                </span>
              </div>

              {/* Shot Details & Metrics */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-200 truncate pr-1">
                    #{scene.scene_id + 1} • {filename}
                  </span>
                  {isSelected && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-purple-400 bg-purple-900/50 px-1.5 py-0.2 rounded shrink-0">
                      <Play className="w-2.5 h-2.5 fill-current" />
                      In HUD
                    </span>
                  )}
                </div>

                {/* Time Range */}
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                  {isImg ? (
                    <span className="text-emerald-400">Still Photo • Elastic Hold</span>
                  ) : (
                    <span>
                      {scene.start_time.toFixed(2)}s – {scene.end_time.toFixed(2)}s ({scene.duration.toFixed(2)}s)
                    </span>
                  )}
                </div>

                {/* Statically Analyzed Metrics Badges */}
                <div className="flex items-center gap-2 mt-1 text-[10px] font-mono">
                  {scene.sharpness_score !== null && scene.sharpness_score !== undefined && (
                    <span
                      title="Laplacian Variance (Image Sharpness & Detail)"
                      className={`flex items-center gap-0.5 px-1 py-0.2 rounded border ${
                        scene.sharpness_score > 150
                          ? "bg-emerald-950/60 border-emerald-800/60 text-emerald-300"
                          : scene.sharpness_score > 60
                          ? "bg-indigo-950/60 border-indigo-800/60 text-indigo-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      <Zap className="w-2.5 h-2.5" />
                      {scene.sharpness_score.toFixed(0)}
                    </span>
                  )}

                  {scene.brightness_score !== null && scene.brightness_score !== undefined && (
                    <span
                      title="Mean Luminance (Lighting & Exposure)"
                      className="flex items-center gap-0.5 px-1 py-0.2 rounded bg-amber-950/40 border border-amber-800/50 text-amber-300"
                    >
                      <Sun className="w-2.5 h-2.5" />
                      {scene.brightness_score.toFixed(0)}
                    </span>
                  )}

                  {scene.motion_score !== null && scene.motion_score !== undefined && scene.motion_score > 0 && (
                    <span
                      title="Motion Dynamics Score"
                      className="flex items-center gap-0.5 px-1 py-0.2 rounded bg-cyan-950/40 border border-cyan-800/50 text-cyan-300"
                    >
                      <Activity className="w-2.5 h-2.5" />
                      {scene.motion_score.toFixed(0)}
                    </span>
                  )}

                  {scene.has_faces && (
                    <span
                      title={`Faces: ${scene.face_count ?? 1} • ${scene.subject_prominence ?? "subject"} • ${scene.dominant_expression ?? "detected"}`}
                      className="flex items-center gap-0.5 px-1 py-0.2 rounded bg-rose-950/50 border border-rose-800/60 text-rose-300 truncate max-w-[140px]"
                    >
                      <Smile className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">
                        {scene.dominant_expression
                          ? scene.dominant_expression.split(" / ")[0]
                          : `${scene.face_count ?? 1} face`}
                        {scene.smile_score !== null && scene.smile_score !== undefined
                          ? ` ${Math.round(scene.smile_score * 100)}%`
                          : ""}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
