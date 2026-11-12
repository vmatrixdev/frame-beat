import React, { useRef, useEffect, useState } from "react";
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
  Smile,
  Scissors,
  Plus,
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
  activeVideoTrack?: number;
  onClearPreviewScene?: () => void;
  onAddToTimeline?: (scene: SceneCut) => void;
  onCreateHighlightSegment?: (sourceFile: string, startTime: number, endTime: number) => void;
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
  activeVideoTrack = 0,
  onClearPreviewScene,
  onAddToTimeline,
  onCreateHighlightSegment,
  onPlayPause,
  onSeek,
  onChangePlaybackRate,
  onToggleMute,
  onChangeVolume,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineVideoRef = useRef<HTMLVideoElement>(null);
  const [isHighlightPlaying, setIsHighlightPlaying] = useState<boolean>(true);
  const [highlightCurrentTime, setHighlightCurrentTime] = useState<number>(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);

  const cuts = timeline?.cuts || [];
  const duration =
    customDuration ||
    (cuts.length > 0 ? cuts[cuts.length - 1].timeline_end : 16.0);

  // Find active cut in timeline mode (prefer activeVideoTrack)
  const trackMatchIdx = cuts.findIndex(
    (c) =>
      (c.track_index ?? 0) === activeVideoTrack &&
      currentTime >= c.timeline_start &&
      currentTime < c.timeline_end
  );
  const activeCutIndex =
    trackMatchIdx >= 0
      ? trackMatchIdx
      : cuts.findIndex((c) => currentTime >= c.timeline_start && currentTime < c.timeline_end);
  const activeCut: TimelineCut | undefined = cuts[activeCutIndex];
  const activeCutIsVideo = Boolean(
    activeCut &&
      activeCut.source_out > activeCut.source_in &&
      !/\.(jpg|jpeg|png|webp|bmp)$/i.test(activeCut.source_file)
  );

  // Sync video element time and volume if previewing a scene section
  useEffect(() => {
    setVideoError(null);
    setMarkIn(null);
    setMarkOut(null);
    if (previewScene && videoRef.current && !previewScene.is_still_image && previewScene.media_type !== "image") {
      videoRef.current.currentTime = previewScene.start_time;
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
      const playPromise = videoRef.current.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          if (videoRef.current) {
            videoRef.current.muted = true;
            const mutedPromise = videoRef.current.play();
            if (mutedPromise && typeof mutedPromise.catch === "function") {
              mutedPromise.catch(() => {});
            }
          }
        });
      }
      setIsHighlightPlaying(true);
      setHighlightCurrentTime(0);
    }
  }, [previewScene]);

  // Sync volume, mute & playbackRate changes to the video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
      videoRef.current.playbackRate = playbackRate;
    }
  }, [volume, isMuted, playbackRate]);

  // Sync Timeline Mode <video> playback with timeline currentTime, isPlaying, and playbackRate
  useEffect(() => {
    if (previewScene || !activeCut || !activeCutIsVideo || !timelineVideoRef.current) return;
    const vid = timelineVideoRef.current;
    const targetSrcTime =
      activeCut.source_in + Math.max(0, currentTime - activeCut.timeline_start);

    vid.playbackRate = playbackRate;
    vid.muted = true; // Soundtrack plays via audioEngine in timeline mode

    if (Math.abs(vid.currentTime - targetSrcTime) > 0.35) {
      try {
        vid.currentTime = targetSrcTime;
      } catch {
        // ignore if metadata not yet loaded
      }
    }

    if (isPlaying) {
      if (vid.paused) {
        const p = vid.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } else if (!vid.paused) {
      vid.pause();
    }
  }, [previewScene, activeCut, activeCutIsVideo, currentTime, isPlaying, playbackRate]);

  // Toggle play/pause of the highlight video element
  const handleToggleHighlightPlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      const p = videoRef.current.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      setIsHighlightPlaying(true);
    } else {
      videoRef.current.pause();
      setIsHighlightPlaying(false);
    }
  };

  // Step 1 beat or 0.25s
  const handleStepBack = () => {
    if (previewScene && videoRef.current) {
      videoRef.current.currentTime = Math.max(previewScene.start_time, videoRef.current.currentTime - 0.5);
    } else {
      onSeek(Math.max(0, currentTime - 0.5));
    }
  };

  const handleStepForward = () => {
    if (previewScene && videoRef.current) {
      const end = previewScene.end_time > previewScene.start_time ? previewScene.end_time : videoRef.current.duration;
      videoRef.current.currentTime = Math.min(end, videoRef.current.currentTime + 0.5);
    } else {
      onSeek(Math.min(duration, currentTime + 0.5));
    }
  };

  const handleRestart = () => {
    if (previewScene && videoRef.current) {
      videoRef.current.currentTime = previewScene.start_time;
      videoRef.current.play().catch(() => {});
      setIsHighlightPlaying(true);
    } else {
      onSeek(0);
    }
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
                key={previewScene.source_file + previewScene.start_time + previewScene.scene_id}
                src={mediaStreamUrl}
                poster={previewScene.keyframe_path}
                controls
                autoPlay
                playsInline
                preload="auto"
                className="w-full h-full object-contain"
                onPlay={() => setIsHighlightPlaying(true)}
                onPause={() => setIsHighlightPlaying(false)}
                onLoadedMetadata={() => {
                  if (videoRef.current && previewScene) {
                    setVideoError(null);
                    videoRef.current.currentTime = previewScene.start_time;
                    videoRef.current.volume = volume;
                    videoRef.current.muted = isMuted;
                    const p = videoRef.current.play();
                    if (p && typeof p.catch === "function") {
                      p.catch(() => {
                        if (videoRef.current) {
                          videoRef.current.muted = true;
                          const mp = videoRef.current.play();
                          if (mp && typeof mp.catch === "function") mp.catch(() => {});
                        }
                      });
                    }
                    setIsHighlightPlaying(true);
                  }
                }}
                onError={() => {
                  setVideoError(`Unable to stream video: ${previewScene.source_file}`);
                }}
                onTimeUpdate={() => {
                  if (videoRef.current && previewScene) {
                    const curr = videoRef.current.currentTime;
                    setHighlightCurrentTime(Math.max(0, curr - previewScene.start_time));
                    const end =
                      previewScene.end_time > previewScene.start_time
                        ? previewScene.end_time
                        : videoRef.current.duration;
                    if (curr >= end || curr < previewScene.start_time) {
                      videoRef.current.currentTime = previewScene.start_time;
                      const p = videoRef.current.play();
                      if (p && typeof p.catch === "function") p.catch(() => {});
                    }
                  }
                }}
              />
            )}

            {videoError && (
              <div className="absolute inset-x-6 top-16 z-20 px-3 py-2 rounded-lg bg-rose-950/90 border border-rose-500/60 text-rose-200 text-xs font-mono">
                {videoError}
              </div>
            )}

            {/* Top Bar Overlay: Highlight Tag & Return Action */}
            <div className="absolute top-4 inset-x-4 flex items-center justify-between pointer-events-auto z-10">
              <div className="flex items-center gap-2">
                <div className="px-3 py-1 rounded-lg bg-purple-950/90 backdrop-blur-md border border-purple-500/50 text-xs font-mono flex items-center gap-2 text-purple-200 shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                  <span className="font-bold">
                    {previewScene.scene_id < 0 ? "RAW ASSET" : `HIGHLIGHT #${previewScene.scene_id + 1}`}
                  </span>
                  <span className="text-purple-400 font-semibold uppercase text-[10px] px-1.5 py-0.2 rounded bg-purple-900/60">
                    {isImg ? "PHOTO" : "VIDEO CLIP"}
                  </span>
                </div>
                <div className="px-2.5 py-1 rounded-lg bg-slate-950/80 backdrop-blur text-xs font-mono text-slate-300 max-w-sm truncate border border-slate-800">
                  {previewScene.source_file.split("/").pop()}
                </div>
              </div>

              {onClearPreviewScene && (
                <button
                  onClick={onClearPreviewScene}
                  title="Return to Timeline (Esc)"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 font-medium shadow-lg transition active:scale-95"
                >
                  <X className="w-3.5 h-3.5 text-rose-400" />
                  Return to Timeline
                </button>
              )}
            </div>
          </div>
        ) : activeCut ? (
          /* Mode B: Timeline Active Cut Playback (real video stream or still image) */
          activeCutIsVideo ? (
            <video
              ref={timelineVideoRef}
              key={`tl-${activeCut.source_file}-${activeCut.source_in}-${activeCutIndex}`}
              src={`/api/media-stream?path=${encodeURIComponent(activeCut.source_file)}`}
              poster={activeCut.keyframe_path}
              muted
              playsInline
              preload="auto"
              className="w-full h-full object-contain select-none"
              onLoadedMetadata={() => {
                if (timelineVideoRef.current && activeCut) {
                  const targetSrcTime =
                    activeCut.source_in + Math.max(0, currentTime - activeCut.timeline_start);
                  timelineVideoRef.current.currentTime = targetSrcTime;
                  timelineVideoRef.current.playbackRate = playbackRate;
                  if (isPlaying) {
                    const p = timelineVideoRef.current.play();
                    if (p && typeof p.catch === "function") p.catch(() => {});
                  }
                }
              }}
            />
          ) : (
            <img
              src={
                activeCut.keyframe_path ||
                `/api/media-stream?path=${encodeURIComponent(activeCut.source_file)}`
              }
              alt="Current Frame"
              className="w-full h-full object-contain select-none"
            />
          )
        ) : (
          /* Mode C: Idle Stage */
          <div className="flex flex-col items-center justify-center text-slate-600 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:scale-105 group-hover:border-indigo-500/50 transition duration-300">
              <Play className="w-7 h-7 text-indigo-400 ml-1" />
            </div>
            <div className="text-sm font-medium text-slate-400">Montage & Video Preview Stage</div>
            <div className="text-xs text-slate-600">
              Select any highlight on the left to inspect static analysis HUD
            </div>
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

      {/* Outside-Player Static Analysis Inspector Strip (Never blocks the video frame) */}
      {previewScene && (
        <div className="bg-slate-950/95 border-t border-purple-500/30 px-4 py-2 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-200">
              <Eye className="w-3.5 h-3.5 text-purple-400" />
              <span>PySceneDetect & OpenCV Static Analysis HUD</span>
            </div>

            {/* Manual Segment Marking + Add to Timeline Actions */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {!isImg && onCreateHighlightSegment && (
                <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-md px-1.5 py-0.5 text-[10px] font-mono">
                  <Scissors className="w-3 h-3 text-purple-400" />
                  <button
                    type="button"
                    onClick={() => setMarkIn(Number((videoRef.current?.currentTime ?? 0).toFixed(2)))}
                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                    title="Mark segment start at current playhead"
                  >
                    In{markIn !== null ? `: ${markIn.toFixed(1)}s` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarkOut(Number((videoRef.current?.currentTime ?? 0).toFixed(2)))}
                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                    title="Mark segment end at current playhead"
                  >
                    Out{markOut !== null ? `: ${markOut.toFixed(1)}s` : ""}
                  </button>
                  {markIn !== null && markOut !== null && markOut > markIn && (
                    <button
                      type="button"
                      onClick={() => {
                        onCreateHighlightSegment(previewScene.source_file, markIn, markOut);
                        setMarkIn(null);
                        setMarkOut(null);
                      }}
                      className="px-1.5 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold transition"
                    >
                      Save Highlight
                    </button>
                  )}
                </div>
              )}

              {onAddToTimeline && (
                <button
                  type="button"
                  onClick={() => onAddToTimeline(previewScene)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold text-white transition"
                >
                  <Plus className="w-3 h-3" />
                  Add to Timeline
                </button>
              )}

              <div className="text-[11px] font-mono text-slate-400 ml-1">
                {isImg ? (
                  <span className="text-emerald-400">Elastic Duration</span>
                ) : previewScene.scene_id < 0 ? (
                  <span className="text-indigo-300">
                    Raw ({previewScene.duration.toFixed(2)}s)
                  </span>
                ) : (
                  <span>
                    {previewScene.start_time.toFixed(2)}s–{previewScene.end_time.toFixed(2)}s ({previewScene.duration.toFixed(2)}s)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <Zap className="w-3 h-3 text-emerald-400" />
                Sharpness
              </span>
              <span className="text-xs font-bold font-mono text-slate-100">
                {previewScene.sharpness_score !== null && previewScene.sharpness_score !== undefined
                  ? previewScene.sharpness_score.toFixed(1)
                  : "N/A"}
              </span>
            </div>

            <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <Sun className="w-3 h-3 text-amber-400" />
                Luminance
              </span>
              <span className="text-xs font-bold font-mono text-slate-100">
                {previewScene.brightness_score !== null && previewScene.brightness_score !== undefined
                  ? `${previewScene.brightness_score.toFixed(1)} / 255`
                  : "N/A"}
              </span>
            </div>

            <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <Activity className="w-3 h-3 text-cyan-400" />
                Motion
              </span>
              <span className="text-xs font-bold font-mono text-slate-100">
                {isImg
                  ? "0.0 (Static)"
                  : previewScene.motion_score !== null && previewScene.motion_score !== undefined
                  ? previewScene.motion_score.toFixed(1)
                  : "PySceneDetect Cut"}
              </span>
            </div>

            <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between gap-2 min-w-0">
              <span className="flex items-center gap-1 text-[11px] text-slate-400 shrink-0">
                <Smile className="w-3 h-3 text-rose-400" />
                Subject & Emotion
              </span>
              <div className="text-right min-w-0">
                <div className="text-xs font-bold font-mono text-slate-100 truncate">
                  {previewScene.has_faces
                    ? `${previewScene.dominant_expression ?? "Neutral"}${
                        previewScene.smile_score !== null && previewScene.smile_score !== undefined
                          ? ` (${Math.round(previewScene.smile_score * 100)}%)`
                          : ""
                      }`
                    : "No Faces Detected"}
                </div>
                <div className="text-[10px] font-mono text-rose-300 truncate">
                  {previewScene.has_faces
                    ? `${previewScene.face_count ?? 1} Face${(previewScene.face_count ?? 1) > 1 ? "s" : ""} • ${
                        previewScene.subject_prominence ? previewScene.subject_prominence.replace("_", " ") : "subject"
                      }`
                    : previewScene.subject_prominence
                    ? previewScene.subject_prominence.replace("_", " ")
                    : "Scenic"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Playback Seekbar Scrubber */}
      {(!previewScene || !isImg) && (
        <div className="bg-slate-900/95 border-t border-slate-800 px-4 pt-2 pb-0.5 flex items-center gap-2 shrink-0">
          <input
            type="range"
            min={0}
            max={
              previewScene
                ? Math.max(0.1, previewScene.duration || videoRef.current?.duration || 10)
                : Math.max(0.1, duration)
            }
            step={0.05}
            value={previewScene ? highlightCurrentTime : currentTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (previewScene && videoRef.current) {
                videoRef.current.currentTime = previewScene.start_time + val;
                setHighlightCurrentTime(val);
              } else {
                onSeek(val);
              }
            }}
            aria-label="Seek video position"
            className={`w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer ${
              previewScene ? "accent-purple-500" : "accent-indigo-500"
            }`}
          />
        </div>
      )}

      {/* Playback Controls Toolbar */}
      <div className="h-12 bg-slate-900/90 px-4 flex items-center justify-between shrink-0">
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
            onClick={previewScene ? handleToggleHighlightPlay : onPlayPause}
            aria-label={
              previewScene
                ? isHighlightPlaying
                  ? "Pause"
                  : "Play"
                : isPlaying
                ? "Pause"
                : "Play"
            }
            className={`w-9 h-9 rounded-lg active:scale-95 flex items-center justify-center text-white shadow-md transition ${
              previewScene
                ? "bg-purple-600 hover:bg-purple-500 shadow-purple-600/30"
                : "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30"
            }`}
          >
            {previewScene ? (
              isHighlightPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 ml-0.5" />
              )
            ) : isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
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
            {previewScene ? (
              <>
                <span className="text-purple-300 font-semibold">
                  {formatTimecode(highlightCurrentTime)}
                </span>
                <span className="text-slate-600">/</span>
                <span className="text-slate-400">
                  {formatTimecode(previewScene.duration || 0)}
                </span>
                <span className="text-[10px] text-purple-400 bg-purple-950 px-1.5 py-0.2 rounded border border-purple-800/60 ml-1">
                  HIGHLIGHT
                </span>
              </>
            ) : (
              <>
                <span className="text-slate-100 font-semibold">{formatTimecode(currentTime)}</span>
                <span className="text-slate-600">/</span>
                <span className="text-slate-400">{formatTimecode(duration)}</span>
              </>
            )}
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
