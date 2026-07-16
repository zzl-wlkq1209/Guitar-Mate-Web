import {
  Check,
  Download,
  Eraser,
  Minus,
  Pencil,
  Plus,
  Pause,
  Play,
  RotateCcw,
  Save,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shareApiUrl } from "./shareApi";

type Direction = "down" | "up";
type SlotMode = "empty" | "normal" | "mute" | "double";
type MeterId = "fourFour" | "sixEight";

type StrumSlot = {
  mode: SlotMode;
  direction: Direction;
};

type Practice = {
  id: string;
  name: string;
  slots: StrumSlot[];
  advancedMode?: boolean;
};

type SavedPattern = Practice & {
  advancedMode: boolean;
};

type LoopItem = {
  id: string;
  sourceId: string;
};

type WorkspaceState = {
  selectedId: string;
  slots: StrumSlot[];
  customName: string;
  advancedMode: boolean;
  savedPatterns: SavedPattern[];
  loopItems: LoopItem[];
  loopEnabled: boolean;
};

type StoredState = {
  bpm: number;
  activeMeter: MeterId;
  latencyMs: number;
  fontSize: number;
  darkMode: boolean;
  workspaces: Record<MeterId, WorkspaceState>;
};

type InitialState = StoredState;

const STORAGE_KEY = "guitar-strum-simulator-v5";
const LEGACY_STORAGE_KEYS = [
  "guitar-strum-simulator-v4",
  "guitar-strum-simulator-v3",
  "guitar-strum-simulator-v2",
  "guitar-strum-simulator",
] as const;
const BEAT_NAMES = ["第一拍", "第二拍", "第三拍", "第四拍"];
const CUSTOM_DIRECTIONS: Direction[] = ["down", "up", "down", "up"];
const METERS: MeterId[] = ["fourFour", "sixEight"];

const directionText: Record<Direction, string> = {
  down: "下",
  up: "上",
};

// Guitar tabs usually mark down-strums with an upward arrow and up-strums with a downward arrow.
const directionArrow: Record<Direction, string> = {
  down: "↑",
  up: "↓",
};

const getDefaultDirection = (index: number) => CUSTOM_DIRECTIONS[index % 4];

const makeEmptySlots = (slotCount = 16): StrumSlot[] =>
  Array.from({ length: slotCount }, (_, index) => ({
    mode: "empty",
    direction: getDefaultDirection(index),
  }));

const normalizeSlots = (
  slots: Partial<StrumSlot>[] = [],
  slotCount = 16,
  forceCustomDirections = false,
): StrumSlot[] =>
  Array.from({ length: slotCount }, (_, index) => {
    const slot = slots[index];
    const fallbackDirection = getDefaultDirection(index);
    const direction =
      forceCustomDirections || (slot?.direction !== "down" && slot?.direction !== "up")
        ? fallbackDirection
        : slot.direction;
    const mode =
      slot?.mode === "normal" || slot?.mode === "mute" || slot?.mode === "double"
        ? slot.mode
        : "empty";
    return { mode, direction };
  });

const makePractice = (
  id: string,
  name: string,
  slotCount: number,
  activeIndexes: number[],
  directionOverrides: Record<number, Direction> = {},
): Practice => {
  const slots = makeEmptySlots(slotCount);
  activeIndexes.forEach((index) => {
    slots[index] = {
      mode: "normal",
      direction: directionOverrides[index] ?? getDefaultDirection(index),
    };
  });
  return { id, name, slots };
};

const makeSlotsFromText = (tokens: Array<"下" | "上" | "空" | "下上">): StrumSlot[] =>
  tokens.map((token, index) => {
    if (token === "空") {
      return { mode: "empty", direction: getDefaultDirection(index) };
    }
    if (token === "下上") {
      return { mode: "double", direction: "down" };
    }
    return { mode: "normal", direction: token === "下" ? "down" : "up" };
  });

const perBeat = (positions: number[]) =>
  [0, 1, 2, 3].flatMap((beat) => positions.map((position) => beat * 4 + position));

const eighthOverrides = [0, 1, 2, 3].reduce<Record<number, Direction>>((map, beat) => {
  map[beat * 4 + 2] = "up";
  return map;
}, {});

const PRACTICES: Practice[] = [
  makePractice("quarter", "4分", 16, [0, 4, 8, 12], {
    0: "down",
    4: "up",
    8: "down",
    12: "up",
  }),
  makePractice("eighth", "8分", 16, perBeat([0, 2]), eighthOverrides),
  makePractice("sixteenth", "16分", 16, perBeat([0, 1, 2, 3])),
  makePractice("eighth-sixteenth", "前8后16", 16, perBeat([0, 2, 3])),
  makePractice("sixteenth-eighth", "前16后8", 16, perBeat([0, 1, 2])),
  makePractice("syncopation", "切分", 16, perBeat([0, 1, 3])),
];

const SIX_EIGHT_PRACTICES: Practice[] = [
  {
    id: "six-eight-1",
    name: "节奏型1",
    slots: makeSlotsFromText(["下", "空", "下", "空", "下", "空", "下", "空", "下", "空", "下", "空"]),
  },
  {
    id: "six-eight-2",
    name: "节奏型2",
    slots: makeSlotsFromText(["下", "空", "空", "空", "下", "空", "下", "空", "上", "空", "下", "空"]),
  },
  {
    id: "six-eight-3",
    name: "节奏型3",
    slots: makeSlotsFromText(["下", "空", "下", "上", "下", "上", "下", "空", "下", "上", "下", "上"]),
  },
  {
    id: "six-eight-4",
    name: "节奏型4",
    slots: makeSlotsFromText(["下", "空", "空", "上", "下", "上", "下", "空", "空", "上", "下", "上"]),
  },
];

const METER_CONFIG = {
  fourFour: {
    label: "4/4",
    name: "四四拍",
    slotCount: 16,
    beatCount: 4,
    stepsPerStrongBeat: 4,
    practices: PRACTICES,
    lockedIds: new Set(["quarter", "eighth"]),
    customStartNumber: 1,
  },
  sixEight: {
    label: "6/8",
    name: "八六拍",
    slotCount: 12,
    beatCount: 2,
    stepsPerStrongBeat: 6,
    practices: SIX_EIGHT_PRACTICES,
    lockedIds: new Set<string>(),
    customStartNumber: 5,
  },
} satisfies Record<
  MeterId,
  {
    label: string;
    name: string;
    slotCount: number;
    beatCount: number;
    stepsPerStrongBeat: number;
    practices: Practice[];
    lockedIds: Set<string>;
    customStartNumber: number;
  }
>;

const DEFAULT_PRACTICE = METER_CONFIG.fourFour.practices[0];
const QUICK_BPMS = [50, 60, 70, 80];
const FONT_SIZE_OPTIONS = ["特小", "小", "标准", "大", "特大"] as const;
const VISUAL_LEAD_MS = 300;
const CALIBRATION_INTERVAL_MS = 800;
const CALIBRATION_VALID_WINDOW_MS = 780;

const clampBpm = (value: number) => Math.min(220, Math.max(40, Math.round(value)));
const clampLatency = (value: number) => Math.min(1000, Math.max(-500, Math.round(value)));
const cloneSlots = (slots: StrumSlot[]) => slots.map((slot) => ({ ...slot }));
const isCustomId = (id: string) => id === "custom" || id.startsWith("saved-");
const hasSound = (slot: StrumSlot) => slot.mode !== "empty";

