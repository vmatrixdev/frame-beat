import React, { useEffect, useState } from "react";
import { Loader2, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import type { HighlightAnalysisSettings } from "./HighlightsList";

export interface ClipHighlightsModalProps {
  isOpen: boolean;
  sourceFile: string | null;
  initialSettings: HighlightAnalysisSettings;
  isProcessing?: boolean;
  onClose: () => void;
  onApply: (sourceFile: string, settings: HighlightAnalysisSettings) => void;
}

const PRESETS: Array<{
  label: string;
  target: number;
  max: number;
  min: number;
}> = [
  { label: "0.5s Quick", target: 0.5, max: 1.5, min: 0.35 },
  { label: "1.5s Fast", target: 1.5, max: 3.0, min: 0.9 },
  { label: "3.5s Balanced", target: 3.5, max: 5.5, min: 2.0 },
  { label: "5.0s Slow", target: 5.0, max: 8.0, min: 2.5 },
];

export const ClipHighlightsModal: React.FC<ClipHighlightsModalProps> = ({
  isOpen,
  sourceFile,
  initialSettings,
  isProcessing = false,
  onClose,
  onApply,
}) => {
  const [settings, setSettings] = useState<HighlightAnalysisSettings>(initialSettings);

  useEffect(() => {
    if (isOpen) {
      setSettings(initialSettings);
    }
  }, [isOpen, sourceFile, initialSettings]);

  if (!isOpen || !sourceFile) return null;

  const fileName = sourceFile.split("/").pop() || sourceFile;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !isProcessing && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-100">Clip Highlights</h3>
              <p className="text-[11px] font-mono text-slate-400 truncate" title={sourceFile}>
                {fileName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Quick Presets */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Pacing Presets
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {PRESETS.map((preset) => {
                const isSelected =
                  Math.abs(settings.targetWindowDuration - preset.target) < 0.05;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        targetWindowDuration: preset.target,
                        maxSceneDuration: preset.max,
                        minWindowDuration: preset.min,
                      }))
                    }
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                      isSelected
                        ? "bg-indigo-600 text-white border-indigo-400 shadow-sm"
                        : "bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Numeric Parameters */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-slate-300">
              <span className="text-[11px] font-medium text-slate-400">
                Target Highlight Length (s)
              </span>
              <input
                type="number"
                min={0.3}
                max={15}
                step={0.1}
                value={settings.targetWindowDuration}
                onChange={(e) => {
                  const val = Math.max(0.3, Math.min(15, Number(e.target.value) || 0.5));
                  setSettings((prev) => ({
                    ...prev,
                    targetWindowDuration: val,
                    minWindowDuration: Math.min(prev.minWindowDuration, Number((val * 0.7).toFixed(2))),
                  }));
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
              />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span className="text-[11px] font-medium text-slate-400">
                Max Scene Before Split (s)
              </span>
              <input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={settings.maxSceneDuration}
                onChange={(e) => {
                  const val = Math.max(0.5, Math.min(30, Number(e.target.value) || 1.0));
                  setSettings((prev) => ({
                    ...prev,
                    maxSceneDuration: val,
                  }));
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
              />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span className="text-[11px] font-medium text-slate-400">
                Minimum Cut Length (s)
              </span>
              <input
                type="number"
                min={0.25}
                max={10}
                step={0.1}
                value={settings.minWindowDuration}
                onChange={(e) => {
                  const val = Math.max(0.25, Math.min(10, Number(e.target.value) || 0.35));
                  setSettings((prev) => ({
                    ...prev,
                    minWindowDuration: val,
                  }));
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
              />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              <span className="text-[11px] font-medium text-slate-400">
                Scene Cut Threshold
              </span>
              <input
                type="number"
                min={5}
                max={80}
                step={1}
                value={settings.detectorThreshold}
                onChange={(e) => {
                  const val = Math.max(5, Math.min(80, Number(e.target.value) || 27));
                  setSettings((prev) => ({
                    ...prev,
                    detectorThreshold: val,
                  }));
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
              />
            </label>
          </div>

          <p className="text-[11px] text-slate-400 bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 leading-relaxed">
            Re-runs local visual &amp; face highlight analysis on this raw video. Old highlights for this clip are replaced in the <strong className="text-slate-200">Raw Library</strong> and <strong className="text-slate-200">Highlights</strong> tab; clips already placed on the timeline stay intact.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(sourceFile, settings)}
            disabled={isProcessing}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center gap-1.5 transition"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Re-generating...
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Re-generate Highlights
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
