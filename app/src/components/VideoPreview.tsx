import React, { useRef, useEffect } from "react";
import type { Timeline, TimelineCut, SceneCut } from "../types/schemas";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Maximize2,
  Activity,
  Volume2,
  VolumeX,
  Zap,
  Sun,
  Eye,
  X,
} from "lucide-react";

export interface VideoPreviewProps {
  timeline: Timeline | null;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  duration?: number;
  volume?: number;
  isMuted?: boolean;
  previewScene?: SceneCut | null;
  onClearPreviewScene?: () => void;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onChangePlaybackRate: (rate: number) => void;
  onToggleMute?: () => void;
  onChangeVolume?: (volume: number) => void;
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
  volume = 0.8,
  isMuted = false,
  previewScene = null,
  onClearPreviewScene,
  onPlayPause,
  onSeek,
  onChangePlaybackRate,
  onToggleMute,
  onChangeVolume,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cuts = timeline?.cuts || [];
  const duration =
    customDuration ||
    (cuts.length > 0 ? cuts[cuts.length - 1].timeline_end : 16.0);

  // Find active cut in timeline mode
  const activeCutIndex = cuts.findIndex(
    (c) => currentTime >= c.timeline_start && currentTime < c.timeline_end
  );
  const activeCut: TimelineCut | undefined = cuts[activeCutIndex];

  // Sync video element time if previewing a scene section
  useEffect(() => {
    if (previewScene && videoRef.current && !previewScene.is_still_image && previewScene.media_type !== "image") {
      videoRef.current.currentTime = previewScene.start_time;
      const playPromise = videoRef.current.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    }
  }, [previewScene]);

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

  const isImg = previewScene?.is_still_image || previewScene?.media_type === "image";
  const mediaStreamUrl = previewScene
    ? `/api/media-stream?path=${encodeURIComponent(previewScene.source_file)}`
    : "";

  return (
    <div
      className="flex flex-col h-full bg-slate-950/40 rounded-2xl border border-slate-800/80 overflow-hidden shadow-2xl relative"
      data-testid="video-preview-stage"
    >
      {/* Video Monitor Stage */}
      <div className="flex-1 relative flex items-center justify-center bg-black/80 overflow-hidden group">
        {/* Mode A: Previewing a Statically Analyzed Highlight */}
        {previewScene ? (
          <div className="w-full h-full relative flex items-center justify-center bg-black">
            {isImg ? (
              <img
                src={previewScene.keyframe_path || mediaStreamUrl}
                alt={previewScene.source_file}
                className="w-full h-full object-contain select-none"
              />
            ) : (
              <video
                ref={videoRef}
                src={`${mediaStreamUrl}#t=${previewScene.start_time},${previewScene.end_time}`}
                poster={previewScene.keyframe_path}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-contain"
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.currentTime >= previewScene.end_time || v.currentTime < previewScene.start_time) {
                    v.currentTime = previewScene.start_time;
                  }
                }}
              />
            )}

            {/* Top Bar Overlay: Highlight Tag & Return Action */}
            <div className="absolute top-4 inset-x-4 flex items-center justify-between pointer-events-auto z-10">
              <div className="flex items-center gap-2">
                <div className="px-3 py-1 rounded-lg bg-purple-950/90 backdrop-blur-md border border-purple-500/50 text-xs font-mono flex items-center gap-2 text-purple-200 shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                  <span className="font-bold">HIGHLIGHT #{previewScene.scene_id + 1}</span>
                  <span className="text-purple-400 font-semibold uppercase text-[10px] px-1.5 py-0.2 rounded bg-purple-900/60">
                    {isImg ? "PHOTO" : "VIDEO SHOT"}
                  </span>
                </div>
                <div className="px-2.5 py-1 rounded-lg bg-slate-950/80 backdrop-blur text-xs font-mono text-slate-300 max-w-sm truncate border border-slate-800">
                  {previewScene.source_file.split("/").pop()}
                </div>
              </div>

              {onClearPreviewScene && (
                <button
                  onClick={onClearPreviewScene}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 font-medium shadow-lg transition active:scale-95"
                >
                  <X className="w-3.5 h-3.5 text-rose-400" />
                  Return to Timeline
                </button>
              )}
            </div>

            {/* Bottom HUD: Detailed Static Analysis Metrics Overlay */}
            <div className="absolute bottom-4 inset-x-4 bg-slate-950/90 backdrop-blur-md border border-purple-500/30 p-3 rounded-xl shadow-2xl z-10 pointer-events-auto">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800/80">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <Eye className="w-4 h-4 text-purple-400" />
                  <span>PySceneDetect & OpenCV Static Analysis HUD</span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  {isImg ? (
                    <span className="text-emerald-400">Elastic Duration (Cuts to any beat)</span>
                  ) : (
                    <span>
                      Slice: {previewScene.start_time.toFixed(2)}s – {previewScene.end_time.toFixed(2)}s (Duration: {previewScene.duration.toFixed(2)}s)
                    </span>
                  )}
                </div>
              </div>

