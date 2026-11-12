import React, { useRef, useState, useEffect } from "react";
import type { BeatsData, SceneCut, Timeline, TimelineCut, TransitionType } from "../types/schemas";
import { ZoomIn, ZoomOut, Film, X, Scissors, Magnet, Plus } from "lucide-react";
import {
  moveCut,
  trimCutLeft,
  trimCutRight,
  splitCutAtTime,
  cycleCutTransition,
} from "../utils/timelineEditor";

export interface TimelineTrackProps {
  timeline: Timeline | null;
  currentTime: number;
  duration?: number;
  selectedCutIndex?: number | null;
  zoomLevel?: number;
  beats?: BeatsData | null;
  sourceDurations?: Record<string, number>;
  videoTrackCount?: number;
  activeVideoTrack?: number;
  onSelectVideoTrack?: (trackIndex: number) => void;
  onAddVideoTrack?: () => void;
  onSelectCut?: (index: number) => void;
  onRemoveCut?: (index: number) => void;
  onUpdateCuts?: (cuts: TimelineCut[]) => void;
  onDropScene?: (scene: SceneCut, timelineStart: number, trackIndex: number) => void;
  onSeek: (time: number) => void;
  className?: string;
}

const TRANSITION_STYLES: Record<
  TransitionType,
  { label: string; bg: string; text: string; border: string }
> = {
  cut: { label: "CUT", bg: "bg-slate-800", text: "text-slate-300", border: "border-slate-700" },
  crossfade: { label: "FADE", bg: "bg-indigo-900/80", text: "text-indigo-300", border: "border-indigo-600/60" },
  flash_white: { label: "FLASH", bg: "bg-amber-950/80", text: "text-amber-300", border: "border-amber-500/60" },
  zoom_in: { label: "ZOOM", bg: "bg-purple-900/80", text: "text-purple-300", border: "border-purple-500/60" },
  whip_pan: { label: "WHIP", bg: "bg-rose-950/80", text: "text-rose-300", border: "border-rose-500/60" },
};

type DragMode =
  | {
      type: "move";
      cutIndex: number;
      startX: number;
      origStart: number;
      origTrack: number;
      snapshot: TimelineCut[];
    }
  | { type: "trim-left"; cutIndex: number; startX: number; snapshot: TimelineCut[]; isImg: boolean }
  | { type: "trim-right"; cutIndex: number; startX: number; snapshot: TimelineCut[]; isImg: boolean };

