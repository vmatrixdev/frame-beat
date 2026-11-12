import React, { useRef, useState } from "react";
import type { Timeline, TimelineCut, TransitionType } from "../types/schemas";
import { ZoomIn, ZoomOut, Film, X } from "lucide-react";

export interface TimelineTrackProps {
  timeline: Timeline | null;
  currentTime: number;
  duration?: number;
  selectedCutIndex?: number | null;
  zoomLevel?: number;
  onSelectCut?: (index: number) => void;
  onRemoveCut?: (index: number) => void;
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

export const TimelineTrack: React.FC<TimelineTrackProps> = ({
  timeline,
  currentTime,
  duration: customDuration,
  selectedCutIndex,
  zoomLevel: externalZoomLevel,
  onSelectCut,
  onRemoveCut,
  onSeek,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [localZoomLevel, setLocalZoomLevel] = useState<number>(1.0); // 1.0 = 100% width
  const isControlledZoom = externalZoomLevel !== undefined;
  const zoomLevel = isControlledZoom ? externalZoomLevel : localZoomLevel;

  const cuts = timeline?.cuts || [];
  const duration =
    customDuration ||
    (cuts.length > 0 ? cuts[cuts.length - 1].timeline_end : 16.0);

  const activeCutIndex = cuts.findIndex(
    (c) => currentTime >= c.timeline_start && currentTime < c.timeline_end
  );

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || duration <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + (isControlledZoom ? 0 : containerRef.current.scrollLeft);
    const totalWidth = isControlledZoom ? rect.width : rect.width * zoomLevel;
    const seekTime = Math.max(0, Math.min(duration, (clickX / totalWidth) * duration));
    onSeek(seekTime);
  };

  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`flex flex-col gap-2 ${className}`} data-testid="timeline-track">
      {/* Controls & Zoom Header */}
      <div className="flex items-center justify-between text-xs px-1 text-slate-400">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-indigo-400" />
            Cuts Track ({cuts.length} clips)
          </span>
          {activeCutIndex >= 0 && (
            <span className="text-slate-400">
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

      {/* Scrollable Timeline Area (or full-width inside shared parent scroller) */}
      <div
        ref={containerRef}
        onClick={handleTrackClick}
        className={`relative rounded-xl border border-slate-800 bg-slate-950 p-1.5 min-h-[96px] cursor-pointer select-none ${
          isControlledZoom ? "" : "overflow-x-auto"
        }`}
      >
        <div
          style={{ width: isControlledZoom ? "100%" : `${zoomLevel * 100}%` }}
          className="relative h-20 transition-all duration-75"
        >
          {/* Clips List */}
          {cuts.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-500 italic">
              No timeline generated yet. Select audio & videos, or load demo fixtures.
            </div>
          ) : (
            <div className="absolute inset-0 flex">
              {cuts.map((cut: TimelineCut, index: number) => {
                const cutDur = cut.timeline_end - cut.timeline_start;
                const widthPct = (cutDur / duration) * 100;
                const leftPct = (cut.timeline_start / duration) * 100;
                const isActive = index === activeCutIndex;
                const isSelected = index === selectedCutIndex;
                const transStyle =
                  TRANSITION_STYLES[cut.transition] || TRANSITION_STYLES.cut;

                return (
                  <div
                    key={index}
                    data-testid={`timeline-cut-${index}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCut?.(index);
                      onSeek(cut.timeline_start);
                    }}
                    className={`absolute top-0 bottom-0 rounded-lg border overflow-hidden transition group ${
                      isActive
                        ? "border-rose-500 shadow-md shadow-rose-950/50 z-20"
                        : isSelected
                        ? "border-indigo-400 z-10"
                        : "border-slate-800 hover:border-slate-600 bg-slate-900/90 z-0"
                    }`}
                  >
                    {/* Keyframe Thumbnail / Background */}
                    {cut.keyframe_path ? (
                      <img
                        src={cut.keyframe_path}
                        alt="Keyframe"
                        className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-85 transition"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/60 to-slate-900" />
                    )}

                    {/* Dark gradient overlay for text readability */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-slate-950/60" />

                    {/* Cut Details Badges */}
                    <div className="relative z-10 h-full p-1.5 flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-1">
                        {/* Transition Badge */}
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${transStyle.bg} ${transStyle.text} ${transStyle.border}`}
                        >
                          {transStyle.label}
                        </span>

                        {/* Duration Badge & Remove */}
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono text-slate-300 bg-slate-950/70 px-1 rounded border border-slate-800">
                            {cutDur.toFixed(2)}s
                          </span>
                          {onRemoveCut && (
                            <button
                              type="button"
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

                      {/* Source Name & In/Out */}
                      <div className="text-[10px] truncate text-slate-200 font-medium">
                        {cut.source_file.split("/").pop()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

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