const makeDefaultWorkspace = (meter: MeterId): WorkspaceState => {
  const config = METER_CONFIG[meter];
  const practice = config.practices[0];
  return {
    selectedId: practice.id,
    slots: cloneSlots(practice.slots),
    customName: `节奏型${config.customStartNumber}`,
    advancedMode: false,
    savedPatterns: [],
    loopItems: [],
    loopEnabled: false,
  };
};

const normalizeWorkspace = (
  meter: MeterId,
  source: Partial<WorkspaceState> | undefined,
): WorkspaceState => {
  const config = METER_CONFIG[meter];
  const fallback = makeDefaultWorkspace(meter);
  return {
    selectedId: source?.selectedId ?? fallback.selectedId,
    slots:
      source?.slots?.length === config.slotCount
        ? normalizeSlots(source.slots, config.slotCount)
        : cloneSlots(fallback.slots),
    customName:
      source?.customName && source.customName !== "我的扫弦"
        ? source.customName
        : fallback.customName,
    advancedMode: Boolean(source?.advancedMode),
    savedPatterns: (source?.savedPatterns ?? []).map((pattern) => ({
      ...pattern,
      advancedMode: Boolean(pattern.advancedMode),
      slots: normalizeSlots(pattern.slots, config.slotCount),
    })),
    loopItems: (source?.loopItems ?? []).map((item) => ({
      id: item.id ?? `loop-${Date.now()}-${Math.random()}`,
      sourceId: item.sourceId ?? item.id ?? "unknown",
    })),
    loopEnabled: Boolean(source?.loopEnabled),
  };
};

const defaultInitialState = (): InitialState => ({
  bpm: 60,
  activeMeter: "fourFour",
  latencyMs: 0,
  fontSize: 2,
  darkMode: true,
  workspaces: {
    fourFour: makeDefaultWorkspace("fourFour"),
    sixEight: makeDefaultWorkspace("sixEight"),
  },
});

