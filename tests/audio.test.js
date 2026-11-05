/**
 * Apex Terminal - Procedural Web Audio Engine Test Suite
 * Comprehensive verification of mechanical CRT typing, micro-ticks, Bloomberg <GO>,
 * sonar volatility alerts, and persistent storage.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ApexSoundEngine,
  playTerminalKey,
  playTickerTick,
  playCommandGo,
  playVolatilityAlert,
  toggleMute,
  isMuted,
  setMuted,
  setMasterVolume,
  getMasterVolume,
  soundEngine,
} from "../src/audio.js";

/**
 * High-fidelity Mock Web Audio API Implementation
 * Tracks created nodes, param automation curves, and audio routing.
 */
class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.calls = [];
  }
  setValueAtTime(val, time) {
    this.value = val;
    this.calls.push({ method: "setValueAtTime", value: val, time });
  }
  exponentialRampToValueAtTime(val, time) {
    this.value = val;
    this.calls.push({
      method: "exponentialRampToValueAtTime",
      value: val,
      time,
    });
  }
  linearRampToValueAtTime(val, time) {
    this.value = val;
    this.calls.push({ method: "linearRampToValueAtTime", value: val, time });
  }
}

class MockAudioNode {
  constructor(context, type = "generic") {
    this.context = context;
    this.nodeType = type;
    this.connectedTo = [];
  }
  connect(dest) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect() {
    this.connectedTo = [];
  }
}

class MockGainNode extends MockAudioNode {
  constructor(context, initialGain = 1.0) {
    super(context, "GainNode");
    this.gain = new MockAudioParam(initialGain);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(context) {
    super(context, "BiquadFilterNode");
    this.type = "lowpass";
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor(context) {
    super(context, "OscillatorNode");
    this.type = "sine";
    this.frequency = new MockAudioParam(440);
    this.started = false;
    this.stopped = false;
    this.startTime = null;
    this.stopTime = null;
  }
  start(when = 0) {
    this.started = true;
    this.startTime = when;
  }
  stop(when = 0) {
    this.stopped = true;
    this.stopTime = when;
  }
}

class MockBufferSourceNode extends MockAudioNode {
  constructor(context) {
    super(context, "BufferSourceNode");
    this.buffer = null;
    this.started = false;
    this.stopped = false;
    this.startTime = null;
    this.stopTime = null;
  }
  start(when = 0) {
    this.started = true;
    this.startTime = when;
  }
  stop(when = 0) {
    this.stopped = true;
    this.stopTime = when;
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  constructor(context) {
    super(context, "DynamicsCompressorNode");
    this.threshold = new MockAudioParam(-24);
    this.knee = new MockAudioParam(30);
    this.ratio = new MockAudioParam(12);
    this.attack = new MockAudioParam(0.003);
    this.release = new MockAudioParam(0.25);
  }
}

class MockAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }
  getChannelData(channel) {
    return this.channels[channel];
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 100.0;
    this.sampleRate = 44100;
    this.state = "running";
    this.destination = new MockAudioNode(this, "Destination");
    this.createdNodes = [];
  }
  createGain() {
    const node = new MockGainNode(this);
    this.createdNodes.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new MockBiquadFilterNode(this);
    this.createdNodes.push(node);
    return node;
  }
  createOscillator() {
    const node = new MockOscillatorNode(this);
    this.createdNodes.push(node);
    return node;
  }
  createBufferSource() {
    const node = new MockBufferSourceNode(this);
    this.createdNodes.push(node);
    return node;
  }
  createDynamicsCompressor() {
    const node = new MockDynamicsCompressorNode(this);
    this.createdNodes.push(node);
    return node;
  }
  createBuffer(channels, length, sampleRate) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
}

class MockStorage {
  constructor(initialData = {}) {
    this.store = new Map(Object.entries(initialData));
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, val) {
    this.store.set(key, String(val));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

describe("ApexSoundEngine - Architecture & Lifecycle", () => {
  let mockCtx;
  let mockStorage;
  let engine;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    mockStorage = new MockStorage();
    engine = new ApexSoundEngine({ context: mockCtx, storage: mockStorage });
  });

  it("initializes master limiter and master gain routed to destination", () => {
    assert.ok(engine.masterGain);
    assert.ok(engine.limiterNode);
    // Limiter connects to destination
    assert.equal(engine.limiterNode.connectedTo[0], mockCtx.destination);
    // Master gain connects to limiter
    assert.equal(engine.masterGain.connectedTo[0], engine.limiterNode);
  });

  it("pre-allocates a 1-second white noise buffer with zero reallocations", () => {
    const buf1 = engine.getOrCreateNoiseBuffer();
    assert.ok(buf1);
    assert.equal(buf1.length, 44100);
    assert.equal(buf1.numberOfChannels, 1);

    // Should return same cached buffer
    const buf2 = engine.getOrCreateNoiseBuffer();
    assert.strictEqual(buf1, buf2);
  });

  it("resumes suspended audio context automatically upon getContext()", async () => {
    mockCtx.state = "suspended";
    let resumeCalled = false;
    mockCtx.resume = async () => {
      resumeCalled = true;
      mockCtx.state = "running";
    };

    const ctx = engine.getContext();
    assert.strictEqual(ctx, mockCtx);
    assert.equal(resumeCalled, true);
  });

  it("reports correct internal state diagnosis", () => {
    const state = engine.getState();
    assert.equal(state.muted, false);
    assert.equal(state.masterVolume, 0.7);
    assert.equal(state.isInitialized, true);
    assert.equal(state.state, "running");
  });
});

describe("1. playTerminalKey(char) - Mechanical CRT / Tactile Keypress", () => {
  let mockCtx;
  let engine;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    engine = new ApexSoundEngine({
      context: mockCtx,
      storage: new MockStorage(),
    });
  });

