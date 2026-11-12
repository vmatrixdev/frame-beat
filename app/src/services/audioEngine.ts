/**
 * Web Audio Engine for AMV Maker
 * Provides millisecond-accurate audio playback and rhythmic synthesis
 * for demo fixtures and imported soundtrack files.
 */

import type { BeatsData } from "../types/schemas";

class AudioEngine {
  private ctx: AudioContext | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private audioSourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;

  // Synthesis state
  private isSynthesizing = false;
  private currentBeats: BeatsData | null = null;
  private synthInterval: number | null = null;
  private startTime = 0;
  private pauseOffset = 0;
  private playbackRate = 1.0;
  private volume = 0.8;
  private isMuted = false;

  private initContext() {
    if (!this.ctx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
        this.gainNode.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
    if (this.audioElement) {
      this.audioElement.volume = this.isMuted ? 0 : this.volume;
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.setVolume(this.volume);
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public getVolume(): number {
    return this.volume;
  }

  public async loadAudioSource(url: string): Promise<number> {
    this.initContext();
    this.stop();

    if (!this.audioElement) {
      this.audioElement = new Audio();
      if (this.ctx && this.gainNode) {
        try {
          this.audioSourceNode = this.ctx.createMediaElementSource(this.audioElement);
          this.audioSourceNode.connect(this.gainNode);
        } catch {
          // Fallback to standard audio element output if media source fails
        }
      }
    }
    this.audioElement.src = url;
    this.audioElement.playbackRate = this.playbackRate;
    this.isSynthesizing = false;

    return new Promise<number>((resolve) => {
      const el = this.audioElement;
      if (!el) return resolve(16.0);

      const checkDuration = () => {
        if (el.duration && isFinite(el.duration) && el.duration > 0) {
          resolve(el.duration);
        } else {
          resolve(16.0);
        }
      };

      if (el.readyState >= 1 && el.duration && isFinite(el.duration)) {
        checkDuration();
      } else {
        el.onloadedmetadata = checkDuration;
        setTimeout(() => {
          checkDuration();
        }, 1000);
      }
    });
  }

  public setSyntheticBeats(beats: BeatsData) {
    this.currentBeats = beats;
    this.isSynthesizing = true;
  }

  public play(offsetSec = 0, rate = 1.0) {
    this.initContext();
    this.playbackRate = rate;
    this.pauseOffset = offsetSec;

    if (this.audioElement && this.audioElement.src && !this.isSynthesizing) {
      this.audioElement.currentTime = offsetSec;
      this.audioElement.playbackRate = rate;
      this.audioElement.play().catch(() => {
        // Fallback to synthesizer if audio element playback fails (e.g. invalid URL)
        this.startBeatSynthesis(offsetSec);
      });
    } else {
      this.startBeatSynthesis(offsetSec);
    }
  }

  public pause() {
    if (this.audioElement && !this.isSynthesizing) {
      this.audioElement.pause();
    }
    this.stopSynthesis();
  }

  public stop() {
    this.pause();
    this.pauseOffset = 0;
  }

  public seek(timeSec: number) {
    this.pauseOffset = timeSec;
    if (this.audioElement && !this.isSynthesizing) {
      this.audioElement.currentTime = timeSec;
    }
  }

  public getPauseOffset(): number {
    return this.pauseOffset;
  }

  /**
   * Generates rhythmic electronic music matching the detected beats.
   * Synthesizes 808 kick, snare, hi-hats, and an energetic synth lead.
   */
  private startBeatSynthesis(startOffsetSec: number) {
    if (!this.ctx || !this.gainNode) return;
    this.stopSynthesis();

    this.startTime = this.ctx.currentTime - startOffsetSec / this.playbackRate;
    const bpm = this.currentBeats?.tempo_bpm || 120;
    const beatInterval = 60 / bpm; // e.g. 0.5s for 120 BPM
    let lastScheduledBeat = Math.floor(startOffsetSec / beatInterval);

    // Lookahead scheduler loop running every 25ms
    this.synthInterval = window.setInterval(() => {
      if (!this.ctx || !this.gainNode) return;

      const currentSec = (this.ctx.currentTime - this.startTime) * this.playbackRate;
      const targetBeat = Math.floor(currentSec / beatInterval);

      while (lastScheduledBeat <= targetBeat + 4) {
        const beatTime = lastScheduledBeat * beatInterval;
        const audioTime = this.startTime + beatTime / this.playbackRate;

        if (audioTime >= this.ctx.currentTime - 0.05) {
          const beatInBar = lastScheduledBeat % 4; // 0 = downbeat, 1 = off, 2 = snare, 3 = off
          this.scheduleDrumHit(audioTime, beatInBar, lastScheduledBeat);
        }
        lastScheduledBeat++;
      }
    }, 25);
  }

  private stopSynthesis() {
    if (this.synthInterval !== null) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
  }

  /**
   * Synthesizes a kick, snare, and arpeggiated synth chord for each beat tick
   */
  private scheduleDrumHit(time: number, beatInBar: number, totalBeatIndex: number) {
    if (!this.ctx || !this.gainNode) return;

    // 1. Kick Drum on downbeats (beat 0) and driving offbeat (beat 2)
    if (beatInBar === 0 || beatInBar === 2) {
      const kickOsc = this.ctx.createOscillator();
      const kickGain = this.ctx.createGain();

      kickOsc.type = "sine";
      const startFreq = beatInBar === 0 ? 160 : 120;
      kickOsc.frequency.setValueAtTime(startFreq, time);
      kickOsc.frequency.exponentialRampToValueAtTime(38, time + 0.12);

      const kickVol = beatInBar === 0 ? 0.75 : 0.55;
      kickGain.gain.setValueAtTime(kickVol, time);
      kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

      kickOsc.connect(kickGain);
      kickGain.connect(this.gainNode);

      kickOsc.start(time);
      kickOsc.stop(time + 0.25);
    }

    // 2. Snare / Clap on beats 1 and 3
    if (beatInBar === 1 || beatInBar === 3) {
      const snareGain = this.ctx.createGain();
      snareGain.gain.setValueAtTime(0.35, time);
      snareGain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

      // Noise buffer for snare crack
      const bufferSize = this.ctx.sampleRate * 0.18;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(1000, time);

      whiteNoise.connect(filter);
      filter.connect(snareGain);
      snareGain.connect(this.gainNode);

      whiteNoise.start(time);
      whiteNoise.stop(time + 0.2);
    }

    // 3. Crisp Hi-Hat every beat
    const hatGain = this.ctx.createGain();
    hatGain.gain.setValueAtTime(0.2, time);
    hatGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    const hatBufferSize = this.ctx.sampleRate * 0.05;
    const hatBuffer = this.ctx.createBuffer(1, hatBufferSize, this.ctx.sampleRate);
    const hatOutput = hatBuffer.getChannelData(0);
    for (let i = 0; i < hatBufferSize; i++) {
      hatOutput[i] = Math.random() * 2 - 1;
    }

    const hatSource = this.ctx.createBufferSource();
    hatSource.buffer = hatBuffer;

    const hatFilter = this.ctx.createBiquadFilter();
    hatFilter.type = "highpass";
    hatFilter.frequency.setValueAtTime(7000, time);

    hatSource.connect(hatFilter);
    hatFilter.connect(hatGain);
    hatGain.connect(this.gainNode);

    hatSource.start(time);
    hatSource.stop(time + 0.06);

    // 4. Melodic Synth Bass / Arpeggio (C Minor Scale: C2=65.41Hz, Eb2=77.78Hz, G2=98Hz, Bb2=116.54Hz)
    const scale = [65.41, 77.78, 98.0, 116.54, 130.81];
    const noteFreq = scale[totalBeatIndex % scale.length];

    const synthOsc = this.ctx.createOscillator();
    const synthGain = this.ctx.createGain();
    const synthFilter = this.ctx.createBiquadFilter();

    synthOsc.type = "sawtooth";
    synthOsc.frequency.setValueAtTime(noteFreq, time);

    synthFilter.type = "lowpass";
    // Increase filter cutoff during chorus/high energy beats
    const isChorus = totalBeatIndex >= 24;
    synthFilter.frequency.setValueAtTime(isChorus ? 2200 : 900, time);
    synthFilter.frequency.exponentialRampToValueAtTime(300, time + 0.2);

    synthGain.gain.setValueAtTime(0.28, time);
    synthGain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    synthOsc.connect(synthFilter);
    synthFilter.connect(synthGain);
    synthGain.connect(this.gainNode);

    synthOsc.start(time);
    synthOsc.stop(time + 0.4);
  }
}

export const audioEngine = new AudioEngine();
