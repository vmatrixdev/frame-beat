import React from "react";
import type { Timeline, TimelineCut } from "../types/schemas";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Maximize2,
  Activity,
} from "lucide-react";

export interface VideoPreviewProps {
  timeline: Timeline | null;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  duration?: number;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onChangePlaybackRate: (rate: number) => void;
}

export function formatTimecode(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(
    millis
  ).padStart(3, "0")}`;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  timeline,
  currentTime,
  isPlaying,
  playbackRate,
  duration: customDuration,
  onPlayPause,
  onSeek,
  onChangePlaybackRate,
}) => {
  const cuts = timeline?.cuts || [];
  const duration =
    customDuration ||
    (cuts.length > 0 ? cuts[cuts.length - 1].timeline_end : 16.0);

  // Find active cut
  const activeCutIndex = cuts.findIndex(
    (c) => currentTime >= c.timeline_start && currentTime < c.timeline_end
  );
  const activeCut: TimelineCut | undefined = cuts[activeCutIndex];

  // Step 1 beat or 0.25s
  const handleStepBack = () => {
    onSeek(Math.max(0, currentTime - 0.5));
  };

  const handleStepForward = () => {
    onSeek(Math.min(duration, currentTime + 0.5));
  };

  const handleRestart = () => {
    onSeek(0);
  };

  return (
    <div
      className="flex flex-col h-full bg-slate-950/40 rounded-2xl border border-slate-800/80 overflow-hidden shadow-2xl"
      data-testid="video-preview-stage"
    >
      {/* Video Monitor Stage */}
      <div className="flex-1 relative flex items-center justify-center bg-black/60 overflow-hidden group">
        {activeCut?.keyframe_path ? (
          <img
            src={activeCut.keyframe_path}
            alt="Current Frame"
            className="w-full h-full object-contain select-none"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-600 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:scale-105 group-hover:border-indigo-500/50 transition duration-300">
              <Play className="w-7 h-7 text-indigo-400 ml-1" />
            </div>
            <div className="text-sm font-medium text-slate-400">AMV Preview Stage</div>
            <div className="text-xs text-slate-600">Deterministic cuts aligned with beats</div>
          </div>
        )}

        {/* Current Cut Overlay HUD (Top-Left) */}
        {activeCut && (
          <div className="absolute top-4 left-4 flex flex-col gap-1.5 pointer-events-none">
            <div className="px-2.5 py-1 rounded-md bg-slate-950/80 backdrop-blur border border-slate-800 text-xs font-mono flex items-center gap-2 text-slate-200">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span>
                CUT #{activeCutIndex + 1} / {cuts.length}
              </span>
              <span className="text-indigo-400 uppercase font-semibold">
                [{activeCut.transition}]
              </span>
            </div>
            <div className="px-2 py-0.5 rounded bg-slate-950/70 text-[11px] text-slate-400 max-w-xs truncate">
              {activeCut.source_file.split("/").pop()} ({activeCut.source_in.toFixed(2)}s -{" "}
              {activeCut.source_out.toFixed(2)}s)
            </div>
          </div>
        )}

        {/* Overlay HUD (Top-Right) */}
        <div className="absolute top-4 right-4 flex items-center gap-2 pointer-events-none">
          <div className="px-2.5 py-1 rounded-md bg-slate-950/80 backdrop-blur border border-slate-800 text-xs font-mono text-emerald-400 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            <span>24 FPS • Frame-Accurate</span>
          </div>
        </div>

        {/* Play/Pause Central Flash */}
        <button
          onClick={onPlayPause}
          aria-label={isPlaying ? "Pause video" : "Play video"}
          className="absolute inset-0 w-full h-full flex items-center justify-center bg-black/10 hover:bg-black/20 transition cursor-pointer"
        >
          <div className="w-14 h-14 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-200 hover:scale-110 shadow-xl">
            {isPlaying ? (
              <Pause className="w-6 h-6 text-slate-200" />
            ) : (
              <Play className="w-6 h-6 text-indigo-400 ml-1" />
            )}
          </div>
        </button>
      </div>

      {/* Playback Controls Toolbar */}
      <div className="h-14 bg-slate-900/90 border-t border-slate-800 px-4 flex items-center justify-between">
        {/* Left: Timecode and Transport */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleRestart}
            title="Restart to Beginning"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleStepBack}
            title="Step Back 1 Beat"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={onPlayPause}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="w-9 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 flex items-center justify-center text-white shadow-md shadow-indigo-600/30 transition"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            onClick={handleStepForward}
            title="Step Forward 1 Beat"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Timecode Readout */}
          <div className="ml-2 font-mono text-sm tracking-wider flex items-center gap-1.5 bg-slate-950 px-3 py-1 rounded-md border border-slate-800">
            <span className="text-slate-100 font-semibold">{formatTimecode(currentTime)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400">{formatTimecode(duration)}</span>
          </div>
        </div>

        {/* Right: Playback Speed & Options */}
        <div className="flex items-center gap-2">
          {/* Speed Selector */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            {[0.5, 1.0, 1.5, 2.0].map((rate) => (
              <button
                key={rate}
                onClick={() => onChangePlaybackRate(rate)}
                className={`px-2 py-0.5 rounded transition ${
                  playbackRate === rate
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
              } else {
                document.documentElement.requestFullscreen().catch(() => {});
              }
            }}
            title="Fullscreen"
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
