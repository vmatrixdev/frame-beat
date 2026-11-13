import React, { useState, useEffect } from "react";
import type { AudioCueNote, BeatsData, SceneCut, TimelineCut } from "../types/schemas";
import {
  Tag,
  MessageSquare,
  Music,
  Plus,
  X,
  Trash2,
  Edit3,
  Clock,
  Check,
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

export const QUICK_AUDIO_TAGS = [
  "drop",
  "chorus",
  "build",
  "vocal",
  "beat-switch",
  "climax",
  "intro",
  "outro",
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
  beatsData?: BeatsData | null;
  currentTime: number;
  onUpdateSceneAnnotation?: (
    scene: SceneCut,
    updates: { user_tags: string[]; user_note: string }
  ) => void;
  onUpdateCutAnnotation?: (
    cutIndex: number,
    updates: { user_tags: string[]; user_note: string }
  ) => void;
  onAddAudioNote?: (note: AudioCueNote) => void;
  onUpdateAudioNote?: (note: AudioCueNote) => void;
  onDeleteAudioNote?: (id: string) => void;
  onSeekAudio?: (timeSec: number) => void;
  defaultTab?: "visual" | "audio";
  className?: string;
}

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({
  selectedScene = null,
  selectedCut = null,
  selectedCutIndex = null,
  beatsData = null,
  currentTime,
  onUpdateSceneAnnotation,
  onUpdateCutAnnotation,
  onAddAudioNote,
  onUpdateAudioNote,
  onDeleteAudioNote,
  onSeekAudio,
  defaultTab = "visual",
  className = "",
}) => {
  const [activeTab, setActiveTab] = useState<"visual" | "audio">(defaultTab);

  // Visual tag & note draft state
  const [visualTagInput, setVisualTagInput] = useState("");

  // Audio cue note form state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [cueMsInput, setCueMsInput] = useState<string>(
    String(Math.round(currentTime * 1000))
  );
  const [cueTags, setCueTags] = useState<string[]>([]);
  const [cueTagInput, setCueTagInput] = useState<string>("");
  const [cueNoteText, setCueNoteText] = useState<string>("");

  // Keep default cue timestamp synced to playhead when not editing an existing note
  useEffect(() => {
    if (!editingNoteId) {
      setCueMsInput(String(Math.round(currentTime * 1000)));
    }
  }, [currentTime, editingNoteId]);

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

  const handleAddCueTags = (raw: string) => {
    const nextTags = parseTagTokens(raw, cueTags);
    setCueTags(nextTags);
    setCueTagInput("");
  };

  const handleToggleCueQuickTag = (tag: string) => {
    setCueTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const resetCueForm = () => {
    setEditingNoteId(null);
    setCueMsInput(String(Math.round(currentTime * 1000)));
    setCueTags([]);
    setCueTagInput("");
    setCueNoteText("");
  };

  const handleSaveAudioCue = () => {
    const parsedMs = parseMsInput(cueMsInput);
    const timestamp_ms =
      parsedMs !== null ? parsedMs : Math.max(0, Math.round(currentTime * 1000));
    const finalTags = cueTagInput.trim()
      ? parseTagTokens(cueTagInput, cueTags)
      : cueTags;

    if (!cueNoteText.trim() && finalTags.length === 0) {
      return;
    }

    if (editingNoteId && onUpdateAudioNote) {
      onUpdateAudioNote({
        id: editingNoteId,
        timestamp_ms,
        tags: finalTags,
        note: cueNoteText.trim(),
      });
    } else if (onAddAudioNote) {
      onAddAudioNote({
        id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp_ms,
        tags: finalTags,
        note: cueNoteText.trim(),
      });
    }

    resetCueForm();
  };

  const handleStartEditCue = (cue: AudioCueNote) => {
    setEditingNoteId(cue.id);
    setCueMsInput(String(cue.timestamp_ms));
    setCueTags(cue.tags || []);
    setCueTagInput("");
    setCueNoteText(cue.note || "");
  };

  const audioNotes = [...(beatsData?.audio_notes || [])].sort(
    (a, b) => a.timestamp_ms - b.timestamp_ms
  );

  const parsedPreviewMs = parseMsInput(cueMsInput);

  return (
    <div
      data-testid="annotation-panel"
      className={`rounded-xl border border-slate-800 bg-slate-950/90 p-3 space-y-2.5 text-xs ${className}`}
    >
      {/* Header + Tabs */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
          <Tag className="w-3.5 h-3.5 text-indigo-400" />
          <span>Director Annotations</span>
        </div>

        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[10px]">
          <button
            type="button"
            onClick={() => setActiveTab("visual")}
            className={`px-2 py-0.5 rounded font-medium transition flex items-center gap-1 ${
              activeTab === "visual"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Film className="w-2.5 h-2.5" />
            Clip / Cut
            {visualTags.length > 0 && (
              <span className="px-1 rounded-full bg-black/30 text-[9px]">
                {visualTags.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("audio")}
            className={`px-2 py-0.5 rounded font-medium transition flex items-center gap-1 ${
              activeTab === "audio"
                ? "bg-rose-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Music className="w-2.5 h-2.5" />
            Audio Cues
            {audioNotes.length > 0 && (
              <span className="px-1 rounded-full bg-black/30 text-[9px]">
                {audioNotes.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Tab 1: Visual Clip / Cut Annotation */}
      {activeTab === "visual" ? (
        hasVisualTarget ? (
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
        )
      ) : (
        /* Tab 2: Millisecond Audio Cue Notes */
        <div className="space-y-2.5">
          {!beatsData ? (
            <div className="py-4 text-center text-[11px] text-slate-500 border border-dashed border-slate-800 rounded-lg">
              Load or analyze an audio track to add millisecond-level cue notes.
            </div>
          ) : (
            <>
              {/* Cue Form */}
              <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2">
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 flex-1">
                    <Clock className="w-3 h-3 text-rose-400 shrink-0" />
                    <input
                      type="text"
                      aria-label="Audio cue timestamp (ms or mm:ss.mmm)"
                      placeholder="ms or mm:ss.mmm"
                      value={cueMsInput}
                      onChange={(e) => setCueMsInput(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {parsedPreviewMs !== null ? formatMsTimecode(parsedPreviewMs) : "invalid"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCueMsInput(String(Math.round(currentTime * 1000)))}
                    className="px-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 transition shrink-0"
                    title="Set timestamp to current playhead millisecond"
                  >
                    @Playhead
                  </button>
                </div>

                {/* Cue Tags */}
                {cueTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {cueTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/70 border border-rose-700/60 text-rose-200 text-[10px] font-mono"
                      >
                        #{tag}
                        <button
                          type="button"
                          onClick={() => setCueTags((prev) => prev.filter((t) => t !== tag))}
                          className="text-rose-400 hover:text-white"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Cue tags (comma or Enter)..."
                    value={cueTagInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.includes(",")) {
                        handleAddCueTags(val);
                      } else {
                        setCueTagInput(val);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && cueTagInput.trim()) {
                        e.preventDefault();
                        handleAddCueTags(cueTagInput);
                      }
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500"
                  />
                </div>

                <div className="flex flex-wrap gap-1">
                  {QUICK_AUDIO_TAGS.map((tag) => {
                    const active = cueTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleToggleCueQuickTag(tag)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition ${
                          active
                            ? "bg-rose-600/30 border-rose-400 text-rose-200"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {active ? "✓ " : "+ "}
                        {tag}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Cue note for AI Director (e.g., 'Hard cut on snare')..."
                    value={cueNoteText}
                    onChange={(e) => setCueNoteText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSaveAudioCue();
                      }
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveAudioCue}
                    className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold flex items-center gap-1 transition shrink-0"
                  >
                    {editingNoteId ? (
                      <>
                        <Check className="w-3 h-3" />
                        Save
                      </>
                    ) : (
                      <>
                        <Plus className="w-3 h-3" />
                        Add Cue
                      </>
                    )}
                  </button>
                  {editingNoteId && (
                    <button
                      type="button"
                      onClick={resetCueForm}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Existing Audio Cues List */}
              {audioNotes.length > 0 && (
                <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
                  {audioNotes.map((cue) => (
                    <div
                      key={cue.id}
                      data-testid={`audio-cue-item-${cue.id}`}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800/80 hover:border-rose-500/40 transition"
                    >
                      <button
                        type="button"
                        onClick={() => onSeekAudio?.(cue.timestamp_ms / 1000)}
                        className="flex-1 min-w-0 text-left flex items-center gap-2"
                        title={`Seek to ${formatMsTimecode(cue.timestamp_ms)}`}
                      >
                        <span className="font-mono text-[10px] text-rose-300 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800/50 shrink-0">
                          {formatMsTimecode(cue.timestamp_ms)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-1">
                            {cue.tags.map((t) => (
                              <span
                                key={t}
                                className="text-[9px] font-mono text-amber-300 bg-amber-950/50 px-1 rounded"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                          {cue.note && (
                            <p className="text-[11px] text-slate-300 truncate">{cue.note}</p>
                          )}
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label="Edit audio cue"
                          onClick={() => handleStartEditCue(cue)}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete audio cue"
                          onClick={() => onDeleteAudioNote?.(cue.id)}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
