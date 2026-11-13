import React, { useRef, useMemo, useEffect, useState } from "react";
import type { BeatsData, EnergyLevel } from "../types/schemas";

export interface WaveformVisualizerProps {
  beatsData: BeatsData | null;
  currentTime: number;
  duration?: number;
  zoomLevel?: number;
  onSeek: (time: number) => void;
  className?: string;
}

const ENERGY_COLORS: Record<EnergyLevel, { fill: string; border: string; text: string }> = {
  intro: { fill: "rgba(99, 102, 241, 0.18)", border: "rgba(99, 102, 241, 0.45)", text: "#a5b4fc" },
  low: { fill: "rgba(14, 165, 233, 0.18)", border: "rgba(14, 165, 233, 0.45)", text: "#7dd3fc" },
  medium: { fill: "rgba(6, 182, 212, 0.18)", border: "rgba(6, 182, 212, 0.45)", text: "#67e8f9" },
  build: { fill: "rgba(234, 179, 8, 0.22)", border: "rgba(234, 179, 8, 0.5)", text: "#fde047" },
  drop: { fill: "rgba(239, 68, 68, 0.28)", border: "rgba(239, 68, 68, 0.65)", text: "#fca5a5" },
  high: { fill: "rgba(249, 115, 22, 0.22)", border: "rgba(249, 115, 22, 0.55)", text: "#fdba74" },
  outro: { fill: "rgba(148, 163, 184, 0.15)", border: "rgba(148, 163, 184, 0.4)", text: "#cbd5e1" },
};

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  beatsData,
  currentTime,
  duration: customDuration,
  zoomLevel = 1.0,
  onSeek,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const duration = customDuration || beatsData?.duration_sec || 16.0;

  // Generate deterministic synthetic waveform peaks based on beats and energy
  const waveformBars = useMemo(() => {
    const barCount = Math.min(480, Math.max(120, Math.round(120 * zoomLevel)));
    const bars: { height: number; isDownbeat: boolean; isBeat: boolean; energyLevel: EnergyLevel }[] = [];

    for (let i = 0; i < barCount; i++) {
      const t = (i / barCount) * duration;
      const curSeg = beatsData?.energy_segments.find((s) => t >= s.start && t < s.end);
      const level = curSeg?.level || "medium";

      // Base energy amplitude
      let baseAmp = 0.35;
      if (level === "intro") baseAmp = 0.25;
      if (level === "low" || level === "medium") baseAmp = 0.5;
      if (level === "build") baseAmp = 0.65;
      if (level === "drop" || level === "high") baseAmp = 0.9;

      // Harmonic variations
      const harmonic =
        Math.sin(i * 0.45) * 0.15 +
        Math.sin(i * 1.2) * 0.1 +
        Math.cos(i * 0.2) * 0.08;

      const beatThreshold = 0.08;
      const isBeat = Boolean(beatsData?.beats.some((b) => Math.abs(b - t) < beatThreshold));
      const isDownbeat = Boolean(beatsData?.downbeats.some((db) => Math.abs(db - t) < beatThreshold * 1.5));

      const boost = isDownbeat ? 0.3 : isBeat ? 0.15 : 0;
      const height = Math.min(1.0, Math.max(0.12, baseAmp + harmonic + boost));

      bars.push({ height, isDownbeat, isBeat, energyLevel: level });
    }
    return bars;
  }, [duration, beatsData, zoomLevel]);

  const handlePointerSeek = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || duration <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const seekTime = (x / rect.width) * duration;
    onSeek(seekTime);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handlePointerSeek(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || duration <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setHoverTime((x / rect.width) * duration);

    if (isDragging) {
      handlePointerSeek(e);
    }
  };

  useEffect(() => {
    const handleUp = () => setIsDragging(false);
    window.addEventListener("pointerup", handleUp);
    return () => window.removeEventListener("pointerup", handleUp);
  }, []);

  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      data-testid="waveform-visualizer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverTime(null)}
      className={`relative select-none h-24 bg-slate-950/80 rounded-xl border border-slate-800 overflow-hidden cursor-crosshair group ${className}`}
    >
      {/* Energy Segments Background Bands */}
      <div className="absolute inset-0 flex pointer-events-none">
        {beatsData?.energy_segments.map((seg, idx) => {
          const startPct = (seg.start / duration) * 100;
          const endPct = (seg.end / duration) * 100;
          const widthPct = Math.max(0, endPct - startPct);
          const style = ENERGY_COLORS[seg.level] || ENERGY_COLORS.medium;

          return (
            <div
              key={idx}
              style={{
                left: `${startPct}%`,
                width: `${widthPct}%`,
                backgroundColor: style.fill,
                borderRight: `1px dashed ${style.border}`,
              }}
              className="absolute top-0 bottom-0 flex flex-col justify-between px-1.5 py-1"
            >
              <span
                style={{ color: style.text }}
                className="text-[9px] font-bold uppercase tracking-wider truncate"
              >
                {seg.label}
              </span>
              <span
                style={{ color: style.text }}
                className="text-[8px] font-mono opacity-60 self-end"
              >
                {seg.level}
              </span>
            </div>
          );
        })}
      </div>

      {/* Downbeat & Beat Markers Grid */}
      <div className="absolute inset-0 pointer-events-none">
        {beatsData?.beats.map((beat, i) => {
          const isDown = beatsData.downbeats.some((db) => Math.abs(db - beat) < 0.05);
          const leftPct = (beat / duration) * 100;
          return (
            <div
              key={i}
              style={{ left: `${leftPct}%` }}
              className={`absolute top-0 bottom-0 ${
                isDown
                  ? "w-[2px] bg-emerald-400/60 z-10"
                  : "w-[1px] bg-indigo-400/25 z-0"
              }`}
            />
          );
        })}
      </div>

      {/* Waveform Bars */}
      <div className="absolute inset-x-2 bottom-3 top-5 flex items-end gap-[2px] pointer-events-none z-10">
        {waveformBars.map((bar, i) => {
          const barPct = (i / waveformBars.length) * 100;
          const isPassed = barPct <= playheadPercent;

          let colorClass = "bg-indigo-500/50";
          if (bar.isDownbeat) {
            colorClass = isPassed ? "bg-emerald-400" : "bg-emerald-500/70";
          } else if (bar.energyLevel === "drop") {
            colorClass = isPassed ? "bg-rose-400" : "bg-rose-500/60";
          } else if (bar.energyLevel === "build") {
            colorClass = isPassed ? "bg-amber-400" : "bg-amber-500/60";
          } else if (isPassed) {
            colorClass = "bg-indigo-400";
          }

          return (
            <div
              key={i}
              style={{ height: `${Math.round(bar.height * 100)}%` }}
              className={`flex-1 rounded-t-sm transition-all duration-75 ${colorClass}`}
            />
          );
        })}
      </div>

      {/* Hover Time Indicator */}
      {hoverTime !== null && (
        <div
          style={{ left: `${(hoverTime / duration) * 100}%` }}
          className="absolute top-0 bottom-0 w-[1px] bg-slate-400/60 pointer-events-none z-20"
        >
          <div className="absolute top-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-200 border border-slate-700 shadow">
            {hoverTime.toFixed(2)}s
          </div>
        </div>
      )}

      {/* Millisecond Audio Cue Note Pins */}
      {beatsData?.audio_notes?.map((cue) => {
        const cueSec = cue.timestamp_ms / 1000;
        const leftPct = duration > 0 ? (cueSec / duration) * 100 : 0;
        if (leftPct < 0 || leftPct > 100) return null;
        const tagsText = cue.tags.length > 0 ? cue.tags.join(", ") : "cue";
        const tooltip = `[${cue.timestamp_ms}ms] ${tagsText}${cue.note ? `: ${cue.note}` : ""}`;

        return (
          <button
            key={cue.id}
            type="button"
            data-testid={`waveform-cue-pin-${cue.id}`}
            title={tooltip}
            aria-label={tooltip}
            style={{ left: `${leftPct}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(cueSec);
            }}
            className="absolute top-0 bottom-0 w-3 -translate-x-1/2 z-25 flex flex-col items-center group/pin cursor-pointer focus:outline-none"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-slate-950 shadow-md group-hover/pin:scale-125 transition-transform mt-0.5" />
            <span className="w-[2px] flex-1 bg-amber-400/80 group-hover/pin:bg-amber-300" />
          </button>
        );
      })}

      {/* Interactive Scrubber Playhead */}
      <div
        data-testid="waveform-playhead"
        style={{ left: `${Math.min(100, Math.max(0, playheadPercent))}%` }}
        className="absolute top-0 bottom-0 w-[2px] bg-rose-500 pointer-events-none z-30 shadow-[0_0_10px_rgba(244,63,94,0.8)]"
      >
        <div className="absolute -top-0 -translate-x-1/2 w-3 h-3 bg-rose-500 rotate-45 rounded-sm shadow-md" />
        <div className="absolute bottom-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-rose-950/90 text-[10px] font-mono text-rose-200 border border-rose-500/50 shadow">
          {currentTime.toFixed(2)}s
        </div>
      </div>
    </div>
  );
};
