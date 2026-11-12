import React, { useState } from "react";
import type { Timeline, RenderProgress, RenderResult, ExportResult } from "../types/schemas";
import { engineClient } from "../services/engineClient";
import {
  X,
  Download,
  Film,
  Layers,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cpu,
} from "lucide-react";

export type ExportFormat = "mp4" | "otio" | "fcpxml";

export interface ExportModalProps {
  isOpen: boolean;
  timeline: Timeline;
  initialFormat?: ExportFormat;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  timeline,
  initialFormat = "mp4",
  onClose,
}) => {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [resolution, setResolution] = useState<string>("1920x1080");
  const [fps, setFps] = useState<number>(24);
  const [hwaccel, setHwaccel] = useState<boolean>(true);
  const [preset, setPreset] = useState<string>("fast");
  const [outputPath, setOutputPath] = useState<string>("export/amv_final.mp4");

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [result, setResult] = useState<RenderResult | ExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFormatChange = (newFormat: ExportFormat) => {
    setFormat(newFormat);
    if (newFormat === "mp4") {
      setOutputPath("export/amv_final.mp4");
    } else if (newFormat === "otio") {
      setOutputPath("export/amv_project.otio");
    } else if (newFormat === "fcpxml") {
      setOutputPath("export/amv_project.fcpxml");
    }
  };

  const handleStartExport = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    setResult(null);
    setProgress(null);

    try {
      if (format === "mp4") {
        const res = await engineClient.renderTimeline(
          timeline,
          outputPath,
          {
            resolution,
            fps,
            hwaccel,
            preset,
          },
          (prog) => setProgress(prog)
        );
        setResult(res);
      } else {
        const res = await engineClient.exportProject(
          timeline,
          outputPath,
          format
        );
        setResult(res);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      data-testid="export-modal"
    >
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">Export AMV Project</h2>
              <p className="text-xs text-slate-400">
                {timeline.cuts.length} cuts • {timeline.project_title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Format Tabs */}
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Export Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleFormatChange("mp4")}
                className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                  format === "mp4"
                    ? "border-emerald-500 bg-emerald-950/20 text-slate-100"
                    : "border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-400"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold">MP4 Video</span>
                </div>
                <span className="text-[11px] text-slate-400">FFmpeg filter complex</span>
              </button>

              <button
                type="button"
                onClick={() => handleFormatChange("otio")}
                className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                  format === "otio"
                    ? "border-indigo-500 bg-indigo-950/20 text-slate-100"
                    : "border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-400"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold">OpenTimelineIO</span>
                </div>
                <span className="text-[11px] text-slate-400">DaVinci Resolve / NLE</span>
              </button>

              <button
                type="button"
                onClick={() => handleFormatChange("fcpxml")}
                className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                  format === "fcpxml"
                    ? "border-purple-500 bg-purple-950/20 text-slate-100"
                    : "border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-400"
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold">FCPXML</span>
                </div>
                <span className="text-[11px] text-slate-400">Final Cut Pro v1.10</span>
              </button>
            </div>
          </div>

          {/* Render Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Resolution</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="1920x1080">1080p FHD (1920x1080)</option>
                <option value="2560x1440">1440p QHD (2560x1440)</option>
                <option value="3840x2160">4K UHD (3840x2160)</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Frame Rate</label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value={24}>24 FPS (Cinematic 24p Standard)</option>
                <option value={30}>30 FPS (Standard Video / Social)</option>
                <option value={60}>60 FPS (High Motion / Action)</option>
              </select>
            </div>
          </div>

          {format === "mp4" && (
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-medium text-slate-200">
                    Hardware Acceleration (VideoToolbox / NVENC)
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={hwaccel}
                  onChange={(e) => setHwaccel(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <span className="text-xs text-slate-400">Encoder Preset</span>
                <div className="flex gap-1">
                  {["ultrafast", "fast", "medium"].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPreset(p)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition ${
                        preset === p
                          ? "bg-slate-700 text-white font-semibold"
                          : "text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Output Path */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">Output Destination</label>
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              className="w-full text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Progress Feedback */}
          {progress && isExporting && (
            <div className="p-4 rounded-xl bg-slate-950 border border-indigo-900/40 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-indigo-400 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Rendering deterministic filter complex...
                </span>
                <span className="text-slate-200 font-bold">{progress.percent.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  style={{ width: `${progress.percent}%` }}
                  className="bg-indigo-500 h-full rounded-full transition-all duration-150"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                <span>
                  {progress.currentTime.toFixed(1)}s / {progress.totalTime.toFixed(1)}s
                </span>
                <span>
                  Speed: {progress.speed} • {progress.fps.toFixed(1)} FPS
                </span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {result && !isExporting && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-emerald-300">
                  Export Completed Successfully!
                </div>
                <div className="text-xs text-slate-300 font-mono mt-1 break-all">
                  {result.outputPath}
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-rose-300">Export Failed</div>
                <div className="text-xs text-rose-200 mt-1">{errorMessage}</div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
          >
            {result ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleStartExport}
            disabled={isExporting}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-40 text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition flex items-center gap-2"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Rendering...
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Start Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
