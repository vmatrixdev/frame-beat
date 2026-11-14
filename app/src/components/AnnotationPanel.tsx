import React, { useState } from "react";
import type { SceneCut, TimelineCut } from "../types/schemas";
import {
  MessageSquare,
  X,
  Film,
} from "lucide-react";

export const QUICK_VISUAL_TAGS = [
  "hero",
  "climax",
  "intro",
  "b-roll",
  "emotional",
  "fast-cut",
  "keep",
  "avoid",
] as const;

/**
 * Formats milliseconds as `mm:ss.mmm`.
 */
export function formatMsTimecode(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSec = Math.floor(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const remMs = safeMs % 1000;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(remMs).padStart(3, "0")}`;
}

/**
 * Parses either raw integer milliseconds (e.g. "4520") or `mm:ss.mmm` / `ss.mmm` (e.g. "00:04.520").
 * Returns null if invalid.
 */
export function parseMsInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10));
  }

  const mmssMatch = trimmed.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (mmssMatch) {
    const mins = parseInt(mmssMatch[1], 10);
    const secs = parseInt(mmssMatch[2], 10);
    const msPart = mmssMatch[3] ? parseInt(mmssMatch[3].padEnd(3, "0"), 10) : 0;
    if (secs >= 60) return null;
    return (mins * 60 + secs) * 1000 + msPart;
  }

  const secMatch = trimmed.match(/^(\d+)\.(\d{1,3})$/);
  if (secMatch) {
    const secs = parseInt(secMatch[1], 10);
    const msPart = parseInt(secMatch[2].padEnd(3, "0"), 10);
    return secs * 1000 + msPart;
  }

  return null;
}

/**
 * Splits a comma-separated tag input string into normalized, deduplicated tags.
 */
export function parseTagTokens(raw: string, existing: string[] = []): string[] {
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const next = [...existing];
  for (const token of tokens) {
    if (!next.includes(token)) {
      next.push(token);
    }
  }
  return next;
}

export interface AnnotationPanelProps {
  selectedScene?: SceneCut | null;
  selectedCut?: TimelineCut | null;
  selectedCutIndex?: number | null;
  onUpdateSceneAnnotation?: (
    scene: SceneCut,
    updates: { user_tags: string[]; user_note: string }
  ) => void;
  onUpdateCutAnnotation?: (
    cutIndex: number,
    updates: { user_tags: string[]; user_note: string }
  ) => void;
  className?: string;
}

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({
  selectedScene = null,
  selectedCut = null,
  selectedCutIndex = null,
  onUpdateSceneAnnotation,
  onUpdateCutAnnotation,
  className = "",
}) => {
  const [visualTagInput, setVisualTagInput] = useState("");

  const hasVisualTarget = Boolean(
    selectedScene || (selectedCut && selectedCutIndex !== null && selectedCutIndex !== undefined)
  );
  const visualTags: string[] = selectedScene
    ? selectedScene.user_tags || []
    : selectedCut?.user_tags || [];
  const visualNote: string = selectedScene
    ? selectedScene.user_note || ""
    : selectedCut?.user_note || "";

  const commitVisualUpdate = (nextTags: string[], nextNote: string) => {
    if (selectedScene && onUpdateSceneAnnotation) {
      onUpdateSceneAnnotation(selectedScene, {
        user_tags: nextTags,
        user_note: nextNote,
      });
    } else if (
      selectedCut &&
      selectedCutIndex !== null &&
      selectedCutIndex !== undefined &&
      onUpdateCutAnnotation
    ) {
      onUpdateCutAnnotation(selectedCutIndex, {
        user_tags: nextTags,
        user_note: nextNote,
      });
    }
  };

  const handleAddVisualTags = (raw: string) => {
    const nextTags = parseTagTokens(raw, visualTags);
    if (nextTags.length !== visualTags.length) {
      commitVisualUpdate(nextTags, visualNote);
    }
    setVisualTagInput("");
  };

  const handleToggleVisualQuickTag = (tag: string) => {
    const nextTags = visualTags.includes(tag)
      ? visualTags.filter((t) => t !== tag)
      : [...visualTags, tag];
    commitVisualUpdate(nextTags, visualNote);
  };

  const handleRemoveVisualTag = (tag: string) => {
    commitVisualUpdate(
      visualTags.filter((t) => t !== tag),
      visualNote
    );
  };

  return (
    <div
      data-testid="annotation-panel"
      className={`rounded-xl border border-slate-800 bg-slate-950/90 p-3 space-y-2.5 text-xs ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
          <Film className="w-3.5 h-3.5 text-indigo-400" />
          <span>Clip / Cut Annotations</span>
        </div>
        {visualTags.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-700/50 text-indigo-300 text-[10px]">
            {visualTags.length} tag{visualTags.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Visual Clip / Cut Annotation */}
      {hasVisualTarget ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-900/70 px-2 py-1 rounded-lg border border-slate-800/80">
              <span className="truncate font-medium text-slate-200">
                {selectedScene
                  ? `${selectedScene.scene_id < 0 ? "Raw Asset" : `Highlight #${selectedScene.scene_id + 1}`} • ${
                      selectedScene.source_file.split("/").pop() || ""
                    }`
                  : `Timeline Cut #${(selectedCutIndex ?? 0) + 1} • ${
                      selectedCut?.source_file.split("/").pop() || ""
                    }`}
              </span>
              <span className="font-mono text-[10px] text-indigo-300 shrink-0 ml-2">
                {selectedScene
                  ? selectedScene.is_still_image || selectedScene.media_type === "image"
                    ? "Photo"
                    : `${selectedScene.start_time.toFixed(1)}s–${selectedScene.end_time.toFixed(1)}s`
                  : selectedCut
                  ? `${selectedCut.timeline_start.toFixed(2)}s–${selectedCut.timeline_end.toFixed(2)}s`
                  : ""}
              </span>
            </div>

            {/* Tag Chips */}
            {visualTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {visualTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-950/70 border border-indigo-700/60 text-indigo-200 text-[10px] font-mono"
                  >
                    #{tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => handleRemoveVisualTag(tag)}
                      className="text-indigo-400 hover:text-white transition"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Tag Input */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Add tags (comma or Enter)..."
                value={visualTagInput}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.includes(",")) {
                    handleAddVisualTags(val);
                  } else {
                    setVisualTagInput(val);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && visualTagInput.trim()) {
                    e.preventDefault();
                    handleAddVisualTags(visualTagInput);
                  }
                }}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => visualTagInput.trim() && handleAddVisualTags(visualTagInput)}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-medium transition"
              >
                Add
              </button>
            </div>

            {/* Quick Tag Suggestions */}
            <div className="flex flex-wrap gap-1">
              {QUICK_VISUAL_TAGS.map((tag) => {
                const active = visualTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleToggleVisualQuickTag(tag)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition ${
                      active
                        ? "bg-indigo-600/30 border-indigo-400 text-indigo-200"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                    }`}
                  >
                    {active ? "✓ " : "+ "}
                    {tag}
                  </button>
                );
              })}
            </div>

            {/* Director Note */}
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-[10px] text-slate-400">
                <MessageSquare className="w-3 h-3 text-slate-500" />
                <span>Director Note</span>
              </label>
              <textarea
                rows={2}
                placeholder="Note for AI Director (e.g., 'Use during chorus climax', 'Hold on smile')..."
                value={visualNote}
                onChange={(e) => commitVisualUpdate(visualTags, e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="py-4 text-center text-[11px] text-slate-500 border border-dashed border-slate-800 rounded-lg">
            Select a highlight/photo or a timeline cut to add tags and director notes.
          </div>
        )}
    </div>
  );
};