  it("synthesizes dual-component acoustic impact (noise buckle snap + triangle body thud)", () => {
    const nodeCountBefore = mockCtx.createdNodes.length;
    engine.playTerminalKey("A");

    const newNodes = mockCtx.createdNodes.slice(nodeCountBefore);
    const noiseSource = newNodes.find((n) => n.nodeType === "BufferSourceNode");
    const filter = newNodes.find((n) => n.nodeType === "BiquadFilterNode");
    const thudOsc = newNodes.find((n) => n.nodeType === "OscillatorNode");

    assert.ok(noiseSource, "Must trigger mechanical noise snap buffer");
    assert.ok(filter, "Must pass noise through bandpass filter");
    assert.equal(filter.type, "bandpass");
    assert.ok(thudOsc, "Must trigger triangle bottom-out oscillator");
    assert.equal(thudOsc.type, "triangle");
    assert.equal(noiseSource.started, true);
    assert.equal(thudOsc.started, true);
  });

  it("shapes deep cavity acoustics for Spacebar", () => {
    const nodeCountBefore = mockCtx.createdNodes.length;
    engine.playTerminalKey(" ");

    const newNodes = mockCtx.createdNodes.slice(nodeCountBefore);
    const filter = newNodes.find((n) => n.nodeType === "BiquadFilterNode");
    const osc = newNodes.find((n) => n.nodeType === "OscillatorNode");

    assert.equal(filter.frequency.value, 2600);
    assert.equal(osc.frequency.calls[0].value, 135);
  });

  it("shapes authoritative heavy latch acoustics for Enter / <GO>", () => {
    const nodeCountBefore = mockCtx.createdNodes.length;
    engine.playTerminalKey("<GO>");

    const newNodes = mockCtx.createdNodes.slice(nodeCountBefore);
    const filter = newNodes.find((n) => n.nodeType === "BiquadFilterNode");
    const osc = newNodes.find((n) => n.nodeType === "OscillatorNode");

    assert.equal(filter.frequency.value, 3100);
    assert.equal(osc.frequency.calls[0].value, 160);
  });

  it("shapes crisp high tactile snap for Backspace", () => {
    const nodeCountBefore = mockCtx.createdNodes.length;
    engine.playTerminalKey("Backspace");

    const newNodes = mockCtx.createdNodes.slice(nodeCountBefore);
    const filter = newNodes.find((n) => n.nodeType === "BiquadFilterNode");
    const osc = newNodes.find((n) => n.nodeType === "OscillatorNode");

    assert.equal(filter.frequency.value, 4100);
    assert.equal(osc.frequency.calls[0].value, 290);
  });

  it("introduces character hash micro-modulation to prevent machine-gunning", () => {
    mockCtx.createdNodes = [];
    engine.playTerminalKey("A");
    const filterA = mockCtx.createdNodes.find(
      (n) => n.nodeType === "BiquadFilterNode",
    );

    mockCtx.createdNodes = [];
    engine.playTerminalKey("Z");
    const filterZ = mockCtx.createdNodes.find(
      (n) => n.nodeType === "BiquadFilterNode",
    );

    assert.notEqual(filterA.frequency.value, filterZ.frequency.value);
  });

