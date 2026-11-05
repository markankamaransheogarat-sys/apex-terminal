/**
 * Apex Terminal - Zero-Dependency Web Audio API Procedural Sound Engine
 * Institutional Bloomberg & BlackRock Aladdin Financial Terminal Audio Architecture
 *
 * All acoustic events are synthesized mathematically via HTML5 Web Audio API:
 * - Dynamic white noise buffers with Biquad bandpass filtering
 * - Additive & FM harmonic partials for institutional chimes
 * - Micro-transient envelopes (1-2ms) for ultra-low latency price ticks
 * - Vintage CRT mechanical keypress physical modeling with bucking-spring resonance
 * - Hydroacoustic sonar & radar Doppler simulation for volatility alerts
 * - Persistent localStorage mute state with graceful headless fallback
 */

const STORAGE_KEY = "apex_terminal_audio_muted";
const VOLUME_KEY = "apex_terminal_audio_volume";

/**
 * In-memory fallback storage for headless / SSR / sandboxed environments
 */
class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

/**
 * Safely obtain localStorage or fallback to MemoryStorage
 */
function getSafeStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      // Test read/write in case of private browsing or sandbox restrictions
      const testKey = "__apex_storage_probe__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    }
  } catch {
    // Fallback if blocked
  }
  return new MemoryStorage();
}

/**
 * ApexSoundEngine - Procedural Web Audio Engine
 */
export class ApexSoundEngine {
  /**
   * @param {Object} [options]
   * @param {AudioContext|Object} [options.context] Custom or mock AudioContext
   * @param {Storage|Object} [options.storage] Custom or mock Storage
   * @param {number} [options.defaultVolume=0.7] Master volume (0.0 to 1.0)
   */
  constructor(options = {}) {
    this.options = options;
    this.storage = options.storage || getSafeStorage();
    this.ctx = options.context || null;
    this.masterGain = null;
    this.limiterNode = null;
    this.noiseBuffer = null;
    this.lastTickTime = 0;

    // Load initial mute state from storage (default: unmuted)
    let storedMute = null;
    let storedVol = null;
    try {
      storedMute = this.storage.getItem(STORAGE_KEY);
      storedVol = this.storage.getItem(VOLUME_KEY);
    } catch {
      // Storage access blocked or threw error
    }
    this.muted = storedMute === "true";

    // Load initial volume from storage (default: 0.7)
    const parsedVol =
      storedVol !== null
        ? parseFloat(storedVol)
        : (options.defaultVolume ?? 0.7);
    this.masterVolume = Number.isFinite(parsedVol)
      ? Math.max(0, Math.min(1, parsedVol))
      : 0.7;

    // Auto-bind public API methods to this instance
    this.playTerminalKey = this.playTerminalKey.bind(this);
    this.playTickerTick = this.playTickerTick.bind(this);
    this.playCommandGo = this.playCommandGo.bind(this);
    this.playVolatilityAlert = this.playVolatilityAlert.bind(this);
    this.toggleMute = this.toggleMute.bind(this);
    this.isMuted = this.isMuted.bind(this);
    this.setMuted = this.setMuted.bind(this);
    this.setMasterVolume = this.setMasterVolume.bind(this);
    this.getMasterVolume = this.getMasterVolume.bind(this);

    // If a custom context was supplied, configure immediately
    if (this.ctx) {
      this.initNodes();
    }
  }

