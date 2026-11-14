import React, { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Sparkles, Tag, Trash2, X } from "lucide-react";
import type { AudioCueNote, BeatsData } from "../types/schemas";

interface CuesTrackProps {
  beatsData: BeatsData | null;
  audioNotes?: AudioCueNote[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  onAddCue: (cue: AudioCueNote) => void;
  onUpdateCue: (cueId: string, patch: Partial<AudioCueNote>) => void;
  onDeleteCue: (cueId: string) => void;
  onShortlistSegment: (startMs: number, endMs: number, cue?: AudioCueNote) => void;
}

type DragState =
  | { type: "create"; startTimeSec: number; currentTimeSec: number }
  | { type: "resize-left"; cueId: string; origStartMs: number; origEndMs: number; startX: number }
  | { type: "resize-right"; cueId: string; origStartMs: number; origEndMs: number; startX: number };

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export const CuesTrack: React.FC<CuesTrackProps> = ({
  beatsData,
  audioNotes,
  duration,
  currentTime,
  onSeek,
  onAddCue,
  onUpdateCue,
  onDeleteCue,
  onShortlistSegment,
}) => {
  const laneRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const onAddCueRef = useRef(onAddCue);
  const onUpdateCueRef = useRef(onUpdateCue);
  onAddCueRef.current = onAddCue;
  onUpdateCueRef.current = onUpdateCue;

  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [draftTags, setDraftTags] = useState("");

  const cues = audioNotes ?? beatsData?.audio_notes ?? [];
  const safeDuration = Math.max(duration, 16.0);

  const editingCue = cues.find((c) => c.id === editingCueId) || null;

  useEffect(() => {
    if (editingCue) {
      setDraftNote(editingCue.note || "");
      setDraftTags((editingCue.tags || []).join(", "));
    }
  }, [editingCue?.id]);

  const xToTimeSec = (clientX: number): number => {
    if (!laneRef.current) return 0;
    const rect = laneRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * safeDuration;
  };

  const updateDrag = (next: DragState | null) => {
    dragStateRef.current = next;
    setDragState(next);
  };

  const isDragging = dragState !== null;

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || !laneRef.current) return;
      const rect = laneRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;