export const TimelineTrack: React.FC<TimelineTrackProps> = ({
  timeline,
  currentTime,
  duration: customDuration,
  selectedCutIndex,
  zoomLevel: externalZoomLevel,
  beats = null,
  sourceDurations,
  videoTrackCount = 1,
  activeVideoTrack = 0,
  onSelectVideoTrack,
  onAddVideoTrack,
  onSelectCut,
  onRemoveCut,
  onUpdateCuts,
  onDropScene,
  onSeek,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [localZoomLevel, setLocalZoomLevel] = useState<number>(1.0);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [dragOverTrack, setDragOverTrack] = useState<number | null>(null);

  const isControlledZoom = externalZoomLevel !== undefined;
  const zoomLevel = isControlledZoom ? externalZoomLevel : localZoomLevel;

  const cuts = timeline?.cuts || [];
  const maxCutEnd = cuts.reduce((acc, c) => Math.max(acc, c.timeline_end), 0);
  const duration = Math.max(customDuration || 0, maxCutEnd, 16.0);

  const maxTrackIdx = cuts.reduce((acc, c) => Math.max(acc, c.track_index ?? 0), 0);
  const totalTracks = Math.max(videoTrackCount, maxTrackIdx + 1);

  const activeCutIndex = cuts.findIndex(
    (c) =>
      (c.track_index ?? 0) === activeVideoTrack &&
      currentTime >= c.timeline_start &&
      currentTime < c.timeline_end
  );

  // Global pointer move/up listeners for smooth dragging & edge trimming
  useEffect(() => {
    if (!dragMode || !onUpdateCuts) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!containerRef.current || duration <= 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const trackWidth = isControlledZoom ? rect.width : rect.width * zoomLevel;
      if (trackWidth <= 0) return;
      const deltaPx = e.clientX - dragMode.startX;
      const deltaSec = (deltaPx / trackWidth) * duration;

      if (dragMode.type === "move") {
        let targetTrack = dragMode.origTrack;
        for (let i = 0; i < totalTracks; i++) {
          const laneEl = laneRefs.current[i];
          if (laneEl) {
            const laneRect = laneEl.getBoundingClientRect();
            if (e.clientY >= laneRect.top && e.clientY <= laneRect.bottom) {
              targetTrack = i;
              break;
            }
          }
        }
        const updated = moveCut(
          dragMode.snapshot,
          dragMode.cutIndex,
          dragMode.origStart + deltaSec,
          beats,
          snapEnabled,
          targetTrack
        );
        onUpdateCuts(updated);
      } else if (dragMode.type === "trim-left") {
        const updated = trimCutLeft(dragMode.snapshot, dragMode.cutIndex, deltaSec, {
          isStillImage: dragMode.isImg,
          beats,
          snapEnabled,
        });
        onUpdateCuts(updated);
      } else if (dragMode.type === "trim-right") {
        const targetCut = dragMode.snapshot[dragMode.cutIndex];
        const maxSourceDuration = targetCut ? sourceDurations?.[targetCut.source_file] : undefined;
        const updated = trimCutRight(dragMode.snapshot, dragMode.cutIndex, deltaSec, {
          isStillImage: dragMode.isImg,
          maxSourceDuration,
          beats,
          snapEnabled,
        });
        onUpdateCuts(updated);
      }
    };

    const handlePointerUp = () => {
      setDragMode(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragMode, duration, zoomLevel, isControlledZoom, beats, sourceDurations, snapEnabled, totalTracks, onUpdateCuts]);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragMode) return;
    if (!containerRef.current || duration <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + (isControlledZoom ? 0 : containerRef.current.scrollLeft);
    const totalWidth = isControlledZoom ? rect.width : rect.width * zoomLevel;
    const seekTime = Math.max(0, Math.min(duration, (clickX / totalWidth) * duration));
    onSeek(seekTime);
  };

  const handleLaneDrop = (e: React.DragEvent<HTMLDivElement>, trackIdx: number) => {
    e.preventDefault();
    setDragOverTrack(null);
    if (!onDropScene || !containerRef.current) return;
    const raw = e.dataTransfer.getData("application/x-amv-scene");
    if (!raw) return;
    try {
      const scene = JSON.parse(raw) as SceneCut;
      const rect = containerRef.current.getBoundingClientRect();
      const dropX = e.clientX - rect.left + (isControlledZoom ? 0 : containerRef.current.scrollLeft);
      const totalWidth = isControlledZoom ? rect.width : rect.width * zoomLevel;
      const dropTime = Math.max(0, Math.min(duration, (dropX / totalWidth) * duration));
      onDropScene(scene, dropTime, trackIdx);
    } catch {
      // ignore invalid drag payload
    }
  };

  const canSplitSelected =
    selectedCutIndex !== null &&
    selectedCutIndex !== undefined &&
    cuts[selectedCutIndex] &&
    currentTime > cuts[selectedCutIndex].timeline_start + 0.25 &&
    currentTime < cuts[selectedCutIndex].timeline_end - 0.25;

  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} data-testid="timeline-track">
      {/* Controls & Editing Header */}
      <div className="flex items-center justify-between text-xs px-1 text-slate-400">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-indigo-400" />
            Video Tracks ({cuts.length} clips)
          </span>

          {onAddVideoTrack && (
            <button
              type="button"
              onClick={onAddVideoTrack}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-medium text-slate-200 border border-slate-700 transition"
              title="Add another video track (V2, V3...) to experiment with versions"
            >
              <Plus className="w-3 h-3 text-indigo-400" />
              Video Track
            </button>
          )}

          {onUpdateCuts && (
            <button
              type="button"
              onClick={() => setSnapEnabled((s) => !s)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition ${
                snapEnabled
                  ? "bg-indigo-950/70 border-indigo-500/50 text-indigo-300"
                  : "bg-slate-900 border-slate-800 text-slate-500"
              }`}
              title="Snap clip edges to musical beats"
            >
              <Magnet className="w-3 h-3" />
              Snap
            </button>
          )}

          {onUpdateCuts && canSplitSelected && selectedCutIndex !== null && selectedCutIndex !== undefined && (
            <button
              type="button"
              onClick={() => onUpdateCuts(splitCutAtTime(cuts, selectedCutIndex, currentTime))}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-[10px] font-semibold text-white transition"
              title="Split selected clip at playhead"
            >
              <Scissors className="w-3 h-3" />
              Split at Playhead
            </button>
          )}

          {activeCutIndex >= 0 && (
            <span className="text-slate-400 hidden sm:inline">
              Active: Clip #{activeCutIndex + 1} (
              {cuts[activeCutIndex].source_file.split("/").pop()})
            </span>
          )}
        </div>

        {/* Zoom Controls (hidden when controlled by unified timeline zoom) */}
        {!isControlledZoom && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLocalZoomLevel((z) => Math.max(1.0, Number((z - 0.25).toFixed(2))))}
              disabled={zoomLevel <= 1.0}
              className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-slate-200 transition"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono w-10 text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setLocalZoomLevel((z) => Math.min(3.0, Number((z + 0.25).toFixed(2))))}
              disabled={zoomLevel >= 3.0}
              className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-slate-200 transition"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Multi-Track Video Lanes */}
      <div
        ref={containerRef}
        onClick={handleTrackClick}
        className={`relative rounded-xl border border-slate-800 bg-slate-950 p-1.5 cursor-pointer select-none ${
          isControlledZoom ? "" : "overflow-x-auto"
        }`}
      >
        <div
          style={{ width: isControlledZoom ? "100%" : `${zoomLevel * 100}%` }}
          className="relative flex flex-col gap-1.5 transition-all duration-75"
        >
          {Array.from({ length: totalTracks }).map((_, trackIdx) => {
            const trackCuts = cuts
              .map((cut, index) => ({ cut, index }))
              .filter(({ cut }) => (cut.track_index ?? 0) === trackIdx);
            const isTrackActive = trackIdx === activeVideoTrack;

            return (
              <div
                key={trackIdx}
                ref={(el) => {
                  laneRefs.current[trackIdx] = el;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverTrack(trackIdx);
                }}
                onDragLeave={() => setDragOverTrack(null)}
                onDrop={(e) => handleLaneDrop(e, trackIdx)}
                className={`relative h-16 rounded-lg border transition ${
                  dragOverTrack === trackIdx
                    ? "border-indigo-400 bg-indigo-950/30"
                    : isTrackActive
                    ? "border-slate-800 bg-slate-900/40"
                    : "border-slate-900 bg-slate-950/60 opacity-85"
                }`}
              >
                {/* Track Badge (V1, V2...) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectVideoTrack?.(trackIdx);
                  }}
                  title={`Set V${trackIdx + 1} as active preview/export track`}
                  className={`absolute left-1 top-1 z-20 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition ${
                    isTrackActive
                      ? "bg-indigo-600 text-white border-indigo-400"
                      : "bg-slate-900/90 text-slate-400 border-slate-700 hover:text-slate-200"
                  }`}
                >
                  V{trackIdx + 1}
                </button>

                {trackCuts.length === 0 && (
                  <div className="h-full flex items-center justify-center text-[11px] text-slate-600 italic pointer-events-none">
                    {trackIdx === 0 && cuts.length === 0
                      ? "Drop clips here or click Add to Timeline"
                      : `V${trackIdx + 1} (Drop alternate clips here)`}
                  </div>
                )}

                {trackCuts.map(({ cut, index }) => {
                  const cutDur = Math.max(0.1, cut.timeline_end - cut.timeline_start);
                  const widthPct = (cutDur / duration) * 100;
                  const leftPct = (cut.timeline_start / duration) * 100;
                  const isActive = index === activeCutIndex;
                  const isSelected = index === selectedCutIndex;
                  const isImg = cut.source_out <= cut.source_in;
                  const transStyle = TRANSITION_STYLES[cut.transition] || TRANSITION_STYLES.cut;

                  return (
                    <div
                      key={index}
                      data-testid={`timeline-cut-${index}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                      onPointerDown={(e) => {
                        if (!onUpdateCuts) return;
                        e.stopPropagation();
                        onSelectCut?.(index);
                        setDragMode({
                          type: "move",
                          cutIndex: index,
                          startX: e.clientX,
                          origStart: cut.timeline_start,
                          origTrack: cut.track_index ?? 0,
                          snapshot: cuts,
                        });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCut?.(index);
                        onSeek(cut.timeline_start);
                      }}
                      className={`absolute top-0.5 bottom-0.5 rounded-lg border overflow-hidden transition group cursor-grab active:cursor-grabbing ${
                        isActive
                          ? "border-rose-500 shadow-md shadow-rose-950/50 z-20"
                          : isSelected
                          ? "border-indigo-400 z-10 ring-1 ring-indigo-400/50"
                          : "border-slate-800 hover:border-slate-600 bg-slate-900/90 z-0"
                      }`}
                    >
                      {/* Left Edge Trim Handle */}
                      {onUpdateCuts && (
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectCut?.(index);
                            setDragMode({
                              type: "trim-left",
                              cutIndex: index,
                              startX: e.clientX,
                              snapshot: cuts,
                              isImg,
                            });
                          }}
                          title="Drag left edge to trim / stretch start"
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-30 hover:bg-indigo-400/60 transition"
                        />
                      )}

                      {/* Right Edge Trim Handle */}
                      {onUpdateCuts && (
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectCut?.(index);
                            setDragMode({
                              type: "trim-right",
                              cutIndex: index,
                              startX: e.clientX,
                              snapshot: cuts,
                              isImg,
                            });
                          }}
                          title="Drag right edge to trim / stretch end"
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-30 hover:bg-indigo-400/60 transition"
                        />
                      )}

                      {/* Keyframe Thumbnail / Background */}
                      {cut.keyframe_path ? (
                        <img
                          src={cut.keyframe_path}
                          alt="Keyframe"
                          className="absolute inset-0 w-full h-full object-cover opacity-55 group-hover:opacity-80 transition pointer-events-none"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/60 to-slate-900 pointer-events-none" />
                      )}

                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-slate-950/60 pointer-events-none" />

                      {/* Cut Details Badges */}
                      <div className="relative z-10 h-full px-2 py-1 flex flex-col justify-between">
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onUpdateCuts) {
                                onUpdateCuts(cycleCutTransition(cuts, index));
                              }
                            }}
                            title="Click to cycle transition"
                            className={`text-[9px] font-bold px-1 py-0.2 rounded border uppercase tracking-wider ${transStyle.bg} ${transStyle.text} ${transStyle.border}`}
                          >
                            {transStyle.label}
                          </button>

                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-slate-300 bg-slate-950/70 px-1 rounded border border-slate-800">
                              {cutDur.toFixed(2)}s
                            </span>
                            {onRemoveCut && (
                              <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRemoveCut(index);
                                }}
                                title="Remove clip from timeline"
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded bg-slate-950/80 hover:bg-rose-600 text-slate-300 hover:text-white transition"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-[10px] truncate text-slate-200 font-medium">
                          {cut.source_file.split("/").pop()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Scrubber Playhead Line */}
          <div
            data-testid="timeline-playhead"
            style={{ left: `${Math.min(100, Math.max(0, playheadPercent))}%` }}
            className="absolute top-0 bottom-0 w-[2px] bg-rose-500 pointer-events-none z-30 shadow-[0_0_12px_rgba(244,63,94,0.9)]"
          >
            <div className="absolute -top-1 -translate-x-1/2 w-3.5 h-3.5 bg-rose-500 rotate-45 rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  );
};
