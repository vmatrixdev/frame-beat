import React, { useMemo, useState } from "react";
import type { BeatsData, SceneCut, ScenesCatalog } from "../types/schemas";
import {
  ChevronDown,
  ChevronRight,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Play,
  Smile,
  Video,
} from "lucide-react";

export interface MediaLibraryTreeProps {
  audioFile: string | null;
  beats: BeatsData | null;
  catalog: ScenesCatalog | null;
  activeScene: SceneCut | null;
  onSelectScene: (scene: SceneCut) => void;
  onSelectAudioTrack?: () => void;
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
}) => {
  const [audioExpanded, setAudioExpanded] = useState(true);
  const [videosExpanded, setVideosExpanded] = useState(true);
  const [photosExpanded, setPhotosExpanded] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

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

                  return (
                    <div key={group.sourceFile}>
                      <div
                        onClick={() => handleSelectRawVideo(group)}
                        className={`flex items-center gap-1 px-1.5 py-1 rounded-md cursor-pointer transition text-[11px] ${
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
                        <Film className="w-3 h-3 text-purple-400 shrink-0" />
                        <span className="truncate font-mono flex-1">{group.filename}</span>
                        {group.hasFaces && <Smile className="w-3 h-3 text-rose-400 shrink-0" />}
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {group.cuts.length}c
                        </span>
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
                                onClick={() => onSelectScene(cut)}
                                className={`w-full flex items-center justify-between gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono transition ${
                                  isCutActive
                                    ? "bg-indigo-600/30 text-indigo-200"
                                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                                }`}
                              >
                                <span className="flex items-center gap-1 truncate">
                                  <Play className="w-2.5 h-2.5 text-purple-400 shrink-0" />
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
                  return (
                    <button
                      key={`${photo.scene_id}-${photo.source_file}`}
                      type="button"
                      onClick={() => onSelectScene(photo)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-[11px] transition ${
                        isActive
                          ? "bg-emerald-950/60 text-emerald-200 border border-emerald-500/40"
                          : "text-slate-300 hover:bg-slate-900"
                      }`}
                    >
                      <ImageIcon className="w-3 h-3 text-emerald-400 shrink-0" />
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
    </div>
  );
};