              {/* Metric Cards Grid */}
              <div className="grid grid-cols-3 gap-3">
                {/* Sharpness (Laplacian Variance) */}
                <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-emerald-400" />
                      Sharpness (Laplacian)
                    </span>
                    <span className={`text-[10px] font-semibold px-1 rounded ${
                      (previewScene.sharpness_score ?? 0) > 150
                        ? "text-emerald-400 bg-emerald-950"
                        : (previewScene.sharpness_score ?? 0) > 60
                        ? "text-indigo-400 bg-indigo-950"
                        : "text-slate-400 bg-slate-800"
                    }`}>
                      {(previewScene.sharpness_score ?? 0) > 150 ? "Crisp / Detailed" : (previewScene.sharpness_score ?? 0) > 60 ? "Balanced" : "Soft"}
                    </span>
                  </div>
                  <div className="text-base font-bold font-mono text-slate-100">
                    {previewScene.sharpness_score !== null && previewScene.sharpness_score !== undefined
                      ? previewScene.sharpness_score.toFixed(1)
                      : "N/A"}
                  </div>
                </div>

                {/* Brightness (Luminance Mean) */}
                <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Sun className="w-3 h-3 text-amber-400" />
                      Mean Luminance
                    </span>
                    <span className={`text-[10px] font-semibold px-1 rounded ${
                      (previewScene.brightness_score ?? 0) > 140
                        ? "text-amber-400 bg-amber-950"
                        : (previewScene.brightness_score ?? 0) > 70
                        ? "text-amber-300 bg-amber-950/60"
                        : "text-slate-400 bg-slate-800"
                    }`}>
                      {(previewScene.brightness_score ?? 0) > 140 ? "Bright / Well-Lit" : (previewScene.brightness_score ?? 0) > 70 ? "Warm Exposure" : "Low Light"}
                    </span>
                  </div>
                  <div className="text-base font-bold font-mono text-slate-100">
                    {previewScene.brightness_score !== null && previewScene.brightness_score !== undefined
                      ? `${previewScene.brightness_score.toFixed(1)} / 255`
                      : "N/A"}
                  </div>
                </div>

                {/* Motion Score */}
                <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Activity className="w-3 h-3 text-cyan-400" />
                      Motion Energy
                    </span>
                    <span className="text-[10px] font-semibold px-1 rounded text-cyan-400 bg-cyan-950">
                      {isImg ? "Static Photo" : (previewScene.motion_score ?? 0) > 40 ? "High Action" : "Steady Shot"}
                    </span>
                  </div>
                  <div className="text-base font-bold font-mono text-slate-100">
                    {isImg
                      ? "0.0 (Static)"
                      : previewScene.motion_score !== null && previewScene.motion_score !== undefined
                      ? previewScene.motion_score.toFixed(1)
                      : "PySceneDetect Cut"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : activeCut?.keyframe_path ? (
          /* Mode B: Timeline Active Cut Playback */
          <img
            src={activeCut.keyframe_path}
            alt="Current Frame"
            className="w-full h-full object-contain select-none"
          />
        ) : (
          /* Mode C: Idle Stage */
          <div className="flex flex-col items-center justify-center text-slate-600 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:scale-105 group-hover:border-indigo-500/50 transition duration-300">
              <Play className="w-7 h-7 text-indigo-400 ml-1" />
            </div>
            <div className="text-sm font-medium text-slate-400">Montage & Video Preview Stage</div>
            <div className="text-xs text-slate-600">Select any highlight on the left to inspect static analysis HUD</div>
          </div>
        )}

        {/* Timeline Cut Overlay HUD (Top-Left) */}
        {!previewScene && activeCut && (
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
            <div className="px-2 py-0.5 rounded bg-slate-950/70 text-[11px] text-slate-400 max-w-xs truncate border border-slate-800/60">
              {activeCut.source_file.split("/").pop()} ({activeCut.source_in.toFixed(2)}s –{" "}
              {activeCut.source_out.toFixed(2)}s)
            </div>
          </div>
        )}

        {/* Overlay Frame HUD (Top-Right) */}
        {!previewScene && (
          <div className="absolute top-4 right-4 flex items-center gap-2 pointer-events-none">
            <div className="px-2.5 py-1 rounded-md bg-slate-950/80 backdrop-blur border border-slate-800 text-xs font-mono text-emerald-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              <span>24 FPS • Frame-Accurate</span>
            </div>
          </div>
        )}

        {/* Play/Pause Central Click Area (only in timeline mode) */}
        {!previewScene && (
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
        )}
      </div>

      {/* Playback Controls Toolbar */}
      <div className="h-14 bg-slate-900/90 border-t border-slate-800 px-4 flex items-center justify-between shrink-0">
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

          {/* Audio Volume Controls */}
          <div className="flex items-center gap-1.5 ml-2 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
            <button
              onClick={onToggleMute}
              title={isMuted ? "Unmute" : "Mute"}
              className="text-slate-400 hover:text-slate-200 transition"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-indigo-400" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => onChangeVolume?.(parseFloat(e.target.value))}
              aria-label="Volume"
              className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
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