  it("produces zero audio nodes when engine is muted", () => {
    engine.setMuted(true);
    const countBefore = mockCtx.createdNodes.length;
    engine.playTerminalKey("A");
    assert.equal(mockCtx.createdNodes.length, countBefore);
  });
});

describe("2. playTickerTick(direction) - Micro-Tick Price Flashes", () => {
  let mockCtx;
  let engine;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    engine = new ApexSoundEngine({
      context: mockCtx,
      storage: new MockStorage(),
    });
  });

  it("synthesizes higher-pitch micro-tick for green upticks (2800 -> 3300 Hz)", () => {
    const countBefore = mockCtx.createdNodes.length;
    engine.playTickerTick("up");

    const newNodes = mockCtx.createdNodes.slice(countBefore);
    const osc = newNodes.find((n) => n.nodeType === "OscillatorNode");
    const gain = newNodes.find((n) => n.nodeType === "GainNode");

    assert.ok(osc, "Oscillator created for tick");
    assert.equal(osc.type, "sine");
    assert.equal(osc.frequency.value, 3300); // Ramped to 3300

    // Micro-transient duration <= 2ms
    assert.ok(osc.stopTime - osc.startTime <= 0.003);
    assert.ok(gain);
  });

  it("synthesizes lower-pitch micro-tick for red downticks (1800 -> 1350 Hz)", () => {
    // Advance time slightly to bypass high-frequency throttle
    mockCtx.currentTime += 0.05;
    const countBefore = mockCtx.createdNodes.length;
    engine.playTickerTick("down");

    const newNodes = mockCtx.createdNodes.slice(countBefore);
    const osc = newNodes.find((n) => n.nodeType === "OscillatorNode");

    assert.ok(osc);
    assert.equal(osc.frequency.value, 1350); // Ramped to 1350
  });

  it("supports boolean, numeric, and string alias inputs", () => {
    // Test green aliases
    const upInputs = [true, 1, "+1", "green", "buy"];
    for (const input of upInputs) {
      mockCtx.currentTime += 0.05;
      const before = mockCtx.createdNodes.length;
      engine.playTickerTick(input);
      const osc = mockCtx.createdNodes
        .slice(before)
        .find((n) => n.nodeType === "OscillatorNode");
      assert.ok(osc);
      assert.equal(
        osc.frequency.value,
        3300,
        `Input ${input} should map to uptick`,
      );
    }

    // Test red aliases
    const downInputs = [false, -1, "-1", "red", "sell", "down"];
    for (const input of downInputs) {
      mockCtx.currentTime += 0.05;
      const before = mockCtx.createdNodes.length;
      engine.playTickerTick(input);
      const osc = mockCtx.createdNodes
        .slice(before)
        .find((n) => n.nodeType === "OscillatorNode");
      assert.ok(osc);
      assert.equal(
        osc.frequency.value,
        1350,
        `Input ${input} should map to downtick`,
      );
    }
  });

  it("throttles rapid tick bursts (<15ms) to prevent acoustic clutter", () => {
    mockCtx.currentTime = 100.0;
    engine.playTickerTick("up");
    const nodesFirst = mockCtx.createdNodes.length;

    // Immediately trigger without advancing time
    engine.playTickerTick("up");
    assert.equal(
      mockCtx.createdNodes.length,
      nodesFirst,
      "Rapid subsequent tick must be throttled",
    );

    // Advance time past 15ms threshold
    mockCtx.currentTime += 0.02;
    engine.playTickerTick("up");
    assert.ok(
      mockCtx.createdNodes.length > nodesFirst,
      "Tick after threshold must play",
    );
  });

  it("no-ops when muted", () => {
    engine.setMuted(true);
    const count = mockCtx.createdNodes.length;
    engine.playTickerTick("up");
    assert.equal(mockCtx.createdNodes.length, count);
  });
});