const readInitialState = (): InitialState => {
  if (typeof window === "undefined") {
    return defaultInitialState();
  }

  try {
    const stored =
      window.localStorage.getItem(STORAGE_KEY) ??
      LEGACY_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(Boolean);
    if (!stored) {
      return defaultInitialState();
    }
    const parsed = JSON.parse(stored) as Partial<StoredState> & Partial<WorkspaceState>;
    if (parsed.workspaces) {
      return {
        bpm: clampBpm(parsed.bpm ?? 90),
        latencyMs: clampLatency(
          parsed.latencyMs ?? (parsed.workspaces.fourFour as { latencyMs?: number } | undefined)?.latencyMs ?? 0,
        ),
        fontSize: Math.min(4, Math.max(0, Math.round(parsed.fontSize ?? 2))),
        darkMode: Boolean(parsed.darkMode),
        activeMeter: METERS.includes(parsed.activeMeter as MeterId)
          ? (parsed.activeMeter as MeterId)
          : "fourFour",
        workspaces: {
          fourFour: normalizeWorkspace("fourFour", parsed.workspaces.fourFour),
          sixEight: normalizeWorkspace("sixEight", parsed.workspaces.sixEight),
        },
      };
    }
    return {
      bpm: clampBpm(parsed.bpm ?? 90),
      latencyMs: clampLatency(parsed.latencyMs ?? (parsed as { latencyMs?: number }).latencyMs ?? 0),
      fontSize: Math.min(4, Math.max(0, Math.round(parsed.fontSize ?? 2))),
      darkMode: Boolean(parsed.darkMode),
      activeMeter: "fourFour",
      workspaces: {
        fourFour: normalizeWorkspace("fourFour", parsed),
        sixEight: makeDefaultWorkspace("sixEight"),
      },
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return defaultInitialState();
  }
};

function playClick(context: AudioContext, strong: boolean, delay = 0) {
  const now = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(strong ? 1500 : 980, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(strong ? 0.16 : 0.1, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.055);
}

function playMute(context: AudioContext) {
  const now = context.currentTime;
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.04), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(900, now);
  filter.Q.setValueAtTime(5, now);
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(now);
  source.stop(now + 0.05);
}

function playStrum(context: AudioContext, direction: Direction, volume: number, delay = 0) {
  const now = context.currentTime + delay;
  const output = context.createGain();
  output.gain.setValueAtTime(volume, now);
  output.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  output.connect(context.destination);

  const base = direction === "down" ? 164.81 : 220;
  const chord = direction === "down" ? [0, 7, 12, 16] : [16, 12, 7, 0];

  chord.forEach((semitone, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * 0.006;
    oscillator.type = index % 2 === 0 ? "triangle" : "sawtooth";
    oscillator.frequency.setValueAtTime(base * 2 ** (semitone / 12), start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume * 0.18, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
  });
}

function playSlot(context: AudioContext, slot: StrumSlot, strong: boolean, bpm: number) {
  playClick(context, strong);
  if (slot.mode === "mute") {
    playMute(context);
    return;
  }
  if (slot.mode === "double") {
    const thirtySecondDelay = (60 / bpm) / 8;
    playStrum(context, "down", 0.12);
    playClick(context, false, thirtySecondDelay);
    playStrum(context, "up", 0.1, thirtySecondDelay);
    return;
  }
  playStrum(context, slot.direction, strong ? 0.17 : 0.13);
}

function getSlotDisplay(slot: StrumSlot) {
  if (slot.mode === "empty") {
    return { text: "空", className: "empty" };
  }
  if (slot.mode === "mute") {
    return { text: "切", className: "active mute" };
  }
  if (slot.mode === "double") {
    return { text: "下上", className: "active double" };
  }
  return {
    text: directionText[slot.direction],
    className: "active",
  };
}

const getNextSlot = (
  meter: MeterId,
  slot: StrumSlot,
  index: number,
  advancedMode: boolean,
): StrumSlot => {
  const fallbackDirection = getDefaultDirection(index);
  if (meter === "sixEight") {
    if (!advancedMode) {
      if (slot.mode === "empty") {
        return { mode: "normal", direction: "down" };
      }
      if (slot.mode === "normal" && slot.direction === "down") {
        return { mode: "normal", direction: "up" };
      }
      return { mode: "empty", direction: fallbackDirection };
    }
    if (slot.mode === "empty") {
      return { mode: "normal", direction: "down" };
    }
    if (slot.mode === "normal" && slot.direction === "down") {
      return { mode: "mute", direction: "down" };
    }
    if (slot.mode === "mute") {
      return { mode: "normal", direction: "up" };
    }
    if (slot.mode === "normal" && slot.direction === "up") {
      return { mode: "double", direction: "down" };
    }
    return { mode: "empty", direction: fallbackDirection };
  }

  const direction = fallbackDirection;
  if (!advancedMode) {
    return { direction, mode: slot.mode === "empty" ? "normal" : "empty" };
  }
  if (direction === "down") {
    const nextMode =
      slot.mode === "empty" ? "normal" : slot.mode === "normal" ? "mute" : "empty";
    return { direction, mode: nextMode };
  }
  const nextMode =
    slot.mode === "empty" ? "normal" : slot.mode === "normal" ? "double" : "empty";
  return { direction, mode: nextMode };
};

export default function App() {
  const [initialState] = useState(readInitialState);
  const initialWorkspace = initialState.workspaces[initialState.activeMeter];
  const [bpm, setBpm] = useState(initialState.bpm);
  const [bpmInput, setBpmInput] = useState(String(initialState.bpm));
  const [activeMeter, setActiveMeter] = useState<MeterId>(initialState.activeMeter);
  const workspacesRef = useRef(initialState.workspaces);
  const [selectedId, setSelectedId] = useState(initialWorkspace.selectedId);
  const [slots, setSlots] = useState<StrumSlot[]>(initialWorkspace.slots);
  const [customName, setCustomName] = useState(initialWorkspace.customName);
  const [advancedMode, setAdvancedMode] = useState(initialWorkspace.advancedMode);
  const [savedPatterns, setSavedPatterns] = useState<SavedPattern[]>(
    initialWorkspace.savedPatterns,
  );
  const [loopItems, setLoopItems] = useState<LoopItem[]>(initialWorkspace.loopItems);
  const [loopEnabled, setLoopEnabled] = useState(initialWorkspace.loopEnabled);
  const [activeLoopIndex, setActiveLoopIndex] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState(initialState.latencyMs);
  const [latencyInput, setLatencyInput] = useState(String(initialState.latencyMs));
  const [fontSize, setFontSize] = useState(initialState.fontSize);
  const [darkMode, setDarkMode] = useState(initialState.darkMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [transferDialog, setTransferDialog] = useState<"import" | "export" | null>(null);
  const [shareCode, setShareCode] = useState("");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [loopEditorOpen, setLoopEditorOpen] = useState(false);
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationSamples, setCalibrationSamples] = useState<number[]>([]);
  const [calibrationTapState, setCalibrationTapState] = useState<"hit" | "miss" | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [draggingSavedId, setDraggingSavedId] = useState<string | null>(null);
  const [draggingLoopId, setDraggingLoopId] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const visualTimerRef = useRef<number | null>(null);
  const loopVisualTimerRef = useRef<number | null>(null);
  const calibrationTimerRef = useRef<number | null>(null);
  const calibrationTapTimerRef = useRef<number | null>(null);
  const saveFeedbackTimerRef = useRef<number | null>(null);
  const lastCalibrationTapRef = useRef(0);
  const customLongPressTriggeredRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const calibrationClicksRef = useRef<number[]>([]);
  const stepRef = useRef(0);
  const countRef = useRef(3);
  const slotsRef = useRef(slots);
  const loopItemsRef = useRef(loopItems);
  const loopEnabledRef = useRef(loopEnabled);
  const activeLoopIndexRef = useRef<number | null>(null);
  const playbackSlotsRef = useRef(slots);
  const countInSlotsRef = useRef<StrumSlot[] | null>(null);
  const bpmRef = useRef(bpm);
  const latencyRef = useRef(latencyMs);
  const activeMeterRef = useRef(activeMeter);

  const meterConfig = METER_CONFIG[activeMeter];
  const currentPractices = meterConfig.practices;
  const slotCount = meterConfig.slotCount;
  const currentWorkspace = (): WorkspaceState => ({
    selectedId,
    slots: cloneSlots(slots),
    customName,
    advancedMode,
    savedPatterns,
    loopItems,
    loopEnabled,
  });

  const getLoopSource = useCallback(
    (item: LoopItem): Practice | undefined =>
      [...METER_CONFIG[activeMeterRef.current].practices, ...workspacesRef.current[activeMeterRef.current].savedPatterns]
        .find((source) => source.id === item.sourceId),
    [],
  );

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (visualTimerRef.current !== null) {
      window.clearTimeout(visualTimerRef.current);
      visualTimerRef.current = null;
    }
    if (loopVisualTimerRef.current !== null) {
      window.clearTimeout(loopVisualTimerRef.current);
      loopVisualTimerRef.current = null;
    }
  }, []);

  const stopCalibration = useCallback(() => {
    if (calibrationTimerRef.current !== null) {
      window.clearInterval(calibrationTimerRef.current);
      calibrationTimerRef.current = null;
    }
    if (calibrationTapTimerRef.current !== null) {
      window.clearTimeout(calibrationTapTimerRef.current);
      calibrationTapTimerRef.current = null;
    }
    setCalibrationTapState(null);
    setIsCalibrating(false);
  }, []);

  const stop = useCallback(() => {
    const stoppedLoopItem =
      activeLoopIndexRef.current === null
        ? null
        : loopItemsRef.current[activeLoopIndexRef.current] ?? null;
    clearTimers();
    setIsPlaying(false);
    setCountIn(null);
    setPlayhead(null);
    setActiveLoopIndex(null);
    activeLoopIndexRef.current = null;
    playbackSlotsRef.current = slotsRef.current;
    countInSlotsRef.current = null;
    stepRef.current = 0;
    const stoppedLoopSource = stoppedLoopItem ? getLoopSource(stoppedLoopItem) : undefined;
    if (stoppedLoopSource) {
      const nextSlots = cloneSlots(stoppedLoopSource.slots);
      slotsRef.current = nextSlots;
      setSelectedId(stoppedLoopSource.id);
      setCustomName(stoppedLoopSource.name);
      setAdvancedMode(Boolean(stoppedLoopSource.advancedMode));
      setSlots(nextSlots);
    }
  }, [clearTimers, getLoopSource]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    slotsRef.current = slots;
    const nextWorkspaces = {
      ...workspacesRef.current,
      [activeMeter]: currentWorkspace(),
    };
    workspacesRef.current = nextWorkspaces;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        bpm,
        activeMeter,
        latencyMs,
        fontSize,
        darkMode,
        workspaces: nextWorkspaces,
      }),
    );
  }, [activeMeter, advancedMode, bpm, customName, darkMode, fontSize, latencyMs, loopEnabled, loopItems, savedPatterns, selectedId, slots]);

  useEffect(() => {
    activeMeterRef.current = activeMeter;
  }, [activeMeter]);

  useEffect(() => {
    loopItemsRef.current = loopItems;
    if (loopItems.length === 0 && loopEnabled) {
      setLoopEnabled(false);
    }
  }, [loopEnabled, loopItems]);

  useEffect(() => {
    loopEnabledRef.current = loopEnabled;
  }, [loopEnabled]);

  useEffect(() => {
    bpmRef.current = bpm;
    setBpmInput(String(bpm));
  }, [bpm]);

  useEffect(() => {
    latencyRef.current = latencyMs;
    setLatencyInput(String(latencyMs));
  }, [latencyMs]);

  useEffect(() => {
    // Apply the display preference at the document root so rem-based controls scale together.
    const root = document.documentElement;
    root.style.fontSize = `${[14, 15, 16, 17, 18][fontSize]}px`;
    return () => {
      root.style.fontSize = "";
    };
  }, [fontSize]);

  useEffect(
    () => () => {
      clearTimers();
      clearLongPressTimer();
      stopCalibration();
      if (calibrationTapTimerRef.current !== null) {
        window.clearTimeout(calibrationTapTimerRef.current);
      }
      if (saveFeedbackTimerRef.current !== null) {
        window.clearTimeout(saveFeedbackTimerRef.current);
      }
    },
    [clearTimers, stopCalibration],
  );

  const displaySlots =
    activeLoopIndex !== null && loopItems[activeLoopIndex] && getLoopSource(loopItems[activeLoopIndex])
      ? getLoopSource(loopItems[activeLoopIndex])!.slots
      : slots;

  const beatGroups = useMemo(
    () =>
      Array.from({ length: meterConfig.beatCount }, (_, beat) => ({
        beat,
        slots: displaySlots.slice(
          beat * meterConfig.stepsPerStrongBeat,
          beat * meterConfig.stepsPerStrongBeat + meterConfig.stepsPerStrongBeat,
        ),
      })),
    [displaySlots, meterConfig.beatCount, meterConfig.stepsPerStrongBeat],
  );

  const schedulePatternStep = useCallback(() => {
    const context = audioContextRef.current;
    if (!context) {
      return;
    }

    const step = stepRef.current;
    const slot = playbackSlotsRef.current[step];
    if (hasSound(slot)) {
      const visualDelayMs = latencyRef.current - VISUAL_LEAD_MS;
      if (visualDelayMs <= 0) {
        setPlayhead(step);
      } else {
        visualTimerRef.current = window.setTimeout(() => {
          setPlayhead(step);
          visualTimerRef.current = null;
        }, visualDelayMs);
      }
      const config = METER_CONFIG[activeMeterRef.current];
      playSlot(context, slot, step % config.stepsPerStrongBeat === 0, bpmRef.current);
    }

    const config = METER_CONFIG[activeMeterRef.current];
    const nextStep = (step + 1) % config.slotCount;
    if (nextStep === 0 && loopEnabledRef.current && loopItemsRef.current.length > 0) {
      const nextLoopIndex =
        activeLoopIndexRef.current === null
          ? 0
          : (activeLoopIndexRef.current + 1) % loopItemsRef.current.length;
      const stepDuration = (60_000 / bpmRef.current) / 4;
      const loopVisualDelay = stepDuration + Math.max(0, latencyRef.current - VISUAL_LEAD_MS);
      if (loopVisualTimerRef.current !== null) {
        window.clearTimeout(loopVisualTimerRef.current);
      }
      loopVisualTimerRef.current = window.setTimeout(() => {
        setActiveLoopIndex(nextLoopIndex);
        loopVisualTimerRef.current = null;
      }, loopVisualDelay);
      timerRef.current = window.setTimeout(() => {
        activeLoopIndexRef.current = nextLoopIndex;
        const nextLoopSource = getLoopSource(loopItemsRef.current[nextLoopIndex]);
        playbackSlotsRef.current = nextLoopSource?.slots ?? slotsRef.current;
        stepRef.current = 0;
        schedulePatternStep();
      }, stepDuration);
      return;
    }
    stepRef.current = nextStep;
    timerRef.current = window.setTimeout(
      schedulePatternStep,
      (60_000 / bpmRef.current) / 4,
    );
  }, []);

  const scheduleCountIn = useCallback(() => {
    const context = audioContextRef.current;
    if (!context) {
      return;
    }

    const count = countRef.current;
    setCountIn(count);
    playClick(context, count === 3);

    if (count <= 1) {
      timerRef.current = window.setTimeout(() => {
        setCountIn(null);
        stepRef.current = 0;
        const countInSlots = countInSlotsRef.current;
        countInSlotsRef.current = null;
        if (countInSlots) {
          activeLoopIndexRef.current = null;
          playbackSlotsRef.current = countInSlots;
          setActiveLoopIndex(null);
        } else if (loopEnabledRef.current && loopItemsRef.current.length > 0) {
          activeLoopIndexRef.current = 0;
          playbackSlotsRef.current = getLoopSource(loopItemsRef.current[0])?.slots ?? slotsRef.current;
          setActiveLoopIndex(0);
        } else {
          activeLoopIndexRef.current = null;
          playbackSlotsRef.current = slotsRef.current;
          setActiveLoopIndex(null);
        }
        schedulePatternStep();
      }, 60_000 / bpmRef.current);
      return;
    }

    countRef.current = count - 1;
    timerRef.current = window.setTimeout(scheduleCountIn, 60_000 / bpmRef.current);
  }, [getLoopSource, schedulePatternStep]);

  const togglePlayback = async () => {
    if (isPlaying) {
      stop();
      return;
    }
    stopCalibration();
    await ensureAudioContext();
    clearTimers();
    setIsPlaying(true);
    setPlayhead(null);
    setActiveLoopIndex(null);
    activeLoopIndexRef.current = null;
    const firstLoopItem = loopEnabled && loopItems.length > 0 ? loopItems[0] : null;
    const firstLoopSource = firstLoopItem ? getLoopSource(firstLoopItem) : undefined;
    if (firstLoopSource) {
      const nextSlots = cloneSlots(firstLoopSource.slots);
      slotsRef.current = nextSlots;
      setSelectedId(firstLoopSource.id);
      setCustomName(firstLoopSource.name);
      setAdvancedMode(Boolean(firstLoopSource.advancedMode));
      setSlots(nextSlots);
      playbackSlotsRef.current = nextSlots;
    } else {
      playbackSlotsRef.current = slotsRef.current;
    }
    stepRef.current = 0;
    countRef.current = 3;
    scheduleCountIn();
  };

  const playSlotsFromStart = (nextSlots: StrumSlot[]) => {
    clearTimers();
    setPlayhead(null);
    setActiveLoopIndex(null);
    activeLoopIndexRef.current = null;
    countInSlotsRef.current = nextSlots;
    stepRef.current = 0;
    countRef.current = 3;
    scheduleCountIn();
  };

  const loadPractice = (practice: Practice) => {
    const nextSlots = cloneSlots(practice.slots);
    if (isPlaying) {
      if (loopEnabledRef.current && loopItemsRef.current.length > 0) {
        stop();
      } else {
        playSlotsFromStart(nextSlots);
      }
    } else {
      stop();
    }
    setActiveLoopIndex(null);
    setSelectedId(practice.id);
    setCustomName(practice.name);
    setAdvancedMode(Boolean(practice.advancedMode));
    slotsRef.current = nextSlots;
    setSlots(nextSlots);
  };

  const switchMeter = (nextMeter: MeterId) => {
    if (nextMeter === activeMeter) {
      return;
    }
    stop();
    setCustomEditorOpen(false);
    setLoopEditorOpen(false);
    setSaveFeedback(false);
    const nextWorkspaces = {
      ...workspacesRef.current,
      [activeMeter]: currentWorkspace(),
    };
    const nextWorkspace = normalizeWorkspace(
      nextMeter,
      nextWorkspaces[nextMeter] ?? makeDefaultWorkspace(nextMeter),
    );
    nextWorkspaces[nextMeter] = nextWorkspace;
    workspacesRef.current = nextWorkspaces;
    activeMeterRef.current = nextMeter;
    slotsRef.current = nextWorkspace.slots;
    loopItemsRef.current = nextWorkspace.loopItems;
    loopEnabledRef.current = nextWorkspace.loopEnabled;
    setActiveMeter(nextMeter);
    setSelectedId(nextWorkspace.selectedId);
    setSlots(nextWorkspace.slots);
    setCustomName(nextWorkspace.customName);
    setAdvancedMode(nextWorkspace.advancedMode);
    setSavedPatterns(nextWorkspace.savedPatterns);
    setLoopItems(nextWorkspace.loopItems);
    setLoopEnabled(nextWorkspace.loopEnabled);
    setActiveLoopIndex(null);
    setPlayhead(null);
  };

  const getNextPatternName = (patterns = savedPatterns) => {
    const usedNumbers = new Set(
      patterns
        .map((pattern) => /^节奏型(\d+)$/.exec(pattern.name)?.[1])
        .filter((value): value is string => Boolean(value))
        .map((value) => Number(value)),
    );
    let next = meterConfig.customStartNumber;
    while (usedNumbers.has(next)) {
      next += 1;
    }
    return `节奏型${next}`;
  };

  const startNewCustom = (nextSlots = makeEmptySlots(slotCount)) => {
    stop();
    setPlayhead(null);
    setSelectedId("custom");
    setCustomName(getNextPatternName());
    setAdvancedMode(false);
    slotsRef.current = nextSlots;
    setSlots(nextSlots);
  };

  const toggleSlot = (index: number) => {
    if (meterConfig.lockedIds.has(selectedId)) {
      return;
    }
    if (!isPlaying) {
      setPlayhead(null);
    }
    if (selectedId !== "custom" && !selectedId.startsWith("saved-")) {
      setSelectedId("custom");
      setCustomName(getNextPatternName());
      setAdvancedMode(false);
    }
    setSlots((current) => {
      const nextSlots: StrumSlot[] = current.map((slot, slotIndex): StrumSlot => {
        if (slotIndex !== index) {
          return slot;
        }
        return getNextSlot(activeMeter, slot, slotIndex, advancedMode);
      });
      slotsRef.current = nextSlots;
      if (isPlaying && activeLoopIndexRef.current === null) {
        playbackSlotsRef.current = nextSlots;
      }
      return nextSlots;
    });
  };

  const clearCustom = () => {
    startNewCustom();
  };

  const saveExistingCustom = () => {
    if (!selectedId.startsWith("saved-")) {
      return;
    }
    const name = customName.trim() || "未命名扫弦";
    const pattern: SavedPattern = {
      id: selectedId,
      name,
      advancedMode,
      slots: cloneSlots(slots),
    };
    setCustomName(name);
    setSavedPatterns((current) =>
      current.map((item) => (item.id === selectedId ? pattern : item)),
    );
    if (saveFeedbackTimerRef.current !== null) {
      window.clearTimeout(saveFeedbackTimerRef.current);
    }
    setSaveFeedback(true);
    saveFeedbackTimerRef.current = window.setTimeout(() => {
      setSaveFeedback(false);
      saveFeedbackTimerRef.current = null;
    }, 900);
  };

  const saveCustomAs = () => {
    const name = getNextPatternName();
    const id = `saved-${Date.now()}`;
    const pattern: SavedPattern = {
      id,
      name,
      advancedMode,
      slots: cloneSlots(slots),
    };
    setSelectedId(id);
    setCustomName(name);
    setSaveFeedback(false);
    setSavedPatterns((current) => [...current, pattern]);
  };

  const addLoopItem = (source: Practice) => {
    stop();
    setLoopEditorOpen(true);
    setLoopItems((current) => [
      ...current,
      {
        id: `loop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sourceId: source.id,
      },
    ]);
  };

  const previewLoopItem = (item: LoopItem) => {
    if (isPlaying) {
      stop();
    }
    const source = getLoopSource(item);
    if (!source) {
      return;
    }
    const nextSlots = cloneSlots(source.slots);
    slotsRef.current = nextSlots;
    setSelectedId(source.id);
    setCustomName(source.name);
    setAdvancedMode(Boolean(source.advancedMode));
    setSlots(nextSlots);
  };

  const removeLoopItem = (id: string) => {
    stop();
    setLoopItems((current) => current.filter((item) => item.id !== id));
  };

  const clearLoopItems = () => {
    stop();
    setLoopItems([]);
    setLoopEnabled(false);
  };

  const reorderSavedPatterns = (fromId: string, toId: string) => {
    if (fromId === toId) {
      return;
    }
    setSavedPatterns((current) => {
      const fromIndex = current.findIndex((item) => item.id === fromId);
      const toIndex = current.findIndex((item) => item.id === toId);
      if (fromIndex < 0 || toIndex < 0) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const reorderLoopItems = (fromId: string, toId: string) => {
    if (fromId === toId) {
      return;
    }
    setLoopItems((current) => {
      const fromIndex = current.findIndex((item) => item.id === fromId);
      const toIndex = current.findIndex((item) => item.id === toId);
      if (fromIndex < 0 || toIndex < 0) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const beginLongPressDrag = (
    id: string,
    setDraggingId: (id: string | null) => void,
  ) => {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      stop();
      setDraggingId(id);
      longPressTimerRef.current = null;
    }, 220);
  };

  const endDrag = (setDraggingId: (id: string | null) => void) => {
    clearLongPressTimer();
    setDraggingId(null);
  };

  const beginCustomEditorPress = () => {
    clearLongPressTimer();
    customLongPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      customLongPressTriggeredRef.current = true;
      setCustomEditorOpen(true);
      longPressTimerRef.current = null;
    }, 420);
  };

  const endCustomEditorPress = () => {
    clearLongPressTimer();
  };

  const deleteSaved = (id: string) => {
    stop();
    setSavedPatterns((current) => current.filter((pattern) => pattern.id !== id));
    setLoopItems((current) => current.filter((item) => item.sourceId !== id));
    if (selectedId === id) {
      const remainingPatterns = savedPatterns.filter((pattern) => pattern.id !== id);
      setSelectedId("custom");
      setCustomName(getNextPatternName(remainingPatterns));
      setAdvancedMode(false);
      const emptySlots = makeEmptySlots(slotCount);
      slotsRef.current = emptySlots;
      setSlots(emptySlots);
    }
  };

  const createBackupPayload = () => {
    const allWorkspaces = {
      ...workspacesRef.current,
      [activeMeter]: currentWorkspace(),
    };
    return {
      version: 1,
      activeMeter,
      fontSize,
      darkMode,
      workspaces: allWorkspaces,
    };
  };

  const applyBackupPayload = (parsed: Partial<StoredState> & { workspaces?: StoredState["workspaces"] }) => {
    if (!parsed.workspaces) return false;
    const nextMeter = METERS.includes(parsed.activeMeter as MeterId)
      ? (parsed.activeMeter as MeterId)
      : activeMeter;
    const nextWorkspaces = {
      fourFour: normalizeWorkspace("fourFour", parsed.workspaces.fourFour),
      sixEight: normalizeWorkspace("sixEight", parsed.workspaces.sixEight),
    };
    const nextWorkspace = nextWorkspaces[nextMeter];
    stop();
    workspacesRef.current = nextWorkspaces;
    activeMeterRef.current = nextMeter;
    slotsRef.current = nextWorkspace.slots;
    loopItemsRef.current = nextWorkspace.loopItems;
    loopEnabledRef.current = nextWorkspace.loopEnabled;
    setFontSize(Math.min(4, Math.max(0, Math.round(parsed.fontSize ?? 2))));
    setDarkMode(Boolean(parsed.darkMode));
    setActiveMeter(nextMeter);
    setSelectedId(nextWorkspace.selectedId);
    setSlots(nextWorkspace.slots);
    setCustomName(nextWorkspace.customName);
    setAdvancedMode(nextWorkspace.advancedMode);
    setSavedPatterns(nextWorkspace.savedPatterns);
    setLoopItems(nextWorkspace.loopItems);
    setLoopEnabled(nextWorkspace.loopEnabled);
    return true;
  };

  const exportPattern = async () => {
    const payload = createBackupPayload();
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    const filename = `strum-backup-${timestamp}.json`;
    const data = JSON.stringify(payload, null, 2);

    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importPattern = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<StoredState> & {
        name?: string;
        advancedMode?: boolean;
        slots?: StrumSlot[];
      };
      if (applyBackupPayload(parsed)) {
        return;
      }
      if (!parsed.slots || parsed.slots.length !== slotCount) {
        return;
      }
      stop();
      setSelectedId("custom");
      setCustomName(parsed.name ?? "导入扫弦");
      setAdvancedMode(Boolean(parsed.advancedMode));
      setSlots(normalizeSlots(parsed.slots, slotCount, true));
    } catch {
      return;
    }
  };

  const createShareCode = async () => {
    setShareBusy(true);
    setShareStatus(null);
    try {
      const response = await fetch(shareApiUrl("create-share"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: createBackupPayload() }),
      });
      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token) throw new Error(result.error ?? "生成分享口令失败。");
      const message = `这是来自「Guitar Mate」的扫弦配置分享，30分钟内有效。分享口令为「${result.token}」`;
      await navigator.clipboard?.writeText(message);
      setShareCode(result.token);
      setShareStatus("分享口令已复制，有效期 30 分钟。");
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "生成分享口令失败。");
    } finally {
      setShareBusy(false);
    }
  };

  const importShareCode = async () => {
    const token = shareCode.match(/[a-f0-9]{32}/i)?.[0];
    if (!token) {
      setShareStatus("请粘贴有效的 32 位分享口令。");
      return;
    }
    setShareBusy(true);
    setShareStatus(null);
    try {
      const response = await fetch(shareApiUrl("import-share"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json() as { payload?: Partial<StoredState>; error?: string };
      if (!response.ok || !result.payload || !applyBackupPayload(result.payload)) {
        throw new Error(result.error ?? "导入分享口令失败。");
      }
      setShareStatus("配置已导入。");
      setShareCode("");
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "导入分享口令失败。");
    } finally {
      setShareBusy(false);
    }
  };

  const startCalibration = async () => {
    stop();
    stopCalibration();
    const context = await ensureAudioContext();
    calibrationClicksRef.current = [];
    setCalibrationSamples([]);
    setIsCalibrating(true);

    const fireClick = () => {
      calibrationClicksRef.current = [...calibrationClicksRef.current, performance.now()].slice(-12);
      playClick(context, true);
    };

    fireClick();
    calibrationTimerRef.current = window.setInterval(fireClick, CALIBRATION_INTERVAL_MS);
  };

  const flashCalibrationTap = (state: "hit" | "miss") => {
    if (calibrationTapTimerRef.current !== null) {
      window.clearTimeout(calibrationTapTimerRef.current);
    }
    setCalibrationTapState(state);
    calibrationTapTimerRef.current = window.setTimeout(() => {
      setCalibrationTapState(null);
      calibrationTapTimerRef.current = null;
    }, 130);
  };

  const captureCalibrationTap = () => {
    if (!isCalibrating) {
      return;
    }
    const now = performance.now();
    if (now - lastCalibrationTapRef.current < 90) {
      flashCalibrationTap("miss");
      return;
    }
    lastCalibrationTapRef.current = now;
    const latestClick = [...calibrationClicksRef.current]
      .reverse()
      .find((clickTime) => now - clickTime >= 0 && now - clickTime <= CALIBRATION_VALID_WINDOW_MS);
    if (latestClick === undefined) {
      flashCalibrationTap("miss");
      return;
    }
    const sample = now - latestClick;
    flashCalibrationTap("hit");
    setCalibrationSamples((current) => {
      const nextSamples = [...current, sample].slice(-8);
      if (nextSamples.length >= 5) {
        const sorted = [...nextSamples].sort((a, b) => a - b);
        const trimmed = sorted.slice(1, -1);
        const average =
          trimmed.reduce((sum, value) => sum + value, 0) / Math.max(1, trimmed.length);
        setLatencyMs(clampLatency(average));
        window.setTimeout(stopCalibration, 0);
      }
      return nextSamples;
    });
  };

  const handleCalibrationPress = async () => {
    if (isCalibrating) {
      captureCalibrationTap();
      return;
    }
    flashCalibrationTap("hit");
    await startCalibration();
  };

  const resetLatency = () => {
    stopCalibration();
    setCalibrationSamples([]);
    setLatencyMs(0);
  };

  const adjustLatency = (delta: number) => {
    setLatencyMs((current) => clampLatency(current + delta));
  };

  const commitBpmInput = () => {
    const value = Number(bpmInput);
    if (Number.isFinite(value) && value >= 40 && value <= 220) {
      setBpm(Math.round(value));
    } else {
      setBpmInput(String(bpm));
    }
  };

  const commitLatencyInput = () => {
    const value = Number(latencyInput);
    if (Number.isFinite(value) && value >= -500 && value <= 1000) {
      setLatencyMs(Math.round(value));
    } else {
      setLatencyInput(String(latencyMs));
    }
  };

  const changeAdvancedMode = (enabled: boolean) => {
    setAdvancedMode(enabled);
    if (selectedId.startsWith("saved-")) {
      setSavedPatterns((current) =>
        current.map((pattern) =>
          pattern.id === selectedId ? { ...pattern, advancedMode: enabled } : pattern,
        ),
      );
    }
  };

  const changeCustomName = (name: string) => {
    setCustomName(name);
  };

  const clearConfiguration = () => {
    window.localStorage.clear();
    window.location.reload();
  };

  const customSelected = isCustomId(selectedId);
  const lockedSlots =
    meterConfig.lockedIds.has(selectedId) ||
    activeLoopIndex !== null ||
    (isPlaying && loopEnabled && loopItems.length > 0);
  const loopSources = [...currentPractices, ...savedPatterns];

  useEffect(() => {
    const hasOverlay = settingsOpen || clearConfirmOpen || transferDialog !== null || calibrationOpen || loopEditorOpen || customEditorOpen;
    if (!hasOverlay) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [calibrationOpen, clearConfirmOpen, customEditorOpen, loopEditorOpen, settingsOpen, transferDialog]);

  return (
    <main className={["app-shell", darkMode ? "dark-mode" : ""].join(" ")} data-font-size={fontSize}>
      <section className="topbar">
        <button
          className="settings-toggle"
          type="button"
          title="显示设置"
          aria-label="显示设置"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={21} />
        </button>
        <div className="title-trigger">
          <p>STRUMMING MATE</p>
          <h1>扫弦跟练器</h1>
        </div>
        <div className="top-actions">
          <button
            className="calibration-toggle"
            type="button"
            onClick={() => {
              setCalibrationOpen((open) => {
                if (open) {
                  stopCalibration();
                }
                return !open;
              });
            }}
          >
            延迟校准
            <span>{latencyMs}ms</span>
          </button>
          <button
            className="play-button"
            type="button"
            aria-label={isPlaying ? "暂停" : "播放"}
            title={isPlaying ? "暂停" : "播放"}
            onClick={togglePlayback}
          >
            {isPlaying ? <Pause size={22} /> : <Play size={22} />}
          </button>
        </div>
      </section>

      {settingsOpen ? (
        <div className="overlay" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="floating-panel settings-panel"
            aria-label="显示设置"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="floating-header">
              <div>
                <strong>显示设置</strong>
                <span>调整练习时的阅读体验</span>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <strong>字号</strong>
                <span>{FONT_SIZE_OPTIONS[fontSize]}</span>
              </div>
              <input
                className="font-size-slider"
                type="range"
                min="0"
                max="4"
                step="1"
                value={fontSize}
                aria-label="字号"
                onChange={(event) => setFontSize(Number(event.target.value))}
              />
              <div className="font-size-labels" aria-hidden="true">
                {FONT_SIZE_OPTIONS.map((label) => <span key={label}>{label}</span>)}
              </div>
            </div>
            <div className="settings-row settings-switch-row">
              <div>
                <strong>深色模式</strong>
                <span>{darkMode ? "夜间配色已启用" : "使用清新浅色配色"}</span>
              </div>
              <button
                className={["capsule-switch", darkMode ? "on" : ""].join(" ")}
                type="button"
                role="switch"
                aria-checked={darkMode}
                onClick={() => setDarkMode((enabled) => !enabled)}
              >
                <span>{darkMode ? "开" : "关"}</span>
              </button>
            </div>
            <div className="settings-row settings-actions-row">
              <strong>配置</strong>
              <div className="settings-actions">
                <button className="settings-clear" type="button" title="清空配置" aria-label="清空配置" onClick={() => setClearConfirmOpen(true)}>
                  <Eraser size={19} />
                </button>
                <button type="button" title="导入配置" aria-label="导入配置" onClick={() => setTransferDialog("import")}>
                  <Download size={19} />
                </button>
                <button type="button" title="导出配置" aria-label="导出配置" onClick={() => setTransferDialog("export")}>
                  <Upload size={19} />
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {transferDialog ? (
        <div className="overlay" role="presentation" onClick={() => { setTransferDialog(null); setShareStatus(null); }}>
          <section
            className="floating-panel transfer-panel"
            role="dialog"
            aria-modal="true"
            aria-label={transferDialog === "import" ? "导入配置" : "导出配置"}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="floating-header">
              <div>
                <strong>{transferDialog === "import" ? "导入配置" : "导出配置"}</strong>
                <span>选择备份文件或分享口令</span>
              </div>
            </div>
            {transferDialog === "import" ? (
              <div className="transfer-options">
                <label className="transfer-option">
                  <Download size={20} />
                  <span>从备份文件导入</span>
                  <input
                    type="file"
                    accept="application/json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void importPattern(file);
                        setTransferDialog(null);
                      }
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <div className="share-code-entry">
                  <input
                    value={shareCode}
                    onChange={(event) => setShareCode(event.target.value)}
                    placeholder="粘贴分享口令"
                    aria-label="分享口令"
                  />
                  <button type="button" disabled={!shareCode.trim() || shareBusy} onClick={() => void importShareCode()}>
                    {shareBusy ? "导入中..." : "从分享口令导入"}
                  </button>
                </div>
                {shareStatus ? <p className="share-status">{shareStatus}</p> : null}
              </div>
            ) : (
              <div className="transfer-options">
                <button className="transfer-option" type="button" onClick={() => {
                  void exportPattern();
                  setTransferDialog(null);
                }}>
                  <Upload size={20} />
                  <span>导出备份文件</span>
                </button>
                <button className="transfer-option" type="button" disabled={shareBusy} onClick={() => void createShareCode()}>
                  {shareBusy ? "生成中..." : "生成分享口令"}
                </button>
                {shareStatus ? <p className="share-status">{shareStatus}</p> : null}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {clearConfirmOpen ? (
        <div className="overlay confirmation-overlay" role="presentation" onClick={() => setClearConfirmOpen(false)}>
          <section
            className="floating-panel confirmation-panel"
            role="dialog"
            aria-modal="true"
            aria-label="确认清空配置"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="floating-header">
              <div>
                <strong>初始化配置？</strong>
                <span>将清除所有本地数据并恢复默认状态。</span>
              </div>
            </div>
            <div className="confirmation-actions">
              <button type="button" onClick={() => setClearConfirmOpen(false)}>取消</button>
              <button className="danger-button" type="button" onClick={clearConfiguration}>确认清空</button>
            </div>
          </section>
        </div>
      ) : null}

      {calibrationOpen ? (
        <div className="overlay" role="presentation" onClick={() => {
          stopCalibration();
          setCalibrationOpen(false);
        }}>
          <section
            className="floating-panel calibration-panel"
            aria-label="延迟校准"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className={["calibration-orb", calibrationTapState ? `tap-${calibrationTapState}` : ""].join(" ")}
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                void handleCalibrationPress();
              }}
            >
              <strong>{latencyMs}ms</strong>
              <span>{isCalibrating ? "随节奏点击" : "开始校准"}</span>
            </button>

            <div className="latency-editor" aria-label="调整延迟">
              <div className="latency-stepper">
                <button type="button" title="减少 20ms" aria-label="减少 20ms" onClick={() => adjustLatency(-20)}>
                  <Minus size={17} />
                </button>
                <label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={latencyInput}
                  onChange={(event) => setLatencyInput(event.target.value)}
                  onBlur={commitLatencyInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                />
                </label>
                <button type="button" title="增加 20ms" aria-label="增加 20ms" onClick={() => adjustLatency(20)}>
                  <Plus size={17} />
                </button>
              </div>
              <button className="icon-button latency-reset" type="button" title="重置为 0" aria-label="重置为 0" onClick={resetLatency}>
                <RotateCcw size={18} />
              </button>
            </div>

            <div className="calibration-progress">
              <div>
                <span style={{ width: `${Math.min(100, (calibrationSamples.length / 5) * 100)}%` }} />
              </div>
              <small>{isCalibrating ? `已采样 ${calibrationSamples.length}/5` : "点击大按钮开始校准"}</small>
            </div>
          </section>
        </div>
      ) : null}

      <section className="controls" aria-label="速度和分享">
        <label className="bpm-control">
          <span>BPM</span>
          <input
            type="number"
            inputMode="numeric"
            value={bpmInput}
            onChange={(event) => setBpmInput(event.target.value)}
            onBlur={commitBpmInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <input
          className="bpm-range"
          type="range"
          min={40}
          max={220}
          value={bpm}
          onChange={(event) => setBpm(clampBpm(Number(event.target.value)))}
        />
        <div className="quick-row">
          <div className="bpm-presets" aria-label="BPM 快捷按钮">
            {QUICK_BPMS.map((value) => (
              <button
                key={value}
                className={bpm === value ? "selected" : ""}
                type="button"
                onClick={() => setBpm(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="meter-switch" aria-label="拍号类型">
        {METERS.map((meter) => (
          <button
            key={meter}
            className={activeMeter === meter ? "selected" : ""}
            type="button"
            onClick={() => switchMeter(meter)}
          >
            {METER_CONFIG[meter].name}
          </button>
        ))}
      </section>

      <section className={["meter-workspace", `meter-${activeMeter}`].join(" ")}>
      <section className="practice-tabs" aria-label="常用练习">
        {currentPractices.map((practice) => (
          <button
            key={practice.id}
            className={selectedId === practice.id ? "selected" : ""}
            type="button"
            onClick={() => loadPractice(practice)}
          >
            {practice.name}
          </button>
        ))}
        {savedPatterns.map((pattern) => (
          <button
            key={pattern.id}
            className={selectedId === pattern.id ? "selected" : ""}
            type="button"
            onClick={() => loadPractice(pattern)}
          >
            {pattern.name}
          </button>
        ))}
        <button
          className={[selectedId === "custom" ? "selected" : "", "custom-entry"].join(" ")}
          type="button"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const inEditHotspot = event.clientX >= rect.right - 28 && event.clientY >= rect.bottom - 28;
            if (inEditHotspot) {
              setCustomEditorOpen(true);
              return;
            }
            clearCustom();
          }}
        >
            自定义
          <Pencil className="custom-edit-badge" size={12} aria-hidden="true" />
        </button>
      </section>

      {customSelected ? (
        <section className="custom-panel" aria-label="自定义扫弦">
          <input
            className="name-input"
            value={customName}
            onChange={(event) => changeCustomName(event.target.value)}
            placeholder="给这个练习取个名字"
          />
          <div className="mode-switch">
            <button
              className={['capsule-switch compact', advancedMode ? 'on' : ''].join(' ')}
              type="button"
              role="switch"
              aria-checked={advancedMode}
              onClick={() => changeAdvancedMode(!advancedMode)}
            >
              <span>{advancedMode ? '开' : '关'}</span>
            </button>
            切音/32分
          </div>
          <div className="custom-actions">
            <button
              className={["save-button secondary", saveFeedback ? "saved" : ""].join(" ")}
              type="button"
              disabled={!selectedId.startsWith("saved-")}
              onClick={saveExistingCustom}
            >
              {saveFeedback ? <Check size={18} /> : <Save size={18} />}
              {saveFeedback ? "已保存" : "保存"}
            </button>
            <button className="save-button" type="button" onClick={saveCustomAs}>
              <Save size={18} />
              另存
            </button>
          </div>
        </section>
      ) : null}

      {customEditorOpen ? (
        <div className="overlay" role="presentation" onClick={() => setCustomEditorOpen(false)}>
          <section
            className="floating-panel custom-editor-panel"
            aria-label="编辑自定义节奏"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="floating-header">
              <div>
                <strong>编辑自定义</strong>
                <span>{savedPatterns.length > 0 ? "长按条目可拖动排序" : "暂无自定义节奏型"}</span>
              </div>
            </div>
            {savedPatterns.length > 0 ? (
              <div className="saved-list saved-editor-list">
                {savedPatterns.map((pattern) => (
                  <div
                    className={[
                      "saved-item",
                      draggingSavedId === pattern.id ? "dragging" : "",
                    ].join(" ")}
                    draggable={draggingSavedId === pattern.id}
                    key={pattern.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", pattern.id);
                    }}
                    onDragOver={(event) => {
                      if (draggingSavedId) {
                        event.preventDefault();
                        reorderSavedPatterns(draggingSavedId, pattern.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      endDrag(setDraggingSavedId);
                    }}
                    onDragEnd={() => endDrag(setDraggingSavedId)}
                    onPointerDown={() => beginLongPressDrag(pattern.id, setDraggingSavedId)}
                    onPointerLeave={clearLongPressTimer}
                    onPointerUp={() => {
                      if (!draggingSavedId) {
                        clearLongPressTimer();
                      }
                    }}
                  >
                    <button
                      className={selectedId === pattern.id ? "selected saved-load" : "saved-load"}
                      type="button"
                      onClick={() => loadPractice(pattern)}
                    >
                      {pattern.name}
                    </button>
                    <button
                      className="delete-button"
                      type="button"
                      title="删除"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteSaved(pattern.id);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="loop-empty">另存当前节奏后会出现在这里。</p>
            )}
          </section>
        </div>
      ) : null}

      {countIn !== null ? <div className="count-in">{countIn}</div> : null}

      <section className={["strum-board", `strum-board-${activeMeter}`].join(" ")} aria-label="扫弦格">
        {beatGroups.map((group) => (
          <article className="beat-card" key={group.beat}>
            {activeMeter === "fourFour" ? <h2>{BEAT_NAMES[group.beat]}</h2> : null}
            <div className="beat-slots">
              {group.slots.map((slot, slotOffset) => {
                const index = group.beat * meterConfig.stepsPerStrongBeat + slotOffset;
                const activePlayhead = playhead === index;
                const display = getSlotDisplay(slot);
                const isDouble = slot.mode === "double";
                return (
                  <button
                    key={index}
                    className={[
                      "strum-slot",
                      display.className,
                      activePlayhead ? "playing" : "",
                      lockedSlots ? "locked" : "",
                    ].join(" ")}
                    type="button"
                    disabled={lockedSlots}
                    onClick={() => toggleSlot(index)}
                    aria-pressed={slot.mode !== "empty"}
                  >
                    {slot.mode === "empty" ? (
                      <span className="empty-mark">空</span>
                    ) : (
                      <span className="slot-content">
                        {isDouble ? (
                          <span className="double-arrows">
                            <span>{directionArrow.down}</span>
                            <span>{directionArrow.up}</span>
                          </span>
                        ) : (
                          <span className="arrow">
                            {slot.mode === "mute" ? "×" : directionArrow[slot.direction]}
                          </span>
                        )}
                        <span className="slot-text">{display.text}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </section>

      <section className="loop-panel" aria-label="循环列表">
        <div className="loop-header">
          <div>
            <strong>循环列表</strong>
            <span>{loopItems.length > 0 ? `${loopItems.length} 个节奏型` : "未添加"}</span>
          </div>
          <div className="loop-tools">
            <button
              className={["capsule-switch", loopEnabled ? "on" : ""].join(" ")}
              type="button"
              role="switch"
              aria-checked={loopEnabled}
              disabled={loopItems.length === 0}
              onClick={() => {
                stop();
                setLoopEnabled((enabled) => !enabled);
              }}
            >
              <span>{loopEnabled ? '开' : '关'}</span>
            </button>
            <button type="button" onClick={() => setLoopEditorOpen(true)}>
              <Pencil size={16} />
              编辑
            </button>
          </div>
        </div>

        {loopItems.length > 0 ? (
          <div className="loop-list loop-preview">
            {loopItems.map((item, index) => (
              (() => {
                const source = getLoopSource(item);
                return source ? (
                  <button
                    className={["loop-item", activeLoopIndex === index ? "active" : ""].join(" ")}
                    type="button"
                    key={item.id}
                    onClick={() => previewLoopItem(item)}
                  >
                    <span>{index + 1}</span>
                    <strong>{source.name}</strong>
                  </button>
                ) : null;
              })()
            ))}
          </div>
        ) : (
          <p className="loop-empty">点击编辑添加循环项。</p>
        )}
      </section>

      {loopEditorOpen ? (
        <div className="overlay" role="presentation" onClick={() => setLoopEditorOpen(false)}>
          <section
            className="floating-panel loop-editor-panel"
            aria-label="编辑循环列表"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="floating-header">
              <div>
                <strong>编辑循环</strong>
                <span>{loopItems.length > 0 ? "长按条目可拖动排序" : "从下方添加节奏型"}</span>
              </div>
              <button
                className="icon-button"
                type="button"
                title="关闭"
                onClick={() => setLoopEditorOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="loop-source-list" aria-label="添加到循环列表">
              {loopSources.map((source) => (
                <button key={source.id} type="button" onClick={() => addLoopItem(source)}>
                  + {source.name}
                </button>
              ))}
            </div>

            <div className="loop-editor-actions">
              <button type="button" disabled={loopItems.length === 0} onClick={clearLoopItems}>
                清空列表
              </button>
            </div>

            {loopItems.length > 0 ? (
              <div className="loop-list">
                {loopItems.map((item, index) => (
                  (() => {
                    const source = getLoopSource(item);
                    return source ? (
                  <div
                    className={[
                      "loop-item",
                      activeLoopIndex === index ? "active" : "",
                      draggingLoopId === item.id ? "dragging" : "",
                    ].join(" ")}
                    draggable={draggingLoopId === item.id}
                    key={item.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                    }}
                    onDragOver={(event) => {
                      if (draggingLoopId) {
                        event.preventDefault();
                        reorderLoopItems(draggingLoopId, item.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      endDrag(setDraggingLoopId);
                    }}
                    onDragEnd={() => endDrag(setDraggingLoopId)}
                    onPointerDown={() => beginLongPressDrag(item.id, setDraggingLoopId)}
                    onPointerLeave={clearLongPressTimer}
                    onPointerUp={() => {
                      if (!draggingLoopId) {
                        clearLongPressTimer();
                      }
                    }}
                  >
                    <span>{index + 1}</span>
                    <strong>{source.name}</strong>
                    <button
                      type="button"
                      title="删除循环项"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeLoopItem(item.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                    ) : null;
                  })()
                ))}
              </div>
            ) : (
              <p className="loop-empty">添加几个节奏型后，播放会按列表顺序每项循环 1 小节。</p>
            )}
        </section>
      </div>
      ) : null}
      </section>
    </main>
  );
}
