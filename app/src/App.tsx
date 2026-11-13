import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import {
  Download,
  Layers,
  Sparkles,
  Loader2,
  Film,
  FolderOpen,
  ZoomIn,
  ZoomOut,
  Plus,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  AudioTrackItem,
  BeatsData,
  ScenesCatalog,
  Timeline,
  TimelineCut,
  SceneCut,
} from "./types/schemas";
import {
  buildCutFromScene,
  computeZoomAnchor,
  computeZoomScrollLeft,
  mergeScenesCatalog,
  splitCutAtTime,
  type ZoomAnchor,
} from "./utils/timelineEditor";
import { engineClient, isTauriEnvironment } from "./services/engineClient";
import { audioEngine } from "./services/audioEngine";
import { DropZones } from "./components/DropZones";
import { MediaLibraryTree } from "./components/MediaLibraryTree";
import { HighlightsList, type HighlightAnalysisSettings } from "./components/HighlightsList";
import { ClipHighlightsModal } from "./components/ClipHighlightsModal";
import { WaveformVisualizer } from "./components/WaveformVisualizer";
import { TimelineTrack } from "./components/TimelineTrack";
import { VideoPreview } from "./components/VideoPreview";
import { ExportModal, type ExportFormat } from "./components/ExportModal";

const PROMPT_PRESETS = [
  "💍 Wedding: Emotional pacing with gentle crossfades, holding on warm portraits during melodic verses",
  "👶 Growing Up: Heartfelt children memory montage, soft dissolves, lingering on smiling moments",
  "🎓 Graduation: Inspiring milestone celebration with steady build-up to celebratory chorus cuts",
  "🎂 Birthday: Joyful rhythm cuts on snare beats, vibrant festive party highlights",
  "✈️ Travel Recap: Dynamic tempo cuts matching drum downbeats, whip pans, scenic vistas",
  "⚡ Action & AMV: High-octane battle cuts matching bass drops with white flash transitions",
];