describe("3. playCommandGo() - Bloomberg <GO> Latch & Electronic Chime", () => {
  let mockCtx;
  let engine;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    engine = new ApexSoundEngine({
      context: mockCtx,
      storage: new MockStorage(),
    });
  });

  it("triggers mechanical solenoid latch + rebound micro-click + dual-tone electronic chime", () => {
    const countBefore = mockCtx.createdNodes.length;
    engine.playCommandGo();

    const newNodes = mockCtx.createdNodes.slice(countBefore);
    const bufferSources = newNodes.filter(
      (n) => n.nodeType === "BufferSourceNode",
    );
    const oscillators = newNodes.filter((n) => n.nodeType === "OscillatorNode");
    const filters = newNodes.filter((n) => n.nodeType === "BiquadFilterNode");

    // Latch components: strike + rebound micro-click = 2 buffer sources
    assert.equal(
      bufferSources.length,
      2,
      "Must include primary latch snap and rebound micro-click",
    );
    assert.ok(filters.some((f) => f.type === "bandpass"));
    assert.ok(filters.some((f) => f.type === "highpass"));

    // Chime components: Solenoid thud (triangle) + Tone 1 (E6) + Tone 2 (B6) + Glass partial
    assert.ok(
      oscillators.length >= 4,
      "Must include latch thud and 3 chime partials",
    );

    const latchThud = oscillators.find((o) => o.type === "triangle");
    assert.ok(latchThud, "Must include mechanical latch thud");

    const sines = oscillators.filter((o) => o.type === "sine");
    // Check for E6 fundamental (1318.51 Hz) and B6 chime (1975.53 Hz)
    const fundamentalE6 = sines.find((s) =>
      s.frequency.calls.some((c) => Math.abs(c.value - 1318.51) < 1),
    );
    const fifthB6 = sines.find((s) =>
      s.frequency.calls.some((c) => Math.abs(c.value - 1975.53) < 1),
    );
    const glassPartial = sines.find((s) =>
      s.frequency.calls.some((c) => c.value > 5000),
    );

    assert.ok(
      fundamentalE6,
      "Must synthesize E6 institutional fundamental chime",
    );
    assert.ok(fifthB6, "Must synthesize B6 ascending institutional chime");
    assert.ok(glassPartial, "Must synthesize 2.76x glass harmonic overtone");
  });

  it("no-ops when engine is muted", () => {
    engine.setMuted(true);
    const count = mockCtx.createdNodes.length;
    engine.playCommandGo();
    assert.equal(mockCtx.createdNodes.length, count);
  });
});

describe("4. playVolatilityAlert(level) - Sonar / Radar Cautionary Alert", () => {
  let mockCtx;
  let engine;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    engine = new ApexSoundEngine({
      context: mockCtx,
      storage: new MockStorage(),
    });
  });

  it("triggers classic sonar ping for standard cautionary alert (~3%)", () => {
    const countBefore = mockCtx.createdNodes.length;
    engine.playVolatilityAlert(1); // or 'warn'

    const newNodes = mockCtx.createdNodes.slice(countBefore);
    const osc = newNodes.find((n) => n.nodeType === "OscillatorNode");
    const filter = newNodes.find((n) => n.nodeType === "BiquadFilterNode");
    const gain = newNodes.find((n) => n.nodeType === "GainNode");

    assert.ok(osc);
    assert.equal(osc.type, "sine");
    assert.ok(
      filter,
      "Must route through high-Q resonant filter for authentic sonar chamber ring",
    );
    assert.equal(filter.Q.value, 16);
    // Frequency glide down
    assert.ok(osc.frequency.calls.some((c) => c.value >= 940));
    assert.ok(gain);
  });

  it("triggers urgent dual-pulse radar alarm for critical flash crashes (>5% or level 2+)", () => {
    const countBefore = mockCtx.createdNodes.length;
    engine.playVolatilityAlert(5.5); // 5.5% flash crash

    const newNodes = mockCtx.createdNodes.slice(countBefore);
    const oscs = newNodes.filter((n) => n.nodeType === "OscillatorNode");
    const filters = newNodes.filter((n) => n.nodeType === "BiquadFilterNode");

    assert.equal(oscs.length, 2, "Critical alert must fire dual radar pulses");
    assert.equal(
      filters.length,
      2,
      "Both pulses must have resonant bandpass filtering",
    );

    // Pulse 1 at 1180Hz, Pulse 2 at 1440Hz
    const pulse1 = oscs[0];
    const pulse2 = oscs[1];
    assert.ok(pulse1.frequency.calls.some((c) => c.value >= 1180));
    assert.ok(pulse2.frequency.calls.some((c) => c.value >= 1440));
    assert.ok(
      pulse2.startTime > pulse1.startTime,
      "Pulse 2 must sequence after Pulse 1",
    );
  });

  it("supports string labels (warning, crit, crash, flash, low)", () => {
    const alerts = [
      { label: "warn", critical: false },
      { label: "caution", critical: false },
      { label: "crit", critical: true },
      { label: "crash", critical: true },
      { label: "flash", critical: true },
    ];

    for (const { label, critical } of alerts) {
      mockCtx.currentTime += 1.0;
      const count = mockCtx.createdNodes.length;
      engine.playVolatilityAlert(label);
      const oscs = mockCtx.createdNodes
        .slice(count)
        .filter((n) => n.nodeType === "OscillatorNode");
      if (critical) {
        assert.equal(
          oscs.length,
          2,
          `Label '${label}' should trigger dual-pulse critical alarm`,
        );
      } else {
        assert.equal(
          oscs.length,
          1,
          `Label '${label}' should trigger single sonar ping`,
        );
      }
    }
  });

  it("no-ops when engine is muted", () => {
    engine.setMuted(true);
    const count = mockCtx.createdNodes.length;
    engine.playVolatilityAlert(3.5);
    assert.equal(mockCtx.createdNodes.length, count);
  });
});