  /**
   * Lazily obtain or instantiate AudioContext with browser unlock handling
   * @returns {AudioContext|null}
   */
  getContext() {
    if (this.ctx) {
      if (
        this.ctx.state === "suspended" &&
        typeof this.ctx.resume === "function"
      ) {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    try {
      const AudioCtxClass =
        (typeof window !== "undefined" &&
          (window.AudioContext || window.webkitAudioContext)) ||
        (typeof globalThis !== "undefined" &&
          (globalThis.AudioContext || globalThis.webkitAudioContext));

      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
        this.initNodes();
        if (
          this.ctx.state === "suspended" &&
          typeof this.ctx.resume === "function"
        ) {
          this.ctx.resume().catch(() => {});
        }
        return this.ctx;
      }
    } catch {
      // AudioContext unavailable in headless / restricted environment
    }
    return null;
  }

  /**
   * Set or override AudioContext (useful for headless testing or custom pipelines)
   * @param {AudioContext|Object} context
   */
  setContext(context) {
    this.ctx = context;
    this.noiseBuffer = null;
    this.initNodes();
  }

  /**
   * Initialize audio routing nodes (Master Gain -> Dynamics Compressor -> Destination)
   */
  initNodes() {
    if (!this.ctx) return;

    try {
      // Dynamics Compressor acting as peak limiter for institutional audio headroom
      if (typeof this.ctx.createDynamicsCompressor === "function") {
        this.limiterNode = this.ctx.createDynamicsCompressor();
        this.limiterNode.threshold.setValueAtTime?.(-4, this.ctx.currentTime);
        this.limiterNode.knee.setValueAtTime?.(6, this.ctx.currentTime);
        this.limiterNode.ratio.setValueAtTime?.(12, this.ctx.currentTime);
        this.limiterNode.attack.setValueAtTime?.(0.002, this.ctx.currentTime);
        this.limiterNode.release.setValueAtTime?.(0.05, this.ctx.currentTime);
        this.limiterNode.connect(this.ctx.destination);
      }

      // Master Gain Node
      if (typeof this.ctx.createGain === "function") {
        this.masterGain = this.ctx.createGain();
        const initialGain = this.muted ? 0.0 : this.masterVolume;
        this.masterGain.gain.setValueAtTime?.(
          initialGain,
          this.ctx.currentTime,
        );

        if (this.limiterNode) {
          this.masterGain.connect(this.limiterNode);
        } else if (this.ctx.destination) {
          this.masterGain.connect(this.ctx.destination);
        }
      }

      // Pre-allocate 1-second white noise buffer for low-latency mechanical transients
      this.getOrCreateNoiseBuffer();
    } catch {
      // Graceful fallback for mock objects
    }
  }

  /**
   * Pre-allocates or retrieves single-channel white noise buffer
   * Zero allocation inside audio playback loop
   * @returns {AudioBuffer|null}
   */
  getOrCreateNoiseBuffer() {
    if (this.noiseBuffer) return this.noiseBuffer;
    if (!this.ctx || typeof this.ctx.createBuffer !== "function") return null;

    try {
      const sampleRate = this.ctx.sampleRate || 44100;
      const buffer = this.ctx.createBuffer(1, sampleRate, sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < sampleRate; i++) {
        // High quality pseudo-random white noise [-1.0, 1.0]
        output[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
      return this.noiseBuffer;
    } catch {
      return null;
    }
  }

  /**
   * 1. playTerminalKey(char)
   * Authentic mechanical CRT/tactile keyboard keypress for terminal command bar entry.
   * Models the physical acoustics of buckling-spring / beam-spring switches:
   * - High-frequency bucking snap (bandpass filtered noise transient)
   * - Low-frequency bottom-out keyframe resonance (triangle frequency sweep)
   * - Subtle micro-pitch variation per character to eliminate the "machine-gun" effect
   *
   * @param {string} [char=''] Character being pressed (e.g. 'A', 'Enter', ' ', 'Backspace')
   */
  playTerminalKey(char = "") {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dest = this.masterGain || ctx.destination;

    const charStr = String(char);
    const isEnter =
      charStr === "Enter" ||
      charStr === "\r" ||
      charStr === "\n" ||
      charStr === "<GO>";
    const isSpace = charStr === " " || charStr === "Space";
    const isBackspace = charStr === "Backspace" || charStr === "Delete";

    // Character hash micro-variation (±120Hz snap, ±15Hz body)
    const code = charStr.length > 0 ? charStr.charCodeAt(0) : 72;
    const hash = ((code * 17 + 23) % 13) - 6; // -6 to +6

    let snapFreq = 3400 + hash * 35;
    let thudFreq = 220 + hash * 5;
    let snapDecay = 0.008;
    let thudDecay = 0.022;
    let snapGainLevel = 0.22;
    let thudGainLevel = 0.35;

    if (isEnter) {
      // Bloomberg <ENTER> / heavy bottom-out latch
      snapFreq = 3100;
      thudFreq = 160;
      thudDecay = 0.038;
      snapDecay = 0.012;
      snapGainLevel = 0.28;
      thudGainLevel = 0.45;
    } else if (isSpace) {
      // Broad spacebar cavity acoustic resonance
      snapFreq = 2600;
      thudFreq = 135;
      thudDecay = 0.042;
      snapDecay = 0.014;
      snapGainLevel = 0.2;
      thudGainLevel = 0.42;
    } else if (isBackspace) {
      // High-register tactile click
      snapFreq = 4100;
      thudFreq = 290;
      thudDecay = 0.016;
      snapDecay = 0.007;
      snapGainLevel = 0.24;
      thudGainLevel = 0.28;
    }

    try {
      // --- Component 1: High-Frequency Mechanical Buckle Snap (Noise) ---
      const noise = this.getOrCreateNoiseBuffer();
      if (noise && typeof ctx.createBufferSource === "function") {
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noise;

        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = "bandpass";
        noiseFilter.frequency.setValueAtTime?.(snapFreq, now);
        noiseFilter.Q.setValueAtTime?.(5.5, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime?.(snapGainLevel, now);
        noiseGain.gain.exponentialRampToValueAtTime?.(0.0001, now + snapDecay);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(dest);

        noiseSource.start(now);
        noiseSource.stop(now + snapDecay + 0.002);
      }

      // --- Component 2: Bottom-Out Mechanical Body Thud (Triangle Pitch Sweep) ---
      if (typeof ctx.createOscillator === "function") {
        const thudOsc = ctx.createOscillator();
        thudOsc.type = "triangle";
        thudOsc.frequency.setValueAtTime?.(thudFreq, now);
        thudOsc.frequency.exponentialRampToValueAtTime?.(
          Math.max(30, thudFreq * 0.3),
          now + thudDecay,
        );

        const thudGain = ctx.createGain();
        thudGain.gain.setValueAtTime?.(thudGainLevel, now);
        thudGain.gain.exponentialRampToValueAtTime?.(0.0001, now + thudDecay);

        thudOsc.connect(thudGain);
        thudGain.connect(dest);

        thudOsc.start(now);
        thudOsc.stop(now + thudDecay + 0.002);
      }
    } catch {
      // Audio node failure protection
    }
  }

  /**
   * 2. playTickerTick(direction)
   * Ultra-short micro-tick (1-2ms) when real-time prices flash.
   * - Uptick (green): Crisp high-frequency sine blip (~2800Hz - 3200Hz)
   * - Downtick (red): Slightly lower frequency micro-blip (~1500Hz - 1800Hz)
   *
   * @param {'up'|'down'|'green'|'red'|'buy'|'sell'|number|boolean} direction
   */
  playTickerTick(direction) {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // High frequency feed throttle (prevent acoustic clutter on 100+ tick/sec bursts)
    if (now - this.lastTickTime < 0.015) {
      return;
    }
    this.lastTickTime = now;

    const dest = this.masterGain || ctx.destination;

    // Normalize direction
    let isUp = false;
    if (typeof direction === "boolean") {
      isUp = direction;
    } else if (typeof direction === "number") {
      isUp = direction > 0;
    } else if (typeof direction === "string") {
      const d = direction.toLowerCase().trim();
      isUp =
        d === "up" ||
        d === "green" ||
        d === "buy" ||
        d === "+1" ||
        d === "1" ||
        d === "+";
    }

    const freqStart = isUp ? 2800 : 1800;
    const freqEnd = isUp ? 3300 : 1350;
    const tickDuration = 0.0018; // ~1.8 milliseconds

    try {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime?.(freqStart, now);
      osc.frequency.linearRampToValueAtTime?.(freqEnd, now + tickDuration);

      const gain = ctx.createGain();
      // Fast micro-transient envelope
      gain.gain.setValueAtTime?.(0.12, now);
      gain.gain.exponentialRampToValueAtTime?.(0.0001, now + tickDuration);

      osc.connect(gain);
      gain.connect(dest);

      osc.start(now);
      osc.stop(now + tickDuration + 0.001);
    } catch {
      // Audio node protection
    }
  }

  /**
   * 3. playCommandGo()
   * The iconic Bloomberg '<GO>' execute sound:
   * Satisfying crisp mechanical solenoid latch + pristine electronic institutional chime.
   * - Latch: Double-transient mechanical switch lock (snap + body thud + sub-bounce)
   * - Electronic chime: Two-tone ascending bell partials (E6 -> B6/C#7) with pristine crystalline decay.
   */
  playCommandGo() {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dest = this.masterGain || ctx.destination;

    try {
      // === PHASE 1: MECHANICAL LATCH ENGAGE (t = 0 to 25ms) ===
      const noise = this.getOrCreateNoiseBuffer();
      if (noise && typeof ctx.createBufferSource === "function") {
        // Latch strike 1 (metallic solenoid snap)
        const snapSource = ctx.createBufferSource();
        snapSource.buffer = noise;
        const snapFilter = ctx.createBiquadFilter();
        snapFilter.type = "bandpass";
        snapFilter.frequency.setValueAtTime?.(3200, now);
        snapFilter.Q.setValueAtTime?.(6.0, now);

        const snapGain = ctx.createGain();
        snapGain.gain.setValueAtTime?.(0.32, now);
        snapGain.gain.exponentialRampToValueAtTime?.(0.0001, now + 0.015);

        snapSource.connect(snapFilter);
        snapFilter.connect(snapGain);
        snapGain.connect(dest);
        snapSource.start(now);
        snapSource.stop(now + 0.02);

        // Sub-latch rebound micro-click at t + 12ms
        const reboundSource = ctx.createBufferSource();
        reboundSource.buffer = noise;
        const reboundFilter = ctx.createBiquadFilter();
        reboundFilter.type = "highpass";
        reboundFilter.frequency.setValueAtTime?.(4500, now + 0.012);

        const reboundGain = ctx.createGain();
        reboundGain.gain.setValueAtTime?.(0.0001, now);
        reboundGain.gain.setValueAtTime?.(0.18, now + 0.012);
        reboundGain.gain.exponentialRampToValueAtTime?.(0.0001, now + 0.026);

        reboundSource.connect(reboundFilter);
        reboundFilter.connect(reboundGain);
        reboundGain.connect(dest);
        reboundSource.start(now + 0.012);
        reboundSource.stop(now + 0.03);
      }

      // Solenoid mechanical body weight
      if (typeof ctx.createOscillator === "function") {
        const latchOsc = ctx.createOscillator();
        latchOsc.type = "triangle";
        latchOsc.frequency.setValueAtTime?.(210, now);
        latchOsc.frequency.exponentialRampToValueAtTime?.(55, now + 0.035);

        const latchGain = ctx.createGain();
        latchGain.gain.setValueAtTime?.(0.4, now);
        latchGain.gain.exponentialRampToValueAtTime?.(0.0001, now + 0.035);

        latchOsc.connect(latchGain);
        latchGain.connect(dest);
        latchOsc.start(now);
        latchOsc.stop(now + 0.04);
      }

      // === PHASE 2: INSTITUTIONAL ELECTRONIC CHIME (t = 15ms to 550ms) ===
      if (typeof ctx.createOscillator === "function") {
        const chimeStartTime = now + 0.018;

        // Tone 1: Fundamental E6 (1318.5 Hz)
        const tone1 = ctx.createOscillator();
        tone1.type = "sine";
        tone1.frequency.setValueAtTime?.(1318.51, chimeStartTime);

        const gain1 = ctx.createGain();
        gain1.gain.setValueAtTime?.(0.0001, chimeStartTime);
        gain1.gain.linearRampToValueAtTime?.(0.25, chimeStartTime + 0.004);
        gain1.gain.exponentialRampToValueAtTime?.(
          0.0001,
          chimeStartTime + 0.22,
        );

        tone1.connect(gain1);
        gain1.connect(dest);
        tone1.start(chimeStartTime);
        tone1.stop(chimeStartTime + 0.23);

        // Tone 2: Ascending fifth B6 (1975.5 Hz) - Pristine crystalline bell tone
        const chime2StartTime = chimeStartTime + 0.045;
        const tone2 = ctx.createOscillator();
        tone2.type = "sine";
        tone2.frequency.setValueAtTime?.(1975.53, chime2StartTime);

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime?.(0.0001, chime2StartTime);
        gain2.gain.linearRampToValueAtTime?.(0.32, chime2StartTime + 0.005);
        gain2.gain.exponentialRampToValueAtTime?.(
          0.0001,
          chime2StartTime + 0.48,
        );

        tone2.connect(gain2);
        gain2.connect(dest);
        tone2.start(chime2StartTime);
        tone2.stop(chime2StartTime + 0.5);

        // Tone 2 Harmonic Partial (2.76x overtone: 5452 Hz) for institutional glass sheen
        const overtone = ctx.createOscillator();
        overtone.type = "sine";
        overtone.frequency.setValueAtTime?.(1975.53 * 2.76, chime2StartTime);

        const overtoneGain = ctx.createGain();
        overtoneGain.gain.setValueAtTime?.(0.0001, chime2StartTime);
        overtoneGain.gain.linearRampToValueAtTime?.(
          0.06,
          chime2StartTime + 0.003,
        );
        overtoneGain.gain.exponentialRampToValueAtTime?.(
          0.0001,
          chime2StartTime + 0.18,
        );

        overtone.connect(overtoneGain);
        overtoneGain.connect(dest);
        overtone.start(chime2StartTime);
        overtone.stop(chime2StartTime + 0.2);
      }
    } catch {
      // Audio node protection
    }
  }

  /**
   * 4. playVolatilityAlert(level)
   * Sonar/radar cautionary alert for sudden market spikes (>3% or flash crashes).
   * - Level 1 / Cautionary (~3% spike):
   *   Classic submarine/trading floor sonar ping (940Hz -> 910Hz, Q=16 resonant ring, 750ms decay).
   * - Level 2 / Critical (>5% or flash crash):
   *   High-urgency dual-pulse radar sonar warning (1180Hz pulse followed by 1440Hz alert pulse).
   *
   * @param {number|'low'|'medium'|'high'|'crit'|'warning'|'caution'} [level=1]
   */
  playVolatilityAlert(level = 1) {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dest = this.masterGain || ctx.destination;

    // Parse alert severity
    let isCritical = false;
    let isWarning = true;

    if (typeof level === "number") {
      if (level >= 5.0 || level >= 2) {
        isCritical = true;
      }
    } else if (typeof level === "string") {
      const l = level.toLowerCase().trim();
      if (
        l === "crit" ||
        l === "critical" ||
        l === "high" ||
        l === "crash" ||
        l === "flash"
      ) {
        isCritical = true;
      } else if (l === "low") {
        isWarning = false;
      }
    }

    try {
      if (typeof ctx.createOscillator !== "function") return;

      if (!isCritical) {
        // --- STANDARD CAUTIONARY SONAR PING (~3% Market Movement) ---
        const baseFreq = isWarning ? 940 : 820;
        const pingDuration = isWarning ? 0.75 : 0.5;

        const osc = ctx.createOscillator();
        osc.type = "sine";
        // Subtle hydroacoustic Doppler glide down
        osc.frequency.setValueAtTime?.(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime?.(
          baseFreq * 0.96,
          now + pingDuration,
        );

        // High-Q resonant bandpass filter for authentic sonar chamber ring
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime?.(baseFreq, now);
        filter.Q.setValueAtTime?.(16, now);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime?.(0.0001, now);
        gain.gain.linearRampToValueAtTime?.(0.3, now + 0.006); // Crisp ping attack
        gain.gain.exponentialRampToValueAtTime?.(0.0001, now + pingDuration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        osc.start(now);
        osc.stop(now + pingDuration + 0.01);
      } else {
        // --- CRITICAL DUAL-PULSE RADAR ALARM (>5% Flash Crash / Surge) ---
        const pulse1Start = now;
        const pulse1Duration = 0.35;
        const pulse1Freq = 1180;

        // Pulse 1
        const osc1 = ctx.createOscillator();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime?.(pulse1Freq, pulse1Start);
        osc1.frequency.exponentialRampToValueAtTime?.(
          pulse1Freq * 0.95,
          pulse1Start + pulse1Duration,
        );

        const filter1 = ctx.createBiquadFilter();
        filter1.type = "bandpass";
        filter1.frequency.setValueAtTime?.(pulse1Freq, pulse1Start);
        filter1.Q.setValueAtTime?.(18, pulse1Start);

        const gain1 = ctx.createGain();
        gain1.gain.setValueAtTime?.(0.0001, pulse1Start);
        gain1.gain.linearRampToValueAtTime?.(0.35, pulse1Start + 0.004);
        gain1.gain.exponentialRampToValueAtTime?.(
          0.0001,
          pulse1Start + pulse1Duration,
        );

        osc1.connect(filter1);
        filter1.connect(gain1);
        gain1.connect(dest);
        osc1.start(pulse1Start);
        osc1.stop(pulse1Start + pulse1Duration + 0.01);

        // Pulse 2 (Higher secondary alert ping 140ms later)
        const pulse2Start = now + 0.14;
        const pulse2Duration = 0.6;
        const pulse2Freq = 1440;

        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime?.(pulse2Freq, pulse2Start);
        osc2.frequency.exponentialRampToValueAtTime?.(
          pulse2Freq * 0.95,
          pulse2Start + pulse2Duration,
        );

        const filter2 = ctx.createBiquadFilter();
        filter2.type = "bandpass";
        filter2.frequency.setValueAtTime?.(pulse2Freq, pulse2Start);
        filter2.Q.setValueAtTime?.(20, pulse2Start);

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime?.(0.0001, pulse2Start);
        gain2.gain.linearRampToValueAtTime?.(0.4, pulse2Start + 0.004);
        gain2.gain.exponentialRampToValueAtTime?.(
          0.0001,
          pulse2Start + pulse2Duration,
        );

        osc2.connect(filter2);
        filter2.connect(gain2);
        gain2.connect(dest);
        osc2.start(pulse2Start);
        osc2.stop(pulse2Start + pulse2Duration + 0.01);
      }
    } catch {
      // Audio node protection
    }
  }

  /**
   * 5. toggleMute()
   * Flips muted state, smoothly updates master gain, persists to localStorage.
   * @returns {boolean} New muted state (true = muted, false = unmuted)
   */
  toggleMute() {
    return this.setMuted(!this.muted);
  }

  /**
   * Check whether audio engine is currently muted
   * @returns {boolean}
   */
  isMuted() {
    return this.muted;
  }

  /**
   * Explicitly set muted state and persist to localStorage
   * @param {boolean} shouldMute
   * @returns {boolean} Current muted state
   */
  setMuted(shouldMute) {
    this.muted = Boolean(shouldMute);

    try {
      this.storage.setItem(STORAGE_KEY, String(this.muted));
    } catch {
      // Storage write protection
    }

    if (this.masterGain && this.ctx) {
      try {
        const targetGain = this.muted ? 0.0 : this.masterVolume;
        const now = this.ctx.currentTime || 0;
        if (typeof this.masterGain.gain.setValueAtTime === "function") {
          // De-click via 15ms linear transition
          this.masterGain.gain.setValueAtTime(
            this.masterGain.gain.value ?? targetGain,
            now,
          );
          this.masterGain.gain.linearRampToValueAtTime?.(
            targetGain,
            now + 0.015,
          );
        } else {
          this.masterGain.gain.value = targetGain;
        }
      } catch {
        // Gain ramp protection
      }
    }

    return this.muted;
  }

  /**
   * Set Master Volume (0.0 to 1.0) and persist to storage
   * @param {number} vol
   */
  setMasterVolume(vol) {
    const clamped = Math.max(0, Math.min(1, Number(vol) || 0));
    this.masterVolume = clamped;

    try {
      this.storage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      // Storage protection
    }

    if (this.masterGain && this.ctx && !this.muted) {
      try {
        const now = this.ctx.currentTime || 0;
        if (typeof this.masterGain.gain.setValueAtTime === "function") {
          this.masterGain.gain.setValueAtTime(
            this.masterGain.gain.value ?? clamped,
            now,
          );
          this.masterGain.gain.linearRampToValueAtTime?.(clamped, now + 0.015);
        } else {
          this.masterGain.gain.value = clamped;
        }
      } catch {
        // Gain ramp protection
      }
    }
    return this.masterVolume;
  }

  /**
   * Get current master volume level
   * @returns {number}
   */
  getMasterVolume() {
    return this.masterVolume;
  }

  /**
   * Return internal state summary for diagnostics and UI status
   * @returns {{ muted: boolean, masterVolume: number, isInitialized: boolean, state: string }}
   */
  getState() {
    return {
      muted: this.muted,
      masterVolume: this.masterVolume,
      isInitialized: Boolean(this.ctx),
      state: this.ctx ? this.ctx.state || "running" : "uninitialized",
    };
  }

  /**
   * Gracefully close AudioContext
   */
  async close() {
    if (this.ctx && typeof this.ctx.close === "function") {
      try {
        await this.ctx.close();
      } catch {
        // Ignore close error
      }
    }
    this.ctx = null;
    this.masterGain = null;
    this.limiterNode = null;
    this.noiseBuffer = null;
  }
}

// Instantiate default singleton instance
export const soundEngine = new ApexSoundEngine();

// Export convenience functions matching the prompt specification
export const playTerminalKey = (char) => soundEngine.playTerminalKey(char);
export const playTickerTick = (direction) =>
  soundEngine.playTickerTick(direction);
export const playCommandGo = () => soundEngine.playCommandGo();
export const playVolatilityAlert = (level) =>
  soundEngine.playVolatilityAlert(level);
export const toggleMute = () => soundEngine.toggleMute();
export const isMuted = () => soundEngine.isMuted();
export const setMuted = (muted) => soundEngine.setMuted(muted);
export const setMasterVolume = (vol) => soundEngine.setMasterVolume(vol);
export const getMasterVolume = () => soundEngine.getMasterVolume();
export const getAudioContext = () => soundEngine.getContext();

// Default export
export default soundEngine;
