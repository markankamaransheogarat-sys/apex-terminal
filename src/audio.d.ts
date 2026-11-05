/**
 * Apex Terminal - Zero-Dependency Web Audio API Procedural Sound Engine
 * TypeScript Definitions
 */

export interface ApexSoundEngineOptions {
  context?: AudioContext | any;
  storage?: Storage | any;
  defaultVolume?: number;
}

export interface SoundEngineState {
  muted: boolean;
  masterVolume: number;
  isInitialized: boolean;
  state: string;
}

export type TickerDirection =
  | "up"
  | "down"
  | "green"
  | "red"
  | "buy"
  | "sell"
  | "+1"
  | "-1"
  | "+"
  | "-"
  | number
  | boolean;

export type VolatilityLevel =
  | number
  | "low"
  | "medium"
  | "high"
  | "crit"
  | "critical"
  | "warning"
  | "caution"
  | "crash"
  | "flash";

export class ApexSoundEngine {
  constructor(options?: ApexSoundEngineOptions);

  getContext(): AudioContext | null;
  setContext(context: AudioContext | any): void;
  initNodes(): void;
  getOrCreateNoiseBuffer(): AudioBuffer | null;

  playTerminalKey(char?: string): void;
  playTickerTick(direction: TickerDirection): void;
  playCommandGo(): void;
  playVolatilityAlert(level?: VolatilityLevel): void;

  toggleMute(): boolean;
  isMuted(): boolean;
  setMuted(shouldMute: boolean): boolean;

  setMasterVolume(vol: number): number;
  getMasterVolume(): number;
  getState(): SoundEngineState;
  close(): Promise<void>;
}

export declare const soundEngine: ApexSoundEngine;

export declare function playTerminalKey(char?: string): void;
export declare function playTickerTick(direction: TickerDirection): void;
export declare function playCommandGo(): void;
export declare function playVolatilityAlert(level?: VolatilityLevel): void;
export declare function toggleMute(): boolean;
export declare function isMuted(): boolean;
export declare function setMuted(muted: boolean): boolean;
export declare function setMasterVolume(vol: number): number;
export declare function getMasterVolume(): number;
export declare function getAudioContext(): AudioContext | null;

export default soundEngine;
