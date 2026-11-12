import React, { useEffect, useMemo, useState } from "react";
import type { BeatsData, SceneCut, ScenesCatalog } from "../types/schemas";
import {
  ChevronDown,
  ChevronRight,
  Film,
  FolderOpen,
  Image as ImageIcon,
  MoreVertical,
  Music,
  Play,
  Plus,
  ScanFace,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Video,
} from "lucide-react";

export interface MediaLibraryTreeProps {
  audioFile: string | null;
  beats: BeatsData | null;
  catalog: ScenesCatalog | null;
  activeScene: SceneCut | null;
  onSelectScene: (scene: SceneCut) => void;
  onSelectAudioTrack?: () => void;
  onAddToTimeline?: (scene: SceneCut) => void;
  onReanalyzeScene?: (scene: SceneCut, sampleFrames: number) => void;
  onOpenClipHighlights?: (sourceFile: string) => void;
}

interface RawVideoGroup {
  sourceFile: string;
  filename: string;
  cuts: SceneCut[];
  totalDuration: number;
  hasFaces: boolean;
}

export const MediaLibraryTree: React.FC<MediaLibraryTreeProps> = ({
  audioFile,
  beats,
  catalog,
  activeScene,
  onSelectScene,
  onSelectAudioTrack,
  onAddToTimeline,
  onReanalyzeScene,
  onOpenClipHighlights,
}) => {
  const [audioExpanded, setAudioExpanded] = useState(true);
  const [videosExpanded, setVideosExpanded] = useState(true);
  const [photosExpanded, setPhotosExpanded] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    scene: SceneCut;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const openContextMenu = (e: React.MouseEvent, scene: SceneCut) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, scene });
  };

  const { videoGroups, photoScenes } = useMemo(() => {
    const scenes = catalog?.scenes || [];
    const videosMap = new Map<string, SceneCut[]>();
    const photos: SceneCut[] = [];

    for (const s of scenes) {
      const isImg = s.is_still_image || s.media_type === "image";
      if (isImg) {
        photos.push(s);
      } else {
        const list = videosMap.get(s.source_file) || [];
        list.push(s);
        videosMap.set(s.source_file, list);
      }
    }

    const groups: RawVideoGroup[] = Array.from(videosMap.entries()).map(([sourceFile, cuts]) => {
      const sorted = [...cuts].sort((a, b) => a.start_time - b.start_time);
      const maxEnd = sorted.reduce((acc, c) => Math.max(acc, c.end_time), 0);
      return {
        sourceFile,
        filename: sourceFile.split("/").pop() || sourceFile,
        cuts: sorted,
        totalDuration: maxEnd,
        hasFaces: sorted.some((c) => Boolean(c.has_faces)),
      };
    });

    return { videoGroups: groups, photoScenes: photos };
  }, [catalog]);

  const toggleFileExpand = (sourceFile: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFiles((prev) => ({ ...prev, [sourceFile]: !prev[sourceFile] }));
  };

  const handleSelectRawVideo = (group: RawVideoGroup) => {
    const first = group.cuts[0];
    const rawScene: SceneCut = {
      scene_id: -1,
      source_file: group.sourceFile,
      start_time: 0.0,
      end_time: 0.0, // 0.0 plays full raw video duration
      duration: group.totalDuration,
      keyframe_path: first?.keyframe_path,
      sharpness_score: first?.sharpness_score,
      motion_score: first?.motion_score,
      brightness_score: first?.brightness_score,
      media_type: "video",
      is_still_image: false,
      has_faces: group.hasFaces,
      face_count: first?.face_count,
      dominant_expression: first?.dominant_expression,
      smile_score: first?.smile_score,
      subject_prominence: first?.subject_prominence,
    };
    onSelectScene(rawScene);
  };

  const totalRawAssets = videoGroups.length + photoScenes.length;

  return (
    <div
      className="rounded-xl bg-slate-950/70 border border-slate-800/90 p-2.5 text-xs select-none"
      data-testid="media-library-tree"
    >
      <div className="flex items-center justify-between px-1 pb-2 mb-1.5 border-b border-slate-800/80">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
          Media Library
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          {totalRawAssets} {totalRawAssets === 1 ? "asset" : "assets"}
        </span>
      </div>

      <div className="space-y-1 max-h-[260px] overflow-y-auto pr-0.5">
        {/* Audio Branch */}
        <div>
          <button
            type="button"
            onClick={() => setAudioExpanded((v) => !v)}
            className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-slate-900 text-slate-300 font-medium text-[11px]"
          >
            {audioExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
            <Music className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Audio Track</span>
            <span className="ml-auto text-[10px] font-mono text-slate-500">{audioFile ? "1" : "0"}</span>
          </button>

          {audioExpanded && (
            <div className="pl-5 mt-0.5">
              {audioFile ? (
                <button
                  type="button"
                  onClick={onSelectAudioTrack}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-indigo-950/40 text-left text-[11px] text-slate-300 transition"
                >
                  <span className="truncate font-mono">{audioFile.split("/").pop()}</span>
                  {beats && (
                    <span className="text-[10px] font-mono text-indigo-400 shrink-0">
                      {beats.tempo_bpm.toFixed(0)} BPM
                    </span>
                  )}
                </button>
              ) : (
                <div className="px-2 py-1 text-[11px] text-slate-600 italic">No soundtrack loaded</div>
              )}
            </div>
          )}
        </div>

        {/* Raw Videos Branch */}
        <div>
          <button
            type="button"
            onClick={() => setVideosExpanded((v) => !v)}
            className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-slate-900 text-slate-300 font-medium text-[11px]"
          >
            {videosExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
            <Video className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>Raw Videos</span>
            <span className="ml-auto text-[10px] font-mono text-slate-500">{videoGroups.length}</span>
          </button>

          {videosExpanded && (
            <div className="pl-4 mt-0.5 space-y-0.5">
              {videoGroups.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-slate-600 italic">No videos in library</div>
              ) : (
                videoGroups.map((group) => {
                  const isExpanded = Boolean(expandedFiles[group.sourceFile]);
                  const isRawActive =
                    activeScene?.scene_id === -1 && activeScene.source_file === group.sourceFile;
                  const thumbUrl = group.cuts[0]?.keyframe_path;

                  const buildRawScene = (): SceneCut => {
                    const first = group.cuts[0];
                    return {
                      scene_id: -1,
                      source_file: group.sourceFile,
                      start_time: 0.0,
                      end_time: 0.0,
                      duration: group.totalDuration,
                      keyframe_path: first?.keyframe_path,
                      sharpness_score: first?.sharpness_score,
                      motion_score: first?.motion_score,
                      brightness_score: first?.brightness_score,
                      media_type: "video",
                      is_still_image: false,
                      has_faces: group.hasFaces,
                      face_count: first?.face_count,
                      dominant_expression: first?.dominant_expression,
                      smile_score: first?.smile_score,
                      subject_prominence: first?.subject_prominence,
                    };
                  };

                  return (
                    <div key={group.sourceFile}>
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-amv-scene", JSON.stringify(buildRawScene()));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => handleSelectRawVideo(group)}
                        onContextMenu={(e) => openContextMenu(e, buildRawScene())}
                        className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-pointer transition text-[11px] group ${
                          isRawActive
                            ? "bg-purple-950/70 text-purple-200 border border-purple-500/40"
                            : "text-slate-300 hover:bg-slate-900/90"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => toggleFileExpand(group.sourceFile, e)}
                          className="p-0.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 shrink-0"
                          title="Expand analyzed cuts"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )}
                        </button>
                        <div className="w-10 h-7 rounded bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                          {thumbUrl ? (
                            <img src={thumbUrl} alt={group.filename} className="w-full h-full object-cover" />
                          ) : (
                            <Film className="w-3.5 h-3.5 text-purple-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[11px]">{group.filename}</div>
                          <div className="text-[9px] font-mono text-slate-500 flex items-center gap-1.5">
                            <span>{group.totalDuration.toFixed(1)}s</span>
                            <span>•</span>
                            <span>{group.cuts.length} {group.cuts.length === 1 ? "cut" : "cuts"}</span>
                          </div>
                        </div>
                        {group.hasFaces && <Smile className="w-3 h-3 text-rose-400 shrink-0" />}
                        <button
                          type="button"
                          onClick={(e) => openContextMenu(e, buildRawScene())}
                          title="Actions & Analyzers"
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition shrink-0"
                        >
                          <MoreVertical className="w-3 h-3" />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="pl-5 mt-0.5 space-y-0.5 border-l border-slate-800 ml-2.5">
                          {group.cuts.map((cut) => {
                            const isCutActive =
                              activeScene?.scene_id === cut.scene_id &&
                              activeScene.source_file === cut.source_file;
                            return (
                              <button
                                key={`${cut.scene_id}-${cut.start_time}`}
                                type="button"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("application/x-amv-scene", JSON.stringify(cut));
                                  e.dataTransfer.effectAllowed = "copy";
                                }}
                                onClick={() => onSelectScene(cut)}
                                onContextMenu={(e) => openContextMenu(e, cut)}
                                className={`w-full flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                                  isCutActive
                                    ? "bg-indigo-600/30 text-indigo-200"
                                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                                }`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  {cut.keyframe_path ? (
                                    <img
                                      src={cut.keyframe_path}
                                      alt={`Cut ${cut.scene_id + 1}`}
                                      className="w-7 h-5 rounded object-cover border border-slate-800 shrink-0"
                                    />
                                  ) : (
                                    <Play className="w-2.5 h-2.5 text-purple-400 shrink-0" />
                                  )}
                                  #{cut.scene_id + 1} ({cut.start_time.toFixed(1)}s–{cut.end_time.toFixed(1)}s)
                                </span>
                                <span className="text-slate-500 shrink-0">{cut.duration.toFixed(1)}s</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Raw Photos Branch */}
        <div>
          <button
            type="button"
            onClick={() => setPhotosExpanded((v) => !v)}
            className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-slate-900 text-slate-300 font-medium text-[11px]"
          >
            {photosExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
            <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Raw Photos</span>
            <span className="ml-auto text-[10px] font-mono text-slate-500">{photoScenes.length}</span>
          </button>

          {photosExpanded && (
            <div className="pl-5 mt-0.5 space-y-0.5">
              {photoScenes.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-slate-600 italic">No photos in library</div>
              ) : (
                photoScenes.map((photo) => {
                  const filename = photo.source_file.split("/").pop() || photo.source_file;
                  const isActive =
                    activeScene?.scene_id === photo.scene_id &&
                    activeScene.source_file === photo.source_file;
                  const thumbUrl =
                    photo.keyframe_path || `/api/media-stream?path=${encodeURIComponent(photo.source_file)}`;
                  return (
                    <button
                      key={`${photo.scene_id}-${photo.source_file}`}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-amv-scene", JSON.stringify(photo));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => onSelectScene(photo)}
                      onContextMenu={(e) => openContextMenu(e, photo)}
                      className={`w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left text-[11px] transition group ${
                        isActive
                          ? "bg-emerald-950/60 text-emerald-200 border border-emerald-500/40"
                          : "text-slate-300 hover:bg-slate-900"
                      }`}
                    >
                      <div className="w-9 h-7 rounded bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                        <img src={thumbUrl} alt={filename} className="w-full h-full object-cover" />
                      </div>
                      <span className="truncate font-mono flex-1">{filename}</span>
                      {photo.has_faces && (
                        <span className="text-[10px] text-rose-300 flex items-center gap-0.5 shrink-0">
                          <Smile className="w-2.5 h-2.5" />
                          {photo.smile_score !== undefined ? `${Math.round(photo.smile_score * 100)}%` : ""}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Contextual Menu for Manual Static Analysis & Timeline Setup */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1 text-xs text-slate-200"
          onClick={(e) => e.stopPropagation()}
        >
          {onAddToTimeline && (
            <button
              type="button"
              onClick={() => {
                onAddToTimeline(contextMenu.scene);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-indigo-600/30 flex items-center gap-2 transition"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Add to Timeline</span>
            </button>
          )}
          {!contextMenu.scene.is_still_image && onOpenClipHighlights && (
            <button
              type="button"
              onClick={() => {
                onOpenClipHighlights(contextMenu.scene.source_file);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-amber-600/30 flex items-center gap-2 transition"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
              <span>Clip Highlights...</span>
            </button>
          )}
          {onReanalyzeScene && (
            <>
              <button
                type="button"
                onClick={() => {
                  onReanalyzeScene(contextMenu.scene, 5);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-purple-600/30 flex items-center gap-2 transition"
              >
                <ScanFace className="w-3.5 h-3.5 text-purple-400" />
                <span>Analyze Faces (5 frames)</span>
              </button>
              {!contextMenu.scene.is_still_image && (
                <button
                  type="button"
                  onClick={() => {
                    onReanalyzeScene(contextMenu.scene, 15);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-rose-600/30 flex items-center gap-2 transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                  <span>Deep Face Scan (15 frames)</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