describe("5. Mute & Volume Persistence (LocalStorage & Storage Safety)", () => {
  let mockStorage;
  let mockCtx;

  beforeEach(() => {
    mockStorage = new MockStorage();
    mockCtx = new MockAudioContext();
  });

  it("loads initial state from storage", () => {
    mockStorage.setItem("apex_terminal_audio_muted", "true");
    mockStorage.setItem("apex_terminal_audio_volume", "0.45");

    const eng = new ApexSoundEngine({ context: mockCtx, storage: mockStorage });
    assert.equal(eng.isMuted(), true);
    assert.equal(eng.getMasterVolume(), 0.45);
  });

  it("toggleMute() toggles state, persists to storage, and ramps master gain", () => {
    const eng = new ApexSoundEngine({ context: mockCtx, storage: mockStorage });
    assert.equal(eng.isMuted(), false);

    const newMuted = eng.toggleMute();
    assert.equal(newMuted, true);
    assert.equal(eng.isMuted(), true);
    assert.equal(mockStorage.getItem("apex_terminal_audio_muted"), "true");
    // Master gain ramped to 0
    assert.ok(eng.masterGain.gain.calls.some((c) => c.value === 0.0));

    // Toggle back
    eng.toggleMute();
    assert.equal(eng.isMuted(), false);
    assert.equal(mockStorage.getItem("apex_terminal_audio_muted"), "false");
    assert.ok(eng.masterGain.gain.calls.some((c) => c.value === 0.7));
  });

  it("setMuted() explicitly sets state and storage", () => {
    const eng = new ApexSoundEngine({ context: mockCtx, storage: mockStorage });
    eng.setMuted(true);
    assert.equal(eng.isMuted(), true);
    assert.equal(mockStorage.getItem("apex_terminal_audio_muted"), "true");

    eng.setMuted(false);
    assert.equal(eng.isMuted(), false);
    assert.equal(mockStorage.getItem("apex_terminal_audio_muted"), "false");
  });

  it("setMasterVolume() clamps values between 0.0 and 1.0 and persists", () => {
    const eng = new ApexSoundEngine({ context: mockCtx, storage: mockStorage });

    eng.setMasterVolume(1.5);
    assert.equal(eng.getMasterVolume(), 1.0);
    assert.equal(mockStorage.getItem("apex_terminal_audio_volume"), "1");

    eng.setMasterVolume(-0.5);
    assert.equal(eng.getMasterVolume(), 0.0);
    assert.equal(mockStorage.getItem("apex_terminal_audio_volume"), "0");

    eng.setMasterVolume(0.85);
    assert.equal(eng.getMasterVolume(), 0.85);
  });

  it("handles broken or throwing storage gracefully without crashing", () => {
    const faultyStorage = {
      getItem: () => {
        throw new Error("SecurityError: Access Denied");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    assert.doesNotThrow(() => {
      const eng = new ApexSoundEngine({
        context: mockCtx,
        storage: faultyStorage,
      });
      eng.toggleMute();
      eng.setMasterVolume(0.5);
      eng.playTerminalKey("A");
    });
  });
});

describe("Module-Level Standalone Function Exports", () => {
  beforeEach(() => {
    const mockCtx = new MockAudioContext();
    soundEngine.setContext(mockCtx);
    soundEngine.setMuted(false);
  });

  it("exports playTerminalKey, playTickerTick, playCommandGo, playVolatilityAlert", () => {
    assert.doesNotThrow(() => {
      playTerminalKey("B");
      playTickerTick("up");
      playCommandGo();
      playVolatilityAlert(1);
    });
  });

  it("exports toggleMute and isMuted bound to singleton", () => {
    const initial = isMuted();
    const toggled = toggleMute();
    assert.equal(toggled, !initial);
    assert.equal(isMuted(), !initial);
    // Restore
    toggleMute();
    assert.equal(isMuted(), initial);
  });

  it("exports setMasterVolume and getMasterVolume", () => {
    setMasterVolume(0.65);
    assert.equal(getMasterVolume(), 0.65);
  });
});
