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
  Tag,
  Save,
} from "lucide-react";
import type {
  AudioCueNote,
  AudioTrackItem,
  BeatsData,
  ProjectData,
  ProjectSummary,
  ScenesCatalog,
  SegmentShortlist,
  Timeline,
  TimelineCut,
  SceneCut,
} from "./types/schemas";
import {
  buildCutFromScene,
  computeZoomAnchor,
  computeZoomScrollLeft,
  mergeScenesCatalog,
  slipCut,
  splitCutAtTime,
  type ZoomAnchor,
} from "./utils/timelineEditor";
import { engineClient, isTauriEnvironment } from "./services/engineClient";
import { audioEngine } from "./services/audioEngine";
import { DropZones } from "./components/DropZones";
import { FrameBeatLogo } from "./components/FrameBeatLogo";
import { MediaLibraryTree } from "./components/MediaLibraryTree";
import { HighlightsList, type HighlightAnalysisSettings } from "./components/HighlightsList";
import { ClipHighlightsModal } from "./components/ClipHighlightsModal";
import { WaveformVisualizer } from "./components/WaveformVisualizer";
import { CuesTrack } from "./components/CuesTrack";
import { ShortlistModal } from "./components/ShortlistModal";
import { TimelineTrack } from "./components/TimelineTrack";
import { VideoPreview } from "./components/VideoPreview";
import { AnnotationPanel } from "./components/AnnotationPanel";
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
  const [analyzingFiles, setAnalyzingFiles] = useState<string[]>([]);
  const [isDirecting, setIsDirecting] = useState<boolean>(false);
  const [beats, setBeats] = useState<BeatsData | null>(null);
  const [scenes, setScenes] = useState<ScenesCatalog | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(() => {
    try {
      const saved = localStorage.getItem("amv_maker_saved_timeline");
      return saved ? (JSON.parse(saved) as Timeline) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (timeline) {
        localStorage.setItem("amv_maker_saved_timeline", JSON.stringify(timeline));
      } else {
        localStorage.removeItem("amv_maker_saved_timeline");
      }
    } catch {
      // Ignore storage quota errors
    }
  }, [timeline]);

  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [savedAnnotations, setSavedAnnotations] = useState<{
    audioNotes: AudioCueNote[];
    sceneAnnotations: Record<string, { user_tags: string[]; user_note: string }>;
  }>(() => {
    try {
      const raw = localStorage.getItem("amv_maker_saved_annotations");
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          audioNotes: Array.isArray(parsed.audioNotes) ? parsed.audioNotes : [],
          sceneAnnotations:
            parsed.sceneAnnotations && typeof parsed.sceneAnnotations === "object"
              ? parsed.sceneAnnotations
              : {},
        };
      }
    } catch {
      // Ignore parse errors
    }
    return { audioNotes: [], sceneAnnotations: {} };
  });

  useEffect(() => {
    try {
      localStorage.setItem("amv_maker_saved_annotations", JSON.stringify(savedAnnotations));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedAnnotations]);

  // Restore persisted audio cue notes whenever beats are loaded without audio_notes
  useEffect(() => {
    if (beats && (!beats.audio_notes || beats.audio_notes.length === 0) && savedAnnotations.audioNotes.length > 0) {
      setBeats((prev) => (prev ? { ...prev, audio_notes: savedAnnotations.audioNotes } : prev));
    }
  }, [beats, savedAnnotations.audioNotes]);

  const [previewScene, setPreviewScene] = useState<SceneCut | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"library" | "highlights">("library");
  const [highlightSettings, setHighlightSettings] = useState<HighlightAnalysisSettings>({
    detectorThreshold: 27,
    maxSceneDuration: 5.5,
    targetWindowDuration: 3.5,
    minWindowDuration: 2.0,
  });
  const [clipHighlightsTarget, setClipHighlightsTarget] = useState<string | null>(null);
  const [shortlistResult, setShortlistResult] = useState<SegmentShortlist | null>(null);
  const [isShortlisting, setIsShortlisting] = useState<boolean>(false);
  const [shortlistCueId, setShortlistCueId] = useState<string | null>(null);
  const [isIndexingSemantics, setIsIndexingSemantics] = useState<boolean>(false);

  // On-disk Project Persistence
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState<string>("Default Project");
  const [isSavingProject, setIsSavingProject] = useState<boolean>(false);
  const [showNewProjectInput, setShowNewProjectInput] = useState<boolean>(false);
  const [newProjectName, setNewProjectName] = useState<string>("");
  const skipNextAutoSaveRef = useRef<boolean>(true);

  const applyLoadedProject = useCallback((proj: ProjectData) => {
    skipNextAutoSaveRef.current = true;
    engineClient.setActiveProjectId(proj.id);
    setActiveProjectId(proj.id);
    setActiveProjectName(proj.name);
    try {
      localStorage.setItem("amv_maker_active_project_id", proj.id);
    } catch {
      // ignore storage errors
    }
    setBeats(proj.beats ?? null);
    setScenes(proj.scenes ?? null);
    setTimeline(proj.timeline ?? null);
    if (proj.user_prompt !== undefined) {
      setPrompt(proj.user_prompt);
    }
    if (proj.audio_file) {
      setAudioFile(proj.audio_file);
    } else if (proj.timeline?.target_audio) {
      setAudioFile(proj.timeline.target_audio);
    } else {
      setAudioFile(null);
    }
    setPreviewScene(null);
    setSelectedCutIndex(null);
  }, []);

  const refreshProjectList = useCallback(async () => {
    const list = await engineClient.listProjects();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await engineClient.listProjects();
      if (cancelled) return;
      setProjects(list);
      let savedId: string | null = null;
      try {
        savedId = localStorage.getItem("amv_maker_active_project_id");
      } catch {
        // ignore
      }
      const targetId =
        (savedId && list.some((p) => p.id === savedId) ? savedId : null) ||
        (list.length > 0 ? list[0].id : null);

      if (targetId) {
        const loaded = await engineClient.loadProject(targetId);
        if (!cancelled && loaded) {
          applyLoadedProject(loaded);
        }
      } else {
        const created = await engineClient.createProject("Default Project");
        if (!cancelled && created) {
          applyLoadedProject(created);
          await refreshProjectList();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyLoadedProject, refreshProjectList]);

  const handleSaveProjectNow = useCallback(async () => {
    if (!activeProjectId) return;
    setIsSavingProject(true);
    try {
      await engineClient.saveProject({
        id: activeProjectId,
        name: activeProjectName,
        audio_file: audioFile,
        user_prompt: prompt,
        audio_notes: beats?.audio_notes || [],
        beats,
        scenes,
        timeline,
      });
      await refreshProjectList();
    } finally {
      setIsSavingProject(false);
    }
  }, [activeProjectId, activeProjectName, audioFile, prompt, beats, scenes, timeline, refreshProjectList]);

  // Debounced auto-save to projects/<id>/ whenever project state changes
  useEffect(() => {
    if (!activeProjectId) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void handleSaveProjectNow();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, beats, scenes, timeline, prompt, audioFile, handleSaveProjectNow]);

  const handleSelectProject = async (id: string) => {
    if (!id || id === activeProjectId) return;
    await handleSaveProjectNow();
    const loaded = await engineClient.loadProject(id);
    if (loaded) {
      applyLoadedProject(loaded);
    }
  };

  const handleCreateNewProject = async () => {
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    await handleSaveProjectNow();
    const created = await engineClient.createProject(trimmed);
    if (created) {
      applyLoadedProject(created);
      await refreshProjectList();
      setNewProjectName("");
      setShowNewProjectInput(false);
    }
  };

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

  // Handle Video Selection & Scene Detection (merges into existing library & streams progress)
  const handleSelectVideoDir = async (dir: string, files?: File[]) => {
    setVideoDir(dir);
    setIsAnalyzingScenes(true);
    try {
      const scenesResult = await engineClient.analyzeScenes(
        dir,
        undefined,
        files,
        highlightSettings,
        (partialCatalog, pendingFiles) => {
          setScenes((prev) => mergeScenesCatalog(prev, partialCatalog));
          setAnalyzingFiles(pendingFiles);
        }
      );
      setScenes((prev) => mergeScenesCatalog(prev, scenesResult));
      if (scenesResult.scenes.length > 0) {
        setPreviewScene((prev) => prev ?? scenesResult.scenes[0]);
      }
    } catch (err) {
      console.error("Scene analysis failed:", err);
    } finally {
      setIsAnalyzingScenes(false);
      setAnalyzingFiles([]);
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

  // Manual Tags & Notes on SceneCut / TimelineCut / BeatsData
  const handleUpdateSceneAnnotation = (
    targetScene: SceneCut,
    updates: { user_tags: string[]; user_note: string }
  ) => {
    setScenes((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.scene_id === targetScene.scene_id && s.source_file === targetScene.source_file
            ? { ...s, user_tags: updates.user_tags, user_note: updates.user_note }
            : s
        ),
      };
    });
    setPreviewScene((prev) =>
      prev && prev.scene_id === targetScene.scene_id && prev.source_file === targetScene.source_file
        ? { ...prev, user_tags: updates.user_tags, user_note: updates.user_note }
        : prev
    );
    const key = `${targetScene.source_file}::${targetScene.scene_id}`;
    setSavedAnnotations((prev) => ({
      ...prev,
      sceneAnnotations: {
        ...prev.sceneAnnotations,
        [key]: updates,
      },
    }));
  };

  const handleUpdateCutAnnotation = (
    cutIndex: number,
    updates: { user_tags: string[]; user_note: string }
  ) => {
    setTimeline((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cuts: prev.cuts.map((c, idx) =>
          idx === cutIndex
            ? { ...c, user_tags: updates.user_tags, user_note: updates.user_note }
            : c
        ),
      };
    });
  };

  const updateAudioNotes = (updater: (notes: AudioCueNote[]) => AudioCueNote[]) => {
    const currentNotes = beats?.audio_notes ?? savedAnnotations.audioNotes;
    const nextNotes = updater(currentNotes);
    setSavedAnnotations((sa) => ({ ...sa, audioNotes: nextNotes }));
    setBeats((prev) => (prev ? { ...prev, audio_notes: nextNotes } : prev));
    setAudioTracks((tracks) =>
      tracks.map((t) =>
        t.id === activeAudioTrackId && t.beats
          ? { ...t, beats: { ...t.beats, audio_notes: nextNotes } }
          : t
      )
    );
  };

  const handleAddAudioNote = (note: AudioCueNote) => {
    updateAudioNotes((notes) => [...notes, note]);
  };

  const handleDeleteAudioNote = (id: string) => {
    updateAudioNotes((notes) => notes.filter((n) => n.id !== id));
  };

  const handlePatchAudioNote = (cueId: string, patch: Partial<AudioCueNote>) => {
    updateAudioNotes((notes) =>
      notes.map((n) => (n.id === cueId ? { ...n, ...patch } : n))
    );
  };

  const handleShortlistSegment = async (
    startMs: number,
    endMs: number,
    cue?: AudioCueNote
  ) => {
    if (!beats || !scenes) return;
    setShortlistCueId(cue?.id || null);
    setShortlistResult(null);
    setIsShortlisting(true);
    try {
      const res = await engineClient.shortlistClips(beats, scenes, startMs, endMs, cue, 8);
      setShortlistResult(res);
    } finally {
      setIsShortlisting(false);
    }
  };

  const handleTogglePinScene = (sceneId: number) => {
    if (!shortlistCueId) return;
    updateAudioNotes((notes) =>
      notes.map((n) => {
        if (n.id !== shortlistCueId) return n;
        const existing = n.pinned_scene_ids || [];
        const nextPinned = existing.includes(sceneId)
          ? existing.filter((id) => id !== sceneId)
          : [...existing, sceneId];
        return { ...n, pinned_scene_ids: nextPinned };
      })
    );
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
        if (e.altKey && timeline && selectedCutIndex !== null && timeline.cuts[selectedCutIndex]) {
          const target = timeline.cuts[selectedCutIndex];
          const step = e.shiftKey ? -0.1 : -0.033;
          handleUpdateTimelineCuts(
            slipCut(timeline.cuts, selectedCutIndex, step, {
              maxSourceDuration: sourceDurations[target.source_file],
            })
          );
        } else {
          handleSeek(Math.max(0, currentTime - (e.shiftKey ? 5.0 : 0.5)));
        }
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.altKey && timeline && selectedCutIndex !== null && timeline.cuts[selectedCutIndex]) {
          const target = timeline.cuts[selectedCutIndex];
          const step = e.shiftKey ? 0.1 : 0.033;
          handleUpdateTimelineCuts(
            slipCut(timeline.cuts, selectedCutIndex, step, {
              maxSourceDuration: sourceDurations[target.source_file],
            })
          );
        } else {
          handleSeek(Math.min(duration, currentTime + (e.shiftKey ? 5.0 : 0.5)));
        }
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
  }, [currentTime, duration, playbackRate, isPlaying, timeline, selectedCutIndex, sourceDurations]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Top Application Bar */}
      <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/80 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <FrameBeatLogo className="w-8 h-8" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-tight text-slate-100">FrameBeat</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                v0.1.0 • Phase 1
              </span>
            </div>
          </div>
        </div>

        {/* Project Switcher & Runtime Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-800">
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            {showNewProjectInput ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateNewProject();
                    if (e.key === "Escape") setShowNewProjectInput(false);
                  }}
                  placeholder="Project name..."
                  autoFocus
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200 w-32 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateNewProject()}
                  className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewProjectInput(false)}
                  className="px-1 text-slate-400 hover:text-slate-200 text-[10px]"
                >
                  ×
                </button>
              </div>
            ) : (
              <>
                <select
                  aria-label="Active project"
                  value={activeProjectId || ""}
                  onChange={(e) => void handleSelectProject(e.target.value)}
                  className="bg-transparent text-slate-200 font-medium focus:outline-none max-w-[160px] truncate cursor-pointer"
                >
                  {projects.length === 0 && (
                    <option value={activeProjectId || ""}>{activeProjectName}</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                      {p.name} ({p.scene_count})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewProjectInput(true)}
                  title="Create new project on disk"
                  className="p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveProjectNow()}
                  disabled={!activeProjectId || isSavingProject}
                  title="Save project to disk now"
                  className="p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 disabled:opacity-40"
                >
                  {isSavingProject ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                </button>
              </>
            )}
          </div>

          <div className="hidden xl:flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-full bg-slate-950/70 border border-slate-800">
            <div
              className={`w-2 h-2 rounded-full ${
                isNativeTauri ? "bg-emerald-400 animate-pulse" : "bg-sky-400"
              }`}
            />
            <span className="text-slate-300">
              {isNativeTauri ? "Tauri v2" : "Dev Server"}
            </span>
          </div>
        </div>

        {/* Export Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowAnnotations((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              showAnnotations
                ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/50"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
            }`}
            title="Toggle Director Annotations & Audio Cues Panel"
          >
            <Tag className="w-3.5 h-3.5" />
            Tags & Cues
          </button>
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
                analyzingFiles={analyzingFiles}
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
                isIndexingSemantics={isIndexingSemantics}
                onIndexSemantics={async () => {
                  if (!scenes || isIndexingSemantics) return;
                  setIsIndexingSemantics(true);
                  try {
                    const updated = await engineClient.indexSemantics(scenes);
                    setScenes(updated);
                  } finally {
                    setIsIndexingSemantics(false);
                  }
                }}
                onSearchClips={async (query) => {
                  if (!scenes) return [];
                  return engineClient.searchClips(scenes, query);
                }}
                onSemanticSearch={async (q) => {
                  if (!scenes) return [];
                  return engineClient.semanticSearch(scenes, q, 30);
                }}
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
          <div className="flex-1 p-5 min-h-0 flex items-center justify-center gap-4">
            <div className="flex-1 h-full max-w-5xl min-w-0">
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

            {showAnnotations && (
              <div className="w-80 shrink-0 h-full overflow-y-auto">
                <AnnotationPanel
                  selectedScene={previewScene}
                  selectedCut={
                    selectedCutIndex !== null && timeline?.cuts[selectedCutIndex]
                      ? timeline.cuts[selectedCutIndex]
                      : null
                  }
                  selectedCutIndex={selectedCutIndex}
                  onUpdateSceneAnnotation={handleUpdateSceneAnnotation}
                  onUpdateCutAnnotation={handleUpdateCutAnnotation}
                />
              </div>
            )}
          </div>

          {/* Horizontal Splitter Handle for Timeline Height */}
          <div
            onPointerDown={() => setResizingPanel("timeline")}
            title="Drag to resize timeline height"
            className={`h-1.5 cursor-row-resize transition shrink-0 ${
              resizingPanel === "timeline" ? "bg-indigo-500" : "bg-transparent hover:bg-indigo-500/50"
            }`}
          />

          {/* Bottom Docked Multi-Track Timeline Drawer (Resizable + Cmd/Ctrl+Wheel Zoom + Alt+Wheel Slip + Shift+Wheel Pan) */}
          <div
            style={{ height: timelineHeight }}
            onWheel={(e) => {
              if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                e.preventDefault();
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
              } else if (e.altKey && !e.metaKey && !e.ctrlKey) {
                if (timeline && selectedCutIndex !== null && timeline.cuts[selectedCutIndex]) {
                  e.preventDefault();
                  const rawDelta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
                  if (rawDelta !== 0) {
                    const target = timeline.cuts[selectedCutIndex];
                    // Scroll down (rawDelta > 0) shifts source window backwards; scroll up shifts forwards
                    const baseStep = e.shiftKey ? 0.1 : Math.abs(rawDelta) < 20 ? 0.01 : 0.033;
                    const deltaSec = rawDelta > 0 ? -baseStep : baseStep;
                    handleUpdateTimelineCuts(
                      slipCut(timeline.cuts, selectedCutIndex, deltaSec, {
                        maxSourceDuration: sourceDurations[target.source_file],
                      })
                    );
                  }
                }
              } else if (e.shiftKey && timelineScrollRef.current) {
                // Ensure Shift+Wheel scrolls horizontally across all platforms
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaY !== 0) {
                  e.preventDefault();
                  timelineScrollRef.current.scrollLeft += e.deltaY;
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
                {/* Dedicated Cues & Segment Notes Lane */}
                <CuesTrack
                  beatsData={beats}
                  audioNotes={beats?.audio_notes ?? savedAnnotations.audioNotes}
                  duration={duration}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  onAddCue={handleAddAudioNote}
                  onUpdateCue={handlePatchAudioNote}
                  onDeleteCue={handleDeleteAudioNote}
                  onShortlistSegment={handleShortlistSegment}
                />

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

      {/* AI Segment Clip Shortlist Modal */}
      <ShortlistModal
        shortlist={shortlistResult}
        isLoading={isShortlisting}
        catalog={scenes}
        pinnedSceneIds={
          beats?.audio_notes?.find((n) => n.id === shortlistCueId)?.pinned_scene_ids || []
        }
        onClose={() => {
          setShortlistResult(null);
          setShortlistCueId(null);
        }}
        onPreviewScene={(scene) => {
          setSelectedCutIndex(null);
          setPreviewScene(scene);
        }}
        onAddSceneToTimeline={(scene, atTimeSec) => {
          handleDropSceneOnTimeline(scene, atTimeSec, activeVideoTrack);
          setShortlistResult(null);
          setShortlistCueId(null);
        }}
        onTogglePinScene={shortlistCueId ? handleTogglePinScene : undefined}
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