export default function App() {
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [videoDir, setVideoDir] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>(
    "💍 Wedding: Emotional pacing with gentle crossfades, holding on warm portraits during melodic verses"
  );
  const [projectTitle] = useState<string>("My Cinematic Montage");

  // Analysis & Engine state
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState<boolean>(false);
  const [isAnalyzingScenes, setIsAnalyzingScenes] = useState<boolean>(false);
  const [isDirecting, setIsDirecting] = useState<boolean>(false);
  const [beats, setBeats] = useState<BeatsData | null>(null);
  const [scenes, setScenes] = useState<ScenesCatalog | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [previewScene, setPreviewScene] = useState<SceneCut | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"library" | "highlights">("library");
  const [highlightSettings, setHighlightSettings] = useState<HighlightAnalysisSettings>({
    detectorThreshold: 27,
    maxSceneDuration: 5.5,
    targetWindowDuration: 3.5,
    minWindowDuration: 2.0,
  });
  const [clipHighlightsTarget, setClipHighlightsTarget] = useState<string | null>(null);

  // Playback & Scrubber state
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [selectedCutIndex, setSelectedCutIndex] = useState<number | null>(null);
  const [timelineZoom, setTimelineZoom] = useState<number>(1.0);
  const [videoTrackCount, setVideoTrackCount] = useState<number>(1);
  const [activeVideoTrack, setActiveVideoTrack] = useState<number>(0);
  const [audioTracks, setAudioTracks] = useState<AudioTrackItem[]>([]);
  const [activeAudioTrackId, setActiveAudioTrackId] = useState<string | null>(null);
  const extraAudioInputRef = useRef<HTMLInputElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const scrollEl = timelineScrollRef.current;
    if (!anchor || !scrollEl) return;
    pendingZoomAnchorRef.current = null;
    scrollEl.scrollLeft = computeZoomScrollLeft(
      anchor,
      scrollEl.scrollWidth,
      scrollEl.clientWidth
    );
  }, [timelineZoom]);

  // Resizable Layout Panels state
  const [sidebarWidth, setSidebarWidth] = useState<number>(384);
  const [timelineHeight, setTimelineHeight] = useState<number>(290);
  const [resizingPanel, setResizingPanel] = useState<null | "sidebar" | "timeline">(null);

  // Export Modal state
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");

  const isNativeTauri = isTauriEnvironment();
  const lastTimeRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const maxCutEnd = timeline?.cuts.length
    ? timeline.cuts.reduce((acc, c) => Math.max(acc, c.timeline_end), 0)
    : 0;
  const duration = Math.max(maxCutEnd, beats?.duration_sec || 0, 16.0);

  // Map each source video path to its total analyzed duration so right-edge trimming cannot exceed it
  const sourceDurations = useMemo(() => {
    const map: Record<string, number> = {};
    if (!scenes?.scenes) return map;
    for (const s of scenes.scenes) {
      if (!s.is_still_image && s.media_type !== "image" && s.end_time > 0) {
        map[s.source_file] = Math.max(map[s.source_file] || 0, s.end_time);
      }
    }
    return map;
  }, [scenes]);

  // Handle Audio Selection & Analysis (Primary or Additional Audio Track)
  const handleSelectAudio = async (path: string, file?: File, appendNewTrack = false) => {
    setAudioFile(path);
    let detectedDuration: number | undefined = undefined;

    if (file) {
      const objectUrl = URL.createObjectURL(file);
      detectedDuration = await audioEngine.loadAudioSource(objectUrl);
    }

    setIsAnalyzingAudio(true);
    try {
      const beatsResult = await engineClient.analyzeSoundtrack(path, detectedDuration, file);
      setBeats(beatsResult);
      if (!file) {
        audioEngine.setSyntheticBeats(beatsResult);
      }

      const trackId = `audio_${Date.now()}`;
      const newTrack: AudioTrackItem = {
        id: trackId,
        name: path.split("/").pop() || path,
        audioFile: path,
        beats: beatsResult,
        muted: false,
        solo: false,
      };

      setAudioTracks((prev) => {
        if (!appendNewTrack && prev.length > 0) {
          return [{ ...newTrack, id: prev[0].id }, ...prev.slice(1)];
        }
        return [...prev, newTrack];
      });
      setActiveAudioTrackId((prevId) => (appendNewTrack || !prevId ? trackId : prevId));
    } catch (err) {
      console.error("Audio analysis failed:", err);
    } finally {
      setIsAnalyzingAudio(false);
    }
  };

  // Handle Video Selection & Scene Detection (merges into existing library instead of replacing)
  const handleSelectVideoDir = async (dir: string, files?: File[]) => {
    setVideoDir(dir);
    setIsAnalyzingScenes(true);
    try {
      const scenesResult = await engineClient.analyzeScenes(dir, undefined, files, highlightSettings);
      setScenes((prev) => mergeScenesCatalog(prev, scenesResult));
      if (scenesResult.scenes.length > 0) {
        setPreviewScene((prev) => prev ?? scenesResult.scenes[0]);
      }
    } catch (err) {
      console.error("Scene analysis failed:", err);
    } finally {
      setIsAnalyzingScenes(false);
    }
  };

  // Re-run highlight windowing on all loaded raw media using current highlightSettings
  const handleReanalyzeAllHighlights = async () => {
    if (!scenes || scenes.source_files.length === 0) return;
    setIsAnalyzingScenes(true);
    try {
      let updated: ScenesCatalog | null = scenes;
      for (const filePath of scenes.source_files) {
        const res = await engineClient.analyzeScenes(filePath, undefined, undefined, highlightSettings);
        updated = mergeScenesCatalog(updated, res);
      }
      if (updated) {
        setScenes(updated);
        if (updated.scenes.length > 0) {
          setPreviewScene(updated.scenes[0]);
        }
      }
    } catch (err) {
      console.error("Re-analyzing highlights failed:", err);
    } finally {
      setIsAnalyzingScenes(false);
    }
  };

  // Re-run highlight windowing on a single raw video from the "Clip Highlights..." context menu
  const handleRegenerateVideoHighlights = async (
    sourceFile: string,
    settings: HighlightAnalysisSettings
  ) => {
    setHighlightSettings(settings);
    setIsAnalyzingScenes(true);
    try {
      const res = await engineClient.analyzeScenes(sourceFile, undefined, undefined, settings);
      setScenes((prev) => mergeScenesCatalog(prev, res));
      if (res.scenes.length > 0) {
        setPreviewScene(res.scenes[0]);
      }
      setClipHighlightsTarget(null);
    } catch (err) {
      console.error("Clip highlight re-generation failed:", err);
    } finally {
      setIsAnalyzingScenes(false);
    }
  };

  // Import Pre-Analyzed PySceneDetect Scenes Catalog JSON
  const handleImportScenesCatalog = async (file: File) => {
    setIsAnalyzingScenes(true);
    try {
      const text = await file.text();
      const catalog = engineClient.importScenesCatalog(text);
      setScenes(catalog);
      setVideoDir(file.name);
      if (catalog.scenes.length > 0) {
        setPreviewScene(catalog.scenes[0]);
      }
    } catch (err) {
      console.error("Failed to import scenes catalog:", err);
      alert(err instanceof Error ? err.message : "Failed to import scenes catalog JSON");
    } finally {
      setIsAnalyzingScenes(false);
    }
  };

  // Direct AMV Timeline with Gemini LLM / Procedural Director
  const handleGenerateTimeline = async () => {
    if (!beats || !scenes) {
      return;
    }

    setIsDirecting(true);
    try {
      const generated = await engineClient.directAmv(
        beats,
        scenes,
        prompt,
        projectTitle,
        audioFile || undefined
      );
      setTimeline(generated);
      setCurrentTime(0);
      setIsPlaying(false);
      audioEngine.stop();
    } catch (err) {
      console.error("Director generation failed:", err);
    } finally {
      setIsDirecting(false);
    }
  };

  // Playback & Audio Controls
  const handleSelectHighlightScene = (scene: SceneCut) => {
    // Silence timeline soundtrack so the highlight video's native audio plays exclusively
    audioEngine.stop();
    setIsPlaying(false);
    setPreviewScene(scene);
  };

  // Manual Timeline Setup: Append a highlight, photo, or raw video onto the timeline
  const handleAddSceneToTimeline = (scene: SceneCut) => {
    setTimeline((prev) => {
      const existingCuts = prev?.cuts || [];
      const trackCuts = existingCuts.filter((c) => (c.track_index ?? 0) === activeVideoTrack);
      const timelineStart =
        trackCuts.length > 0 ? trackCuts[trackCuts.length - 1].timeline_end : 0.0;
      const newCut = buildCutFromScene(
        scene,
        timelineStart,
        activeVideoTrack,
        trackCuts.length > 0 ? "crossfade" : "cut"
      );
      return {
        project_title: prev?.project_title || projectTitle,
        target_audio: prev?.target_audio || audioFile || "soundtrack",
        cuts: [...existingCuts, newCut],
      };
    });
    setPreviewScene(null);
  };

  // Drag-and-drop scene directly onto a specific timeline track and timestamp
  const handleDropSceneOnTimeline = (
    scene: SceneCut,
    timelineStart: number,
    trackIndex: number
  ) => {
    const newCut = buildCutFromScene(scene, timelineStart, trackIndex, "cut");
    setTimeline((prev) => ({
      project_title: prev?.project_title || projectTitle,
      target_audio: prev?.target_audio || audioFile || "soundtrack",
      cuts: [...(prev?.cuts || []), newCut],
    }));
    setActiveVideoTrack(trackIndex);
    setPreviewScene(null);
  };

  // Update cuts from TimelineTrack (drag move, edge trim, split, transition cycle)
  const handleUpdateTimelineCuts = (updatedCuts: TimelineCut[]) => {
    setTimeline((prev) => ({
      project_title: prev?.project_title || projectTitle,
      target_audio: prev?.target_audio || audioFile || "soundtrack",
      cuts: updatedCuts,
    }));
  };

  // Remove a cut from the timeline while preserving all other clips' positions
  const handleRemoveTimelineCut = (index: number) => {
    setTimeline((prev) => {
      if (!prev) return prev;
      return { ...prev, cuts: prev.cuts.filter((_, i) => i !== index) };
    });
    setSelectedCutIndex(null);
  };

  // Manual Highlight Segment Creation (In/Out markers from VideoPreview)
  const handleCreateHighlightSegment = async (
    sourceFile: string,
    startTime: number,
    endTime: number
  ) => {
    setIsAnalyzingScenes(true);
    try {
      const nextId = scenes ? scenes.scenes.length : 0;
      const newCut = await engineClient.analyzeSegment(sourceFile, startTime, endTime, 5, nextId);
      setScenes((prev) => {
        if (!prev) {
          return {
            source_files: [sourceFile],
            total_scenes: 1,
            scenes: [newCut],
          };
        }
        const updatedScenes = [...prev.scenes, newCut];
        const sourceFiles = prev.source_files.includes(sourceFile)
          ? prev.source_files
          : [...prev.source_files, sourceFile];
        return {
          source_files: sourceFiles,
          total_scenes: updatedScenes.length,
          scenes: updatedScenes,
        };
      });
      setPreviewScene(newCut);
    } catch (err) {
      console.error("Failed to create manual highlight segment:", err);
    } finally {
      setIsAnalyzingScenes(false);
    }
  };

  // On-Demand Static Re-Analysis via Context Menu
  const handleReanalyzeScene = async (scene: SceneCut, sampleFrames: number) => {
    setIsAnalyzingScenes(true);
    try {
      const start = scene.scene_id < 0 ? 0.0 : scene.start_time;
      const end = scene.scene_id < 0 ? 0.0 : scene.end_time;
      const updatedCut = await engineClient.analyzeSegment(
        scene.source_file,
        start,
        end,
        sampleFrames,
        scene.scene_id < 0 ? 0 : scene.scene_id
      );
      if (scene.scene_id < 0) {
        setPreviewScene({ ...updatedCut, scene_id: -1 });
      } else {
        setScenes((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map((s) =>
              s.scene_id === scene.scene_id && s.source_file === scene.source_file
                ? updatedCut
                : s
            ),
          };
        });
        if (
          previewScene?.scene_id === scene.scene_id &&
          previewScene?.source_file === scene.source_file
        ) {
          setPreviewScene(updatedCut);
        }
      }
    } catch (err) {
      console.error("On-demand static analysis failed:", err);
    } finally {
      setIsAnalyzingScenes(false);
    }
  };

  const handleTogglePlayPause = () => {
    if (previewScene) {
      setPreviewScene(null);
    }
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        audioEngine.play(currentTime, playbackRate);
      } else {
        audioEngine.pause();
      }
      return next;
    });
  };

  const handleSeek = (time: number) => {
    if (previewScene) {
      setPreviewScene(null);
    }
    setCurrentTime(time);
    audioEngine.seek(time);
    if (isPlaying) {
      audioEngine.play(time, playbackRate);
    }
  };

  const handleChangePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (isPlaying) {
      audioEngine.play(currentTime, rate);
    }
  };

  const handleToggleMute = () => {
    const muted = audioEngine.toggleMute();
    setIsMuted(muted);
  };

  const handleChangeVolume = (v: number) => {
    setVolume(v);
    audioEngine.setVolume(v);
    if (isMuted && v > 0) {
      setIsMuted(false);
    }
  };

  // Playhead scrubber loop
  const updatePlayback = useCallback(
    (timestamp: number) => {
      if (lastTimeRef.current !== null && isPlaying) {
        const deltaSec = ((timestamp - lastTimeRef.current) / 1000) * playbackRate;
        setCurrentTime((prev) => {
          const next = prev + deltaSec;
          if (next >= duration) {
            setIsPlaying(false);
            audioEngine.stop();
            return 0;
          }
          return next;
        });
      }
      lastTimeRef.current = timestamp;
      if (isPlaying) {
        animFrameRef.current = requestAnimationFrame(updatePlayback);
      }
    },
    [isPlaying, playbackRate, duration]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = performance.now();
      animFrameRef.current = requestAnimationFrame(updatePlayback);
    } else {
      lastTimeRef.current = null;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    }
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying, updatePlayback]);

  // Resizable Sidebar & Timeline Drawer drag handlers
  useEffect(() => {
    if (!resizingPanel) return;
    const handlePointerMove = (e: PointerEvent) => {
      if (resizingPanel === "sidebar") {
        setSidebarWidth(Math.max(260, Math.min(640, e.clientX)));
      } else if (resizingPanel === "timeline") {
        setTimelineHeight(Math.max(180, Math.min(560, window.innerHeight - e.clientY)));
      }
    };
    const handlePointerUp = () => setResizingPanel(null);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizingPanel]);

  // Global Studio Keyboard Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlayPause();
      } else if (e.code === "Escape") {
        setPreviewScene(null);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        handleSeek(Math.max(0, currentTime - (e.shiftKey ? 5.0 : 0.5)));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        handleSeek(Math.min(duration, currentTime + (e.shiftKey ? 5.0 : 0.5)));
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setTimelineZoom((z) => Math.min(8.0, Number((z + 0.5).toFixed(2))));
      } else if (e.key === "-") {
        e.preventDefault();
        setTimelineZoom((z) => Math.max(1.0, Number((z - 0.5).toFixed(2))));
      } else if ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey) {
        if (timeline && selectedCutIndex !== null && timeline.cuts[selectedCutIndex]) {
          e.preventDefault();
          handleUpdateTimelineCuts(splitCutAtTime(timeline.cuts, selectedCutIndex, currentTime));
        }
      } else if (
        (e.code === "Delete" || e.code === "Backspace") &&
        selectedCutIndex !== null &&
        timeline?.cuts[selectedCutIndex]
      ) {
        e.preventDefault();
        handleRemoveTimelineCut(selectedCutIndex);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, duration, playbackRate, isPlaying, timeline, selectedCutIndex]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Top Application Bar */}
      <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/80 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-rose-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            AMV
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-tight text-slate-100">AMV Maker</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                v0.1.0 • Phase 1
              </span>
            </div>
          </div>
        </div>

        {/* Runtime Environment Badge */}
        <div className="flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-full bg-slate-950/70 border border-slate-800">
          <div
            className={`w-2 h-2 rounded-full ${
              isNativeTauri ? "bg-emerald-400 animate-pulse" : "bg-sky-400"
            }`}
          />
          <span className="text-slate-300">
            {isNativeTauri ? "Tauri v2 Desktop Shell" : "Browser Dev Mode (Simulated IPC)"}
          </span>
        </div>

        {/* Export Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            disabled={!timeline || timeline.cuts.length === 0}
            onClick={() => {
              setExportFormat("mp4");
              setIsExportOpen(true);
            }}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-40 disabled:hover:bg-emerald-600 text-xs font-semibold transition shadow-md shadow-emerald-600/20"
          >
            <Download className="w-4 h-4" />
            Export MP4 (FFmpeg)
          </button>
          <button
            disabled={!timeline || timeline.cuts.length === 0}
            onClick={() => {
              setExportFormat("otio");
              setIsExportOpen(true);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40 text-xs font-medium border border-slate-700 transition"
          >
            <Layers className="w-4 h-4 text-indigo-400" />
            Export OTIO
          </button>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Control Sidebar (Resizable) */}
        <aside
          style={{ width: sidebarWidth }}
          className="border-r border-slate-800 p-5 flex flex-col gap-5 overflow-y-auto bg-slate-900/30 shrink-0"
        >
          {/* Top Sidebar Tab Switcher: Media Library vs Highlights Inspector */}
          <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              onClick={() => setSidebarTab("library")}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                sidebarTab === "library"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Media Library
            </button>
            <button
              onClick={() => setSidebarTab("highlights")}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                sidebarTab === "highlights"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-600/30 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Film className="w-3.5 h-3.5 text-purple-300" />
              Highlights {scenes ? `(${scenes.total_scenes})` : ""}
            </button>
          </div>

          {sidebarTab === "library" ? (
            <>
              {/* Section 1: Source Inputs & DropZones */}
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                  1. Source Inputs
                </h2>
                <DropZones
                  audioFile={audioFile}
                  videoDir={videoDir}
                  isAnalyzingAudio={isAnalyzingAudio}
                  isAnalyzingScenes={isAnalyzingScenes}
                  audioDuration={beats?.duration_sec}
                  audioBpm={beats?.tempo_bpm}
                  totalScenes={scenes?.total_scenes}
                  onSelectAudio={handleSelectAudio}
                  onSelectVideoDir={handleSelectVideoDir}
                  onImportScenesCatalog={handleImportScenesCatalog}
                  onViewHighlights={() => setSidebarTab("highlights")}
                />
              </div>

              {/* Project Media Library Tree (Audio + Raw Videos/Photos + Expandable Cuts) */}
              <MediaLibraryTree
                audioFile={audioFile}
                beats={beats}
                catalog={scenes}
                activeScene={previewScene}
                onSelectScene={handleSelectHighlightScene}
                onSelectAudioTrack={() => setPreviewScene(null)}
                onAddToTimeline={handleAddSceneToTimeline}
                onReanalyzeScene={handleReanalyzeScene}
                onOpenClipHighlights={(sourceFile) => setClipHighlightsTarget(sourceFile)}
              />

              {/* Section 2: LLM Director Directive */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    2. Director Directive & Style
                  </h2>
                  <span className="text-[10px] text-indigo-400 font-mono">Gemini Flash</span>
                </div>

                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder="Tell the Director how to pace and cut: e.g. 'Wedding montage with soft crossfades', 'Children growing up memories', 'Birthday celebration', or 'Fast-paced action cuts'..."
                  className="w-full text-xs rounded-xl bg-slate-950 border border-slate-800 p-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-200 placeholder-slate-500 resize-none"
                />

                {/* Quick Directive Chips */}
                <div className="flex flex-wrap gap-1.5">
                  {PROMPT_PRESETS.map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => setPrompt(p)}
                      className="text-[10px] px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/50 text-slate-300 transition text-left truncate max-w-full"
                    >
                      {p}
                    </button>
                  ))}
                </div>

                {/* Generate Action Button */}
                <button
                  onClick={handleGenerateTimeline}
                  disabled={isDirecting || !beats || !scenes}
                  className="w-full py-2.5 mt-2 rounded-xl bg-gradient-to-r from-indigo-600 to-rose-600 hover:from-indigo-500 hover:to-rose-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 transition active:scale-[0.99]"
                >
                  {isDirecting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Directing Beat-Synced Timeline...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate Montage Timeline
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            /* Highlights List Panel */
            <div className="flex-1 flex flex-col min-h-0">
              <HighlightsList
                catalog={scenes}
                activeScene={previewScene}
                onSelectScene={handleSelectHighlightScene}
                highlightSettings={highlightSettings}
                onChangeHighlightSettings={setHighlightSettings}
                onReanalyzeHighlights={handleReanalyzeAllHighlights}
                isReanalyzing={isAnalyzingScenes}
              />
            </div>
          )}
        </aside>

        {/* Vertical Splitter Handle for Sidebar Width */}
        <div
          onPointerDown={() => setResizingPanel("sidebar")}
          title="Drag to resize sidebar width"
          className={`w-1.5 cursor-col-resize transition shrink-0 ${
            resizingPanel === "sidebar" ? "bg-indigo-500" : "bg-transparent hover:bg-indigo-500/50"
          }`}
        />

        {/* Center / Right Stage */}
        <section className="flex-1 flex flex-col overflow-hidden bg-slate-950/40">
          {/* Main Video Monitor Stage */}
          <div className="flex-1 p-5 min-h-0 flex items-center justify-center">
            <div className="w-full h-full max-w-5xl">
              <VideoPreview
                timeline={timeline}
                currentTime={currentTime}
                isPlaying={isPlaying}
                playbackRate={playbackRate}
                duration={duration}
                volume={volume}
                isMuted={isMuted}
                previewScene={previewScene}
                activeVideoTrack={activeVideoTrack}
                onClearPreviewScene={() => setPreviewScene(null)}
                onAddToTimeline={handleAddSceneToTimeline}
                onCreateHighlightSegment={handleCreateHighlightSegment}
                onPlayPause={handleTogglePlayPause}
                onSeek={handleSeek}
                onChangePlaybackRate={handleChangePlaybackRate}
                onToggleMute={handleToggleMute}
                onChangeVolume={handleChangeVolume}
              />
            </div>
          </div>

          {/* Horizontal Splitter Handle for Timeline Height */}
          <div
            onPointerDown={() => setResizingPanel("timeline")}
            title="Drag to resize timeline height"
            className={`h-1.5 cursor-row-resize transition shrink-0 ${
              resizingPanel === "timeline" ? "bg-indigo-500" : "bg-transparent hover:bg-indigo-500/50"
            }`}
          />

          {/* Bottom Docked Multi-Track Timeline Drawer (Resizable + Shift+Wheel Zoom) */}
          <div
            style={{ height: timelineHeight }}
            onWheel={(e) => {
              if (e.shiftKey) {
                e.preventDefault();
                // On macOS, Shift+Wheel translates vertical scroll into deltaX
                const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
                if (delta !== 0) {
                  const step = delta < 0 ? 0.25 : -0.25;
                  const scrollEl = timelineScrollRef.current;
                  const anchor = scrollEl
                    ? computeZoomAnchor(
                        scrollEl.scrollLeft,
                        scrollEl.clientWidth,
                        scrollEl.scrollWidth,
                        e.clientX - scrollEl.getBoundingClientRect().left
                      )
                    : null;
                  setTimelineZoom((z) => {
                    const next = Math.max(1.0, Math.min(8.0, Number((z + step).toFixed(2))));
                    pendingZoomAnchorRef.current = next !== z ? anchor : null;
                    return next;
                  });
                }
              }
            }}
            className="border-t border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-2.5 shrink-0 overflow-y-auto"
          >
            {/* Header / Info bar + Audio Track Adder + Unified Timeline Zoom */}
            <div className="flex items-center justify-between text-xs text-slate-400 px-1 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-200">
                  {timeline ? timeline.project_title : "Manual / AI Timeline"}
                </span>
                {beats && (
                  <>
                    <span className="font-mono text-indigo-300">
                      {beats.tempo_bpm.toFixed(1)} BPM
                    </span>
                    <span className="font-mono text-slate-500">
                      {beats.time_signature}
                    </span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => extraAudioInputRef.current?.click()}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-medium text-indigo-300 border border-slate-700 transition"
                  title="Add another audio track (A2, A3...) to compare music versions"
                >
                  <Plus className="w-3 h-3" />
                  Audio Track
                </button>
                <input
                  type="file"
                  ref={extraAudioInputRef}
                  accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleSelectAudio(e.target.files[0].name, e.target.files[0], true);
                      e.target.value = "";
                    }
                  }}
                />
              </div>

              <div className="flex items-center gap-4">
                {/* Unified Overall Timeline Zoom (Audio + Video Together) */}
                <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setTimelineZoom((z) => Math.max(1.0, Number((z - 0.5).toFixed(2))))}
                    disabled={timelineZoom <= 1.0}
                    className="p-0.5 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-slate-200 transition"
                    title="Zoom Out Overall Timeline"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono w-11 text-center text-slate-300">
                    {Math.round(timelineZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setTimelineZoom((z) => Math.min(8.0, Number((z + 0.5).toFixed(2))))}
                    disabled={timelineZoom >= 8.0}
                    className="p-0.5 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-slate-200 transition"
                    title="Zoom In Overall Timeline"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Unified Horizontally Scrollable Timeline Viewport (Multi-Track Audio + Multi-Track Video Zoom Together) */}
            <div ref={timelineScrollRef} className="flex-1 overflow-x-auto overflow-y-visible pr-1">
              <div
                style={{ width: `${timelineZoom * 100}%`, minWidth: "100%" }}
                className="flex flex-col gap-2"
              >
                {/* Multi-Track Audio Waveforms (A1, A2...) */}
                {audioTracks.length > 0 ? (
                  audioTracks.map((aTrack, aIdx) => {
                    const isActiveAudio = aTrack.id === activeAudioTrackId;
                    return (
                      <div key={aTrack.id} className="relative">
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveAudioTrackId(aTrack.id);
                              setAudioFile(aTrack.audioFile);
                              if (aTrack.beats) setBeats(aTrack.beats);
                            }}
                            className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border transition ${
                              isActiveAudio
                                ? "bg-indigo-600 text-white border-indigo-400"
                                : "bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200"
                            }`}
                            title="Set as active soundtrack for beat markers & AI Director"
                          >
                            A{aIdx + 1}
                          </button>
                          <span className="text-[10px] font-mono text-slate-400 truncate max-w-[200px]">
                            {aTrack.name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setAudioTracks((prev) =>
                                prev.map((t) =>
                                  t.id === aTrack.id ? { ...t, muted: !t.muted } : t
                                )
                              )
                            }
                            className="p-0.5 rounded hover:bg-slate-800 text-slate-400"
                            title={aTrack.muted ? "Unmute Track" : "Mute Track"}
                          >
                            {aTrack.muted ? (
                              <VolumeX className="w-3 h-3 text-rose-400" />
                            ) : (
                              <Volume2 className="w-3 h-3 text-indigo-400" />
                            )}
                          </button>
                        </div>
                        <WaveformVisualizer
                          beatsData={aTrack.beats}
                          currentTime={currentTime}
                          duration={duration}
                          zoomLevel={timelineZoom}
                          onSeek={handleSeek}
                          className={aTrack.muted ? "opacity-40" : ""}
                        />
                      </div>
                    );
                  })
                ) : (
                  <WaveformVisualizer
                    beatsData={beats}
                    currentTime={currentTime}
                    duration={duration}
                    zoomLevel={timelineZoom}
                    onSeek={handleSeek}
                  />
                )}

                {/* Multi-Track Video Cuts Editor (V1, V2...) */}
                <TimelineTrack
                  timeline={timeline}
                  currentTime={currentTime}
                  duration={duration}
                  zoomLevel={timelineZoom}
                  beats={beats}
                  sourceDurations={sourceDurations}
                  videoTrackCount={videoTrackCount}
                  activeVideoTrack={activeVideoTrack}
                  onSelectVideoTrack={setActiveVideoTrack}
                  onAddVideoTrack={() => setVideoTrackCount((n) => n + 1)}
                  selectedCutIndex={selectedCutIndex}
                  onSelectCut={(idx) => {
                    setPreviewScene(null);
                    setSelectedCutIndex(idx);
                  }}
                  onRemoveCut={handleRemoveTimelineCut}
                  onUpdateCuts={handleUpdateTimelineCuts}
                  onDropScene={handleDropSceneOnTimeline}
                  onSeek={handleSeek}
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Clip Highlights Parameter Modal */}
      <ClipHighlightsModal
        isOpen={clipHighlightsTarget !== null}
        sourceFile={clipHighlightsTarget}
        initialSettings={highlightSettings}
        isProcessing={isAnalyzingScenes}
        onClose={() => setClipHighlightsTarget(null)}
        onApply={handleRegenerateVideoHighlights}
      />

      {/* Export Dialog Modal */}
      {timeline && (
        <ExportModal
          isOpen={isExportOpen}
          timeline={timeline}
          initialFormat={exportFormat}
          onClose={() => setIsExportOpen(false)}
        />
      )}
    </div>
  );
}