      if (current.type === "create") {
        const next: DragState = { ...current, currentTimeSec: xToTimeSec(e.clientX) };
        dragStateRef.current = next;
        setDragState(next);
      } else if (current.type === "resize-left") {
        const deltaMs = ((e.clientX - current.startX) / rect.width) * safeDuration * 1000;
        const nextStart = Math.max(
          0,
          Math.min(current.origEndMs - 250, Math.round(current.origStartMs + deltaMs))
        );
        onUpdateCueRef.current(current.cueId, { timestamp_ms: nextStart });
      } else if (current.type === "resize-right") {
        const deltaMs = ((e.clientX - current.startX) / rect.width) * safeDuration * 1000;
        const nextEnd = Math.min(
          Math.round(safeDuration * 1000),
          Math.max(current.origStartMs + 250, Math.round(current.origEndMs + deltaMs))
        );
        onUpdateCueRef.current(current.cueId, { end_ms: nextEnd });
      }
    };

    const handleUp = () => {
      const current = dragStateRef.current;
      if (current?.type === "create") {
        const minSec = Math.min(current.startTimeSec, current.currentTimeSec);
        const maxSec = Math.max(current.startTimeSec, current.currentTimeSec);
        if (maxSec - minSec >= 0.2) {
          const id = `cue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const newCue: AudioCueNote = {
            id,
            timestamp_ms: Math.round(minSec * 1000),
            end_ms: Math.round(maxSec * 1000),
            tags: [],
            note: "",
          };
          onAddCueRef.current(newCue);
          setEditingCueId(id);
        }
      }
      updateDrag(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [isDragging, safeDuration]);

  const handleLaneDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-cue-pill]")) return;
    const tSec = xToTimeSec(e.clientX);
    const id = `cue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    onAddCue({
      id,
      timestamp_ms: Math.round(tSec * 1000),
      tags: [],
      note: "",
    });
    setEditingCueId(id);
  };

  const handleSavePopover = () => {
    if (!editingCue) return;
    const parsedTags = draftTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onUpdateCue(editingCue.id, {
      note: draftNote.trim(),
      tags: parsedTags,
    });
    setEditingCueId(null);
  };

  const previewLeftPct =
    dragState?.type === "create"
      ? (Math.min(dragState.startTimeSec, dragState.currentTimeSec) / safeDuration) * 100
      : 0;
  const previewWidthPct =
    dragState?.type === "create"
      ? (Math.abs(dragState.currentTimeSec - dragState.startTimeSec) / safeDuration) * 100
      : 0;

  return (
    <div className="relative bg-slate-950/90 border border-slate-800 rounded-md px-2 py-1 select-none">
      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 px-0.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-amber-300 uppercase tracking-wider">
            Cues &amp; Segments
          </span>
          <span className="text-slate-500 hidden sm:inline">
            Double-click for cue pin • Drag for segment note
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            const startMs = Math.round(currentTime * 1000);
            const endMs = Math.min(Math.round(safeDuration * 1000), startMs + 4000);
            const id = `cue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            onAddCue({
              id,
              timestamp_ms: startMs,
              end_ms: endMs > startMs ? endMs : undefined,
              tags: [],
              note: "",
            });
            setEditingCueId(id);
          }}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/60 hover:bg-amber-900/70 border border-amber-700/50 text-amber-200 transition"
          title="Add a 4s segment cue at the current playhead"
        >
          <BookmarkPlus className="w-3 h-3" />
          + Segment at Playhead
        </button>
      </div>

      {/* Interactive Cues Lane */}
      <div
        ref={laneRef}
        onDoubleClick={handleLaneDoubleClick}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("[data-cue-pill]")) return;
          const tSec = xToTimeSec(e.clientX);
          updateDrag({ type: "create", startTimeSec: tSec, currentTimeSec: tSec });
        }}
        className="relative h-7 bg-slate-900/80 border border-slate-800/80 rounded cursor-crosshair overflow-hidden"
      >
        {/* Playhead hairline */}
        <div
          style={{ left: `${(currentTime / safeDuration) * 100}%` }}
          className="absolute top-0 bottom-0 w-px bg-rose-500/70 pointer-events-none z-20"
        />

        {/* Drag-to-create preview */}
        {dragState?.type === "create" && previewWidthPct > 0.2 && (
          <div
            style={{ left: `${previewLeftPct}%`, width: `${previewWidthPct}%` }}
            className="absolute top-0.5 bottom-0.5 bg-amber-500/25 border border-amber-400/70 rounded pointer-events-none"
          />
        )}

        {/* Existing Cues & Segment Pills */}
        {cues.map((cue) => {
          const isRange = typeof cue.end_ms === "number" && cue.end_ms > cue.timestamp_ms;
          const leftPct = (cue.timestamp_ms / 1000 / safeDuration) * 100;
          const widthPct = isRange
            ? Math.max(0.6, (((cue.end_ms! - cue.timestamp_ms) / 1000) / safeDuration) * 100)
            : 0;
          const isEditing = cue.id === editingCueId;

          if (!isRange) {
            return (
              <button
                key={cue.id}
                type="button"
                data-cue-pill="true"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(cue.timestamp_ms / 1000);
                  setEditingCueId(isEditing ? null : cue.id);
                }}
                style={{ left: `${leftPct}%` }}
                title={`${formatSec(cue.timestamp_ms)} — ${cue.note || cue.tags.join(", ") || "Cue pin"}`}
                className={`absolute top-0.5 bottom-0.5 -translate-x-1/2 px-1.5 rounded border text-[10px] font-medium flex items-center gap-1 whitespace-nowrap z-10 transition ${
                  isEditing
                    ? "bg-amber-500 text-slate-950 border-amber-300"
                    : "bg-amber-950/90 text-amber-200 border-amber-500/60 hover:border-amber-300"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                <span className="max-w-[90px] truncate">
                  {cue.note || cue.tags[0] || formatSec(cue.timestamp_ms)}
                </span>
              </button>
            );
          }

          return (
            <div
              key={cue.id}
              data-cue-pill="true"
              onClick={(e) => {
                e.stopPropagation();
                onSeek(cue.timestamp_ms / 1000);
                setEditingCueId(isEditing ? null : cue.id);
              }}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${formatSec(cue.timestamp_ms)}–${formatSec(cue.end_ms!)} — ${cue.note || "Segment note"}`}
              className={`group absolute top-0.5 bottom-0.5 rounded border text-[10px] flex items-center justify-between px-1.5 cursor-pointer z-10 overflow-hidden transition ${
                isEditing
                  ? "bg-amber-500/30 border-amber-300 text-amber-100"
                  : "bg-amber-950/75 border-amber-500/50 text-amber-200 hover:border-amber-300"
              }`}
            >
              {/* Left resize handle */}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  updateDrag({
                    type: "resize-left",
                    cueId: cue.id,
                    origStartMs: cue.timestamp_ms,
                    origEndMs: cue.end_ms!,
                    startX: e.clientX,
                  });
                }}
                className="w-1.5 h-full cursor-ew-resize shrink-0 -ml-1 hover:bg-amber-300/60"
              />
              <span className="truncate flex-1 px-1">
                {cue.note || cue.tags.join(", ") || `${formatSec(cue.timestamp_ms)}–${formatSec(cue.end_ms!)}`}
              </span>
              {cue.pinned_scene_ids && cue.pinned_scene_ids.length > 0 && (
                <span className="text-[9px] px-1 rounded bg-indigo-600/80 text-white shrink-0 mr-0.5">
                  {cue.pinned_scene_ids.length} pin
                </span>
              )}
              {/* Right resize handle */}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  updateDrag({
                    type: "resize-right",
                    cueId: cue.id,
                    origStartMs: cue.timestamp_ms,
                    origEndMs: cue.end_ms!,
                    startX: e.clientX,
                  });
                }}
                className="w-1.5 h-full cursor-ew-resize shrink-0 -mr-1 hover:bg-amber-300/60"
              />
            </div>
          );
        })}
      </div>

      {/* Inline Editor Popover for Selected Cue / Segment */}
      {editingCue && (
        <div className="mt-2 p-2.5 rounded-lg bg-slate-900 border border-amber-500/50 shadow-xl flex flex-col gap-2 z-30">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-mono text-amber-300">
              <span>
                {formatSec(editingCue.timestamp_ms)}
                {editingCue.end_ms && editingCue.end_ms > editingCue.timestamp_ms
                  ? ` – ${formatSec(editingCue.end_ms)}`
                  : " (Point Cue)"}
              </span>
              {(!editingCue.end_ms || editingCue.end_ms <= editingCue.timestamp_ms) && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateCue(editingCue.id, {
                      end_ms: Math.min(
                        Math.round(safeDuration * 1000),
                        editingCue.timestamp_ms + 4000
                      ),
                    })
                  }
                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-sans"
                >
                  Convert to 4s Segment
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setEditingCueId(null)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <textarea
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            rows={2}
            placeholder="Describe what this moment/segment feels like or what clips belong here..."
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
          />

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-1 min-w-[180px] bg-slate-950 border border-slate-800 rounded px-2 py-1">
              <Tag className="w-3 h-3 text-slate-500 shrink-0" />
              <input
                type="text"
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
                placeholder="Tags (comma-separated, e.g. golden hour, smile)"
                className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                const parsedTags = draftTags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean);
                const updatedCue: AudioCueNote = {
                  ...editingCue,
                  note: draftNote.trim(),
                  tags: parsedTags,
                };
                onUpdateCue(editingCue.id, {
                  note: updatedCue.note,
                  tags: updatedCue.tags,
                });
                const endMs =
                  updatedCue.end_ms && updatedCue.end_ms > updatedCue.timestamp_ms
                    ? updatedCue.end_ms
                    : Math.min(Math.round(safeDuration * 1000), updatedCue.timestamp_ms + 4000);
                onShortlistSegment(updatedCue.timestamp_ms, endMs, updatedCue);
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI Shortlist Clips
            </button>

            <button
              type="button"
              onClick={handleSavePopover}
              className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white transition"
            >
              Save
            </button>

            <button
              type="button"
              onClick={() => {
                onDeleteCue(editingCue.id);
                setEditingCueId(null);
              }}
              className="p-1 rounded bg-slate-800 hover:bg-rose-900/70 text-slate-400 hover:text-rose-200 transition"
              title="Delete cue"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
