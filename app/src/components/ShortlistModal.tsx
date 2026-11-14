import React from "react";
import { Eye, Pin, Plus, Sparkles, X } from "lucide-react";
import type { SceneCut, ScenesCatalog, SegmentShortlist } from "../types/schemas";

interface ShortlistModalProps {
  shortlist: SegmentShortlist | null;
  isLoading: boolean;
  catalog: ScenesCatalog | null;
  pinnedSceneIds?: number[];
  onClose: () => void;
  onPreviewScene: (scene: SceneCut) => void;
  onAddSceneToTimeline: (scene: SceneCut, atTimeSec: number) => void;
  onTogglePinScene?: (sceneId: number) => void;
}

export const ShortlistModal: React.FC<ShortlistModalProps> = ({
  shortlist,
  isLoading,
  catalog,
  pinnedSceneIds = [],
  onClose,
  onPreviewScene,
  onAddSceneToTimeline,
  onTogglePinScene,
}) => {
  if (!isLoading && !shortlist) return null;

  const sceneById = new Map<number, SceneCut>();
  for (const s of catalog?.scenes || []) {
    sceneById.set(s.scene_id, s);
  }
  const pinnedSet = new Set(pinnedSceneIds);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[82vh] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                AI Clip Shortlist
              </h2>
              {shortlist && (
                <p className="text-[11px] text-slate-400 font-mono">
                  {shortlist.segment_summary ||
                    `${(shortlist.start_ms / 1000).toFixed(2)}s – ${(shortlist.end_ms / 1000).toFixed(2)}s`}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-2.5">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Searching indexed clips and matching against segment notes &amp; audio mood...
            </div>
          ) : shortlist && shortlist.candidates.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              No matching clips found. Try adding or analyzing more source clips first.
            </div>
          ) : (
            shortlist?.candidates.map((cand) => {
              const scene = sceneById.get(cand.scene_id);
              const fileName = cand.source_file.split("/").pop() || cand.source_file;
              const isPinned = pinnedSet.has(cand.scene_id);

              return (
                <div
                  key={`${cand.scene_id}_${cand.start_time}`}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-indigo-500/50 transition"
                >
                  {scene?.keyframe_path ? (
                    <img
                      src={scene.keyframe_path}
                      alt={fileName}
                      className="w-24 h-14 object-cover rounded border border-slate-800 shrink-0 bg-slate-900"
                    />
                  ) : (
                    <div className="w-24 h-14 rounded border border-slate-800 bg-slate-900 flex items-center justify-center text-[10px] text-slate-500 shrink-0">
                      #{cand.scene_id}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-100 truncate">
                        {fileName}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {cand.start_time.toFixed(2)}s–{cand.end_time.toFixed(2)}s
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/50">
                        {Math.round(cand.score * 100)}% match
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">{cand.reason}</p>
                    {cand.matched_criteria && cand.matched_criteria.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {cand.matched_criteria.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {scene && (
                      <button
                        type="button"
                        onClick={() => onPreviewScene(scene)}
                        className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                        title="Preview clip"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onTogglePinScene && (
                      <button
                        type="button"
                        onClick={() => onTogglePinScene(cand.scene_id)}
                        className={`p-1.5 rounded border transition ${
                          isPinned
                            ? "bg-amber-600 border-amber-400 text-white"
                            : "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                        }`}
                        title={isPinned ? "Unpin from segment" : "Pin to segment"}
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {scene && (
                      <button
                        type="button"
                        onClick={() =>
                          onAddSceneToTimeline(scene, shortlist.start_ms / 1000)
                        }
                        className="flex items-center gap-1 px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
                        title="Place clip at segment start on timeline"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Place
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
