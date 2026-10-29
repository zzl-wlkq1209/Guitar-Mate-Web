import {
  Check,
  ChevronDown,
  Download,
  Eraser,
  List,
  Minus,
  Pencil,
  Plus,
  Pause,
  Play,
  RotateCcw,
  Reply,
  Save,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Clipboard } from "@capacitor/clipboard";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shareApiUrl } from "./shareApi";
import TabPlayerFrame, { type TabPlayerFrameHandle } from "./TabPlayerFrame";

type Direction = "down" | "up";
type SlotMode = "empty" | "normal" | "mute" | "double";
type MeterId = "fourFour" | "sixEight";
type ToolId = "strum" | "tab";

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

type CustomSortDrag = {
  id: string;
  pointerId: number;
  sourceIndex: number;
  targetIndex: number;
  startPointerY: number;
  pointerY: number;
  centers: number[];
  settling: boolean;
};

type LoopSortDrag = CustomSortDrag;

type SharedWorkspace = Pick<WorkspaceState, "savedPatterns" | "loopItems">;

type SharedPayload = {
  version: 2;
  kind: "guitar-mate-pattern-share";
  workspaces: Record<MeterId, SharedWorkspace>;
};

type SharedImportResult = {
  addedPatterns: number;
  skippedPatterns: number;
  importedLoopItems: number;
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

type TabScoreDocument = {
  id?: string;
  name?: string;
  artist?: string;
  key?: string;
  tab: string;
  shapes?: string;
  bpm?: number;
  beats?: string;
  tone?: string;
  capo?: string;
  updatedAt?: string;
};

type GlobalBackup = {
  kind: "guitar-mate-backup";
  version: 1;
  exportedAt: string;
  activeTool: ToolId;
  strum: StoredState;
  tabPlayer: {
    library: TabScoreDocument[];
    preferences: Record<string, string>;
  };
};

const STORAGE_KEY = "guitar-strum-simulator-v5";
const ACTIVE_TOOL_KEY = "guitar-mate-active-tool-v1";
const TAB_LIBRARY_KEY = "guitar-tab-player-library-v1";
const TAB_PREFERENCE_KEYS = [
  "guitar-tab-count-in",
  "guitar-tab-loop",
  "guitar-tab-capo",
  "guitar-tab-key",
  "guitar-tab-meter",
  "guitar-tab-bpm",
  "guitar-tab-layout",
] as const;
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
const hasSamePatternContent = (left: SavedPattern, right: SavedPattern) =>
  left.slots.length === right.slots.length &&
  left.slots.every(
    (slot, index) =>
      slot.mode === right.slots[index]?.mode && slot.direction === right.slots[index]?.direction,
  );

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

const readActiveTool = (): ToolId => {
  if (typeof window === "undefined") return "tab";
  const saved = window.localStorage.getItem(ACTIVE_TOOL_KEY);
  return saved === "strum" ? "strum" : "tab";
};

const installGlobalTooltips = () => {
  const tooltip = document.createElement("div");
  tooltip.className = "global-tooltip";
  tooltip.setAttribute("role", "tooltip");
  document.body.appendChild(tooltip);
  let activeTarget: HTMLElement | null = null;
  let longPressTimer: number | null = null;
  let longPressShown = false;

  const hide = () => {
    tooltip.classList.remove("visible");
    activeTarget = null;
  };
  const show = (target: HTMLElement) => {
    const label = target.dataset.tooltip;
    if (!label) return;
    activeTarget = target;
    tooltip.textContent = label;
    tooltip.classList.add("visible");
    const targetRect = target.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const align = target.dataset.tooltipAlign;
    const desiredLeft = align === "start" ? targetRect.left : align === "end" ? targetRect.right - tipRect.width : targetRect.left + (targetRect.width - tipRect.width) / 2;
    const left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, desiredLeft));
    const below = targetRect.bottom + 8;
    const top = below + tipRect.height <= window.innerHeight - 8 ? below : Math.max(8, targetRect.top - tipRect.height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const tooltipTarget = (event: Event) => (event.target as Element | null)?.closest<HTMLElement>("[data-tooltip]") ?? null;
  const onPointerOver = (event: PointerEvent) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const target = tooltipTarget(event);
    if (target) show(target);
  };
  const onPointerOut = (event: PointerEvent) => {
    if (longPressTimer !== null) window.clearTimeout(longPressTimer);
    longPressTimer = null;
    if (!activeTarget) return;
    const next = event.relatedTarget as Node | null;
    if (!next || !activeTarget.contains(next)) hide();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    const target = tooltipTarget(event);
    if (!target) return;
    if (longPressTimer !== null) window.clearTimeout(longPressTimer);
    longPressShown = false;
    longPressTimer = window.setTimeout(() => {
      longPressShown = true;
      show(target);
    }, 520);
  };
  const onPointerEnd = () => {
    if (longPressTimer !== null) window.clearTimeout(longPressTimer);
    longPressTimer = null;
    if (longPressShown) window.setTimeout(hide, 900);
  };
  const onClick = (event: MouseEvent) => {
    const target = tooltipTarget(event);
    if (!target) return;
    if (longPressShown) {
      event.preventDefault();
      event.stopPropagation();
      longPressShown = false;
      return;
    }
    hide();
    target.blur();
  };

  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("pointerout", onPointerOut, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerEnd, true);
  document.addEventListener("pointercancel", onPointerEnd, true);
  document.addEventListener("click", onClick, true);
  return () => {
    if (longPressTimer !== null) window.clearTimeout(longPressTimer);
    document.removeEventListener("pointerover", onPointerOver, true);
    document.removeEventListener("pointerout", onPointerOut, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerEnd, true);
    document.removeEventListener("pointercancel", onPointerEnd, true);
    document.removeEventListener("click", onClick, true);
    tooltip.remove();
  };
};

const readTabLibrary = (): TabScoreDocument[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TAB_LIBRARY_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is TabScoreDocument & { layout?: string } => Boolean(item && typeof item.tab === "string"))
          .map(({ layout: _layout, ...item }) => item)
      : [];
  } catch {
    return [];
  }
};

const makeTabScoreId = () =>
  crypto.randomUUID?.() ?? `score-${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
  const [activeTool, setActiveTool] = useState<ToolId>(readActiveTool);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [tabPlayerRevision, setTabPlayerRevision] = useState(0);
  const [tabPlayerPlaying, setTabPlayerPlaying] = useState(false);
  const [tabPlayerDirty, setTabPlayerDirty] = useState(false);
  const [pendingToolSwitch, setPendingToolSwitch] = useState<ToolId | null>(null);
  const pendingToolSwitchRef = useRef<ToolId | null>(null);
  const tabPlayerRef = useRef<TabPlayerFrameHandle | null>(null);
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
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ title: string; message: string } | null>(null);
  const pendingDeleteActionRef = useRef<(() => void) | null>(null);
  const [transferDialog, setTransferDialog] = useState<"import" | "export" | null>(null);
  const [shareCode, setShareCode] = useState("");
  const [shareCopyFallback, setShareCopyFallback] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [transferScope, setTransferScope] = useState<"all" | "tab" | "strum">("all");
  const [tabTransferScores, setTabTransferScores] = useState<TabScoreDocument[] | null>(null);
  const [playerOnlyImport, setPlayerOnlyImport] = useState(false);
  const [tabModalOpen, setTabModalOpen] = useState(false);

  useEffect(() => installGlobalTooltips(), []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const frame = document.querySelector<HTMLIFrameElement>("iframe.tab-player-frame");
      if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return;
      if (event.data?.type === "guitar-mate-tab-modal") {
        setTabModalOpen(Boolean(event.data.open));
        return;
      }
      if (event.data?.type !== "guitar-mate-tab-transfer") return;
      setTabTransferScores(Array.isArray(event.data.scores) ? event.data.scores : null);
      setPlayerOnlyImport(true);
      setTransferScope("tab");
      setShareStatus(null);
      setShareCode("");
      setShareCopyFallback(null);
      setTransferDialog(event.data.mode === "export" ? "export" : "import");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    if (activeTool !== "tab") setTabModalOpen(false);
  }, [activeTool]);
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
  const [customSortDrag, setCustomSortDrag] = useState<CustomSortDrag | null>(null);
  const [loopSortDrag, setLoopSortDrag] = useState<LoopSortDrag | null>(null);
  const [customSortCommitting, setCustomSortCommitting] = useState(false);
  const [loopSortCommitting, setLoopSortCommitting] = useState(false);
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
  const shareCopyFallbackRef = useRef<HTMLTextAreaElement | null>(null);
  const customSortDragRef = useRef<CustomSortDrag | null>(null);
  const loopSortDragRef = useRef<LoopSortDrag | null>(null);
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
  const currentStoredState = (): StoredState => ({
    bpm,
    activeMeter,
    latencyMs,
    fontSize,
    darkMode,
    workspaces: {
      ...workspacesRef.current,
      [activeMeter]: currentWorkspace(),
    },
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
    window.localStorage.setItem(ACTIVE_TOOL_KEY, activeTool);
  }, [activeTool]);

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
    const field = shareCopyFallbackRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [shareCopyFallback]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.setOverlaysWebView({ overlay: false });
    void StatusBar.setBackgroundColor({ color: darkMode ? "#18181A" : "#FBFEFD" });
    void StatusBar.setStyle({ style: darkMode ? Style.Dark : Style.Light });
  }, [darkMode]);

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

  const beginCustomSortDrag = (event: React.PointerEvent<HTMLElement>, id: string) => {
    event.preventDefault();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-sort-kind="saved"]'));
    const sourceIndex = rows.findIndex((row) => row.dataset.sortId === id);
    if (sourceIndex < 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextDrag = {
      id,
      pointerId: event.pointerId,
      sourceIndex,
      targetIndex: sourceIndex,
      startPointerY: event.clientY,
      pointerY: event.clientY,
      centers: rows.map((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top + rect.height / 2;
      }),
      settling: false,
    };
    customSortDragRef.current = nextDrag;
    setDraggingSavedId(id);
    setCustomSortDrag(nextDrag);
  };

  const getCustomSortTransform = (index: number) => {
    if (!customSortDrag) return undefined;
    const { sourceIndex, targetIndex, startPointerY, pointerY, centers } = customSortDrag;
    if (index === sourceIndex) {
      return `translateY(${pointerY - startPointerY}px)`;
    }
    if (targetIndex > sourceIndex && index > sourceIndex && index <= targetIndex) {
      return `translateY(${centers[index - 1] - centers[index]}px)`;
    }
    if (targetIndex < sourceIndex && index >= targetIndex && index < sourceIndex) {
      return `translateY(${centers[index + 1] - centers[index]}px)`;
    }
    return undefined;
  };

  const endCustomSortDrag = () => {
    const current = customSortDragRef.current;
    customSortDragRef.current = null;
    setDraggingSavedId(null);
    if (!current) return;
    const targetOffset = current.centers[current.targetIndex] - current.centers[current.sourceIndex];
    setCustomSortDrag({
      ...current,
      pointerY: current.startPointerY + targetOffset,
      settling: true,
    });
    window.setTimeout(() => {
      setCustomSortCommitting(true);
      if (current.targetIndex !== current.sourceIndex) {
        const targetId = savedPatterns[current.targetIndex]?.id;
        if (targetId) reorderSavedPatterns(current.id, targetId);
      }
      setCustomSortDrag(null);
      requestAnimationFrame(() => setCustomSortCommitting(false));
    }, 300);
  };

  const beginLoopSortDrag = (event: React.PointerEvent<HTMLElement>, id: string) => {
    event.preventDefault();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-sort-kind="loop"]'));
    const sourceIndex = rows.findIndex((row) => row.dataset.sortId === id);
    if (sourceIndex < 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextDrag = {
      id,
      pointerId: event.pointerId,
      sourceIndex,
      targetIndex: sourceIndex,
      startPointerY: event.clientY,
      pointerY: event.clientY,
      centers: rows.map((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top + rect.height / 2;
      }),
      settling: false,
    };
    loopSortDragRef.current = nextDrag;
    setLoopSortDrag(nextDrag);
  };

  const getLoopSortTransform = (index: number) => {
    if (!loopSortDrag) return undefined;
    const { sourceIndex, targetIndex, startPointerY, pointerY, centers } = loopSortDrag;
    if (index === sourceIndex) return `translateY(${pointerY - startPointerY}px)`;
    if (targetIndex > sourceIndex && index > sourceIndex && index <= targetIndex) {
      return `translateY(${centers[index - 1] - centers[index]}px)`;
    }
    if (targetIndex < sourceIndex && index >= targetIndex && index < sourceIndex) {
      return `translateY(${centers[index + 1] - centers[index]}px)`;
    }
    return undefined;
  };

  const getLoopDisplayNumber = (index: number) => {
    if (!loopSortDrag?.settling) return index + 1;
    const { sourceIndex, targetIndex } = loopSortDrag;
    if (index === sourceIndex) return targetIndex + 1;
    if (targetIndex > sourceIndex && index > sourceIndex && index <= targetIndex) {
      return index;
    }
    if (targetIndex < sourceIndex && index >= targetIndex && index < sourceIndex) {
      return index + 2;
    }
    return index + 1;
  };

  const endLoopSortDrag = () => {
    const current = loopSortDragRef.current;
    loopSortDragRef.current = null;
    if (!current) return;
    const targetOffset = current.centers[current.targetIndex] - current.centers[current.sourceIndex];
    setLoopSortDrag({
      ...current,
      pointerY: current.startPointerY + targetOffset,
      settling: true,
    });
    window.setTimeout(() => {
      setLoopSortCommitting(true);
      if (current.targetIndex !== current.sourceIndex) {
        const targetId = loopItems[current.targetIndex]?.id;
        if (targetId) reorderLoopItems(current.id, targetId);
      }
      setLoopSortDrag(null);
      requestAnimationFrame(() => setLoopSortCommitting(false));
    }, 300);
  };

  useEffect(() => {
    if (!customSortDrag) return;
    const onPointerMove = (event: PointerEvent) => {
      const current = customSortDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (event.cancelable) event.preventDefault();
      // Compare the dragged row's center, not the pointer, against every row center.
      const draggedCenter =
        current.centers[current.sourceIndex] + (event.clientY - current.startPointerY);
      // Treat the dragged item as removed: only crossing another row's center changes its slot.
      const targetIndex = current.centers.filter(
        (center, index) => index !== current.sourceIndex && draggedCenter >= center,
      ).length;
      const nextDrag = { ...current, pointerY: event.clientY, targetIndex };
      customSortDragRef.current = nextDrag;
      setCustomSortDrag(nextDrag);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (customSortDragRef.current?.pointerId === event.pointerId) endCustomSortDrag();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [customSortDrag]);

  useEffect(() => {
    if (!loopSortDrag) return;
    const onPointerMove = (event: PointerEvent) => {
      const current = loopSortDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (event.cancelable) event.preventDefault();
      const draggedCenter =
        current.centers[current.sourceIndex] + (event.clientY - current.startPointerY);
      const targetIndex = current.centers.filter(
        (center, index) => index !== current.sourceIndex && draggedCenter >= center,
      ).length;
      const nextDrag = { ...current, pointerY: event.clientY, targetIndex };
      loopSortDragRef.current = nextDrag;
      setLoopSortDrag(nextDrag);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (loopSortDragRef.current?.pointerId === event.pointerId) endLoopSortDrag();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [loopSortDrag]);

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

  const requestDeletion = (title: string, message: string, action: () => void) => {
    pendingDeleteActionRef.current = action;
    setDeleteConfirmation({ title, message });
  };

  const confirmDeletion = () => {
    pendingDeleteActionRef.current?.();
    pendingDeleteActionRef.current = null;
    setDeleteConfirmation(null);
  };

  const createSharePayload = (): SharedPayload => {
    const allWorkspaces = {
      ...workspacesRef.current,
      [activeMeter]: currentWorkspace(),
    };
    return {
      version: 2,
      kind: "guitar-mate-pattern-share",
      workspaces: {
        fourFour: {
          savedPatterns: allWorkspaces.fourFour.savedPatterns,
          loopItems: allWorkspaces.fourFour.loopItems,
        },
        sixEight: {
          savedPatterns: allWorkspaces.sixEight.savedPatterns,
          loopItems: allWorkspaces.sixEight.loopItems,
        },
      },
    };
  };

  const importSharedPayload = (parsed: Partial<SharedPayload>): SharedImportResult | null => {
    if (parsed.kind !== "guitar-mate-pattern-share" || !parsed.workspaces) {
      return null;
    }
    const allWorkspaces = {
      ...workspacesRef.current,
      [activeMeter]: currentWorkspace(),
    };
    const nextWorkspaces = { ...allWorkspaces };
    let addedPatterns = 0;
    let skippedPatterns = 0;
    let importedLoopItems = 0;

    METERS.forEach((meter) => {
      const imported = parsed.workspaces?.[meter];
      if (!imported) return;
      const current = allWorkspaces[meter];
      const importedPatterns = (imported.savedPatterns ?? []).map((pattern) => ({
        ...pattern,
        advancedMode: Boolean(pattern.advancedMode),
        slots: normalizeSlots(pattern.slots, METER_CONFIG[meter].slotCount),
      }));
      const mergedPatterns = [...current.savedPatterns];
      const sourceToLocalId = new Map<string, string>();

      importedPatterns.forEach((pattern) => {
        const match = mergedPatterns.find((existing) => hasSamePatternContent(existing, pattern));
        if (match) {
          skippedPatterns += 1;
          sourceToLocalId.set(pattern.id, match.id);
          return;
        }
        const localId = `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        mergedPatterns.push({ ...pattern, id: localId });
        addedPatterns += 1;
        sourceToLocalId.set(pattern.id, localId);
      });

      const knownIds = new Set([
        ...METER_CONFIG[meter].practices.map((practice) => practice.id),
        ...mergedPatterns.map((pattern) => pattern.id),
      ]);
      const nextLoopItems = current.loopItems.length > 0
        ? current.loopItems
        : (imported.loopItems ?? [])
            .map((item) => {
              const sourceId = sourceToLocalId.get(item.sourceId) ?? item.sourceId;
              return knownIds.has(sourceId)
                ? { id: `loop-${Date.now()}-${Math.random().toString(36).slice(2)}`, sourceId }
                : null;
            })
            .filter((item): item is LoopItem => item !== null);

      nextWorkspaces[meter] = {
        ...current,
        savedPatterns: mergedPatterns,
        loopItems: nextLoopItems,
      };
      if (current.loopItems.length === 0) {
        importedLoopItems += nextLoopItems.length;
      }
    });

    const nextWorkspace = nextWorkspaces[activeMeter];
    workspacesRef.current = nextWorkspaces;
    setSavedPatterns(nextWorkspace.savedPatterns);
    setLoopItems(nextWorkspace.loopItems);
    return { addedPatterns, skippedPatterns, importedLoopItems };
  };

  const exportTimestamp = () => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
  };

  const saveJsonFile = async (filename: string, payload: unknown, title: string) => {
    const data = JSON.stringify(payload, null, 2);

    try {
      const file = await Filesystem.writeFile({
        path: `guitar-mate-backups/${filename}`,
        data,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      await Share.share({
        title,
        text: filename,
        url: file.uri,
        dialogTitle: title,
      });
    } catch {
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  };

  const exportPattern = async () => {
    await saveJsonFile(
      `strum-library-${exportTimestamp()}.json`,
      createSharePayload(),
      "导出扫弦资料库",
    );
  };

  const exportTabLibrary = async () => {
    await saveJsonFile(
      `guitar-tabs-${exportTimestamp()}.json`,
      { format: "guitar-tab-player", version: 1, scores: readTabLibrary() },
      "导出吉他谱资料库",
    );
  };

  const exportGlobalBackup = async () => {
    await saveJsonFile(
      `guitar-mate-full-${exportTimestamp()}.json`,
      transferPayload(),
      "导出 Guitar Mate 全部资料",
    );
  };

  const mergeTabLibrary = (candidates: TabScoreDocument[]) => {
    const current = readTabLibrary();
    let added = 0;
    let skipped = 0;
    const next = [...current];

    candidates.forEach((candidate) => {
      if (!candidate || typeof candidate.tab !== "string") return;
      const fingerprint = (score: TabScoreDocument) => JSON.stringify([score.name?.trim() || "", score.artist?.trim() || "", score.tab, score.shapes || "", score.key || "G", Number(score.bpm) || 60, score.beats || "4/4", String(score.capo || "0")]);
      const duplicate = next.some((score) => fingerprint(score) === fingerprint(candidate));
      if (duplicate) {
        skipped += 1;
        return;
      }
      const baseName = String(candidate.name || "导入的谱面").trim() || "导入的谱面";
      const name = baseName;
      next.push({
        ...candidate,
        id: makeTabScoreId(),
        name,
        artist: String(candidate.artist ?? "").trim(),
        key: String(candidate.key ?? "G"),
        bpm: Math.max(40, Math.min(240, Number(candidate.bpm) || 60)),
        beats: candidate.beats === "6/8" ? "6/8" : "4/4",
        tone: "acoustic",
        capo: String(Math.max(-1, Math.min(6, Number(candidate.capo) || 0))),
        updatedAt: new Date().toISOString(),
      });
      added += 1;
    });

    window.localStorage.setItem(TAB_LIBRARY_KEY, JSON.stringify(next));
    if (added > 0) document.querySelector<HTMLIFrameElement>("iframe.tab-player-frame")?.contentWindow?.postMessage({ type: "guitar-mate-tab-library-refresh" }, window.location.origin);
    return { added, skipped };
  };

  const importTransferFile = async (file: File) => {
    setShareStatus(null);
    try {
      const parsed = JSON.parse(await file.text()) as Partial<GlobalBackup> & {
        format?: string;
        scores?: TabScoreDocument[];
        tab?: string;
        slots?: StrumSlot[];
        name?: string;
        advancedMode?: boolean;
      };

      if ((parsed as { kind?: string }).kind === "guitar-mate-share") {
        const envelope = parsed as unknown as { strum?: SharedPayload; tabPlayer?: { scores: TabScoreDocument[] } };
        if (playerOnlyImport && (envelope.strum || !envelope.tabPlayer)) throw new Error("请在全局数据与分享中导入跟练器或全部数据");
        if (envelope.tabPlayer && (!Array.isArray(envelope.tabPlayer.scores) || envelope.tabPlayer.scores.some(score => !score || typeof score.tab !== "string"))) throw new Error("谱库内容格式无效");
        if (envelope.strum && (envelope.strum.kind !== "guitar-mate-pattern-share" || !envelope.strum.workspaces)) throw new Error("跟练器内容格式无效");
        const tabs = envelope.tabPlayer ? mergeTabLibrary(envelope.tabPlayer.scores) : null;
        const strum = envelope.strum ? importSharedPayload(envelope.strum) : null;
        if (!tabs && !strum) throw new Error("分享内容无效");
        setShareStatus(`导入完成${tabs ? `：新增 ${tabs.added} 首谱面，跳过 ${tabs.skipped} 首重复谱面` : ""}${strum ? `；新增 ${strum.addedPatterns} 个节奏型` : ""}。`);
        return;
      }

      if (playerOnlyImport && parsed.kind === "guitar-mate-backup") throw new Error("完整备份请从全局数据与分享导入");

      if (parsed.kind === "guitar-mate-backup" && parsed.strum?.workspaces && parsed.tabPlayer) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.strum));
        window.localStorage.setItem(TAB_LIBRARY_KEY, JSON.stringify(parsed.tabPlayer.library ?? []));
        TAB_PREFERENCE_KEYS.forEach((key) => {
          const value = parsed.tabPlayer?.preferences?.[key];
          if (typeof value === "string") window.localStorage.setItem(key, value);
          else window.localStorage.removeItem(key);
        });
        window.localStorage.setItem(ACTIVE_TOOL_KEY, parsed.activeTool === "tab" ? "tab" : "strum");
        window.location.reload();
        return;
      }

      const tabCandidates = Array.isArray(parsed.scores)
        ? parsed.scores
        : typeof parsed.tab === "string"
          ? [parsed as TabScoreDocument]
          : [];
      if (parsed.format === "guitar-tab-player" || tabCandidates.length > 0) {
        const result = mergeTabLibrary(tabCandidates);
        setShareStatus(
          result.added > 0
            ? `已导入 ${result.added} 首吉他谱${result.skipped ? `，跳过 ${result.skipped} 首重复内容` : ""}。`
            : "没有导入新谱面，文件内容与本地资料库重复。",
        );
        return;
      }

      if (playerOnlyImport) throw new Error("这是跟练器数据，不是吉他谱");
      const sharedResult = importSharedPayload(parsed as Partial<SharedPayload>);
      if (sharedResult) {
        setShareStatus(
          sharedResult.addedPatterns > 0
            ? `已导入 ${sharedResult.addedPatterns} 个扫弦节奏型。`
            : "没有导入新节奏型，文件内容与本地资料库重复。",
        );
        return;
      }

      if (parsed.slots?.length === slotCount) {
        stop();
        setSelectedId("custom");
        setCustomName(parsed.name ?? "导入扫弦");
        setAdvancedMode(Boolean(parsed.advancedMode));
        setSlots(normalizeSlots(parsed.slots, slotCount, true));
        setShareStatus("已导入当前扫弦节奏型。");
        return;
      }

      throw new Error("文件中没有可识别的 Guitar Mate 数据");
    } catch (error) {
      setShareStatus(error instanceof Error ? `导入失败：${error.message}。` : "导入失败：文件格式不正确。");
    }
  };

  const importPattern = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<StoredState> & {
        name?: string;
        advancedMode?: boolean;
        slots?: StrumSlot[];
      };
      if (importSharedPayload(parsed)) {
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

  const shareRequestError = (status: number, fallback: string) => {
    if (status === 404) return "分享口令不存在或已过期。";
    if (status === 413) return "配置内容过大，无法生成分享口令。";
    if (status === 500) return "分享服务尚未配置，请稍后再试。";
    if (status >= 500) return "分享服务暂时不可用，请稍后再试。";
    return fallback;
  };

  const transferPayload = () => ({
    kind: "guitar-mate-share", version: 1,
    scope: tabTransferScores ? "tab-selection" : transferScope,
    ...(transferScope !== "tab" ? { strum: createSharePayload() } : {}),
    ...(transferScope !== "strum" ? { tabPlayer: { format: "guitar-tab-player", scores: tabTransferScores ?? readTabLibrary() } } : {}),
  });

  const createShareCode = async () => {
    setShareBusy(true);
    setShareStatus(null);
    setShareCopyFallback(null);
    try {
      const payload = transferPayload();
      if (JSON.stringify(payload).length > 200_000) throw new Error("资料超过云端分享大小上限，请改用本地文件或在谱库中减少选中的谱面。");
      const response = await fetch(shareApiUrl("create-share"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const result = await response.json() as { token?: string };
      if (!response.ok || !result.token) throw new Error(shareRequestError(response.status, "生成分享口令失败。"));
      const message = `这是来自「Guitar Mate」的${tabTransferScores ? `${tabTransferScores.length}首吉他谱` : transferScope === "all" ? "全部资料" : transferScope === "tab" ? "播放器谱库" : "跟练器资料"}分享，30分钟内有效。打开设置 → 数据与分享 → 导入口令。分享口令为「${result.token}」`;
      setShareCode(result.token);
      try {
        if (Capacitor.isNativePlatform()) {
          await Clipboard.write({ string: message });
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(message);
        } else {
          const field = document.createElement("textarea");
          field.value = message;
          field.style.position = "fixed";
          field.style.opacity = "0";
          document.body.appendChild(field);
          field.select();
          const copied = document.execCommand("copy");
          field.remove();
          if (!copied) throw new Error("Clipboard unavailable");
        }
        setShareStatus("分享口令已复制，有效期 30 分钟。");
      } catch {
        setShareCopyFallback(message);
        setShareStatus("分享口令已生成，请长按上方文字复制。");
        if (Capacitor.isNativePlatform()) {
          try {
            await Share.share({
              title: "Guitar Mate 资料分享",
              text: message,
              dialogTitle: "分享资料",
            });
          } catch {
            // The selectable text remains available when the system share sheet is unavailable.
          }
        }
      }
    } catch (error) {
      setShareStatus(error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "网络连接失败，请检查网络后重试。");
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
      const result = await response.json() as { payload?: Partial<SharedPayload> };
      if (!response.ok || !result.payload) {
        throw new Error(shareRequestError(response.status, "分享配置格式无效，无法导入。"));
      }
      await importTransferFile(new File([JSON.stringify(result.payload)], "分享.json", { type: "application/json" }));
      setShareCode("");
    } catch (error) {
      setShareStatus(error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "网络连接失败，请检查网络后重试。");
    } finally {
      setShareBusy(false);
    }
  };

  const startCalibration = async () => {
    if (activeTool === "tab") {
      tabPlayerRef.current?.stop();
      setTabPlayerPlaying(false);
    } else {
      stop();
    }
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

  const completeToolSwitch = (tool: ToolId) => {
    if (activeTool === "tab") {
      tabPlayerRef.current?.stop();
      setTabPlayerPlaying(false);
    } else {
      stop();
    }
    stopCalibration();
    setCalibrationOpen(false);
    setToolMenuOpen(false);
    setActiveTool(tool);
  };

  const switchTool = (tool: ToolId) => {
    if (tool === activeTool) {
      setToolMenuOpen(false);
      return;
    }
    if (activeTool === "tab" && tabPlayerDirty) {
      pendingToolSwitchRef.current = tool;
      setPendingToolSwitch(tool);
      setToolMenuOpen(false);
      return;
    }
    completeToolSwitch(tool);
  };

  const handleTabDirtyChange = (dirty: boolean) => {
    setTabPlayerDirty(dirty);
    if (!dirty && pendingToolSwitchRef.current) {
      const tool = pendingToolSwitchRef.current;
      pendingToolSwitchRef.current = null;
      setPendingToolSwitch(null);
      completeToolSwitch(tool);
    }
  };

  const customSelected = isCustomId(selectedId);
  const lockedSlots =
    meterConfig.lockedIds.has(selectedId) ||
    activeLoopIndex !== null ||
    (isPlaying && loopEnabled && loopItems.length > 0);
  const loopSources = [...currentPractices, ...savedPatterns];

  useEffect(() => {
    const hasOverlay = settingsOpen || clearConfirmOpen || deleteConfirmation !== null || pendingToolSwitch !== null || transferDialog !== null || calibrationOpen || loopEditorOpen || customEditorOpen || tabModalOpen;
    if (!hasOverlay) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [calibrationOpen, clearConfirmOpen, customEditorOpen, deleteConfirmation, loopEditorOpen, pendingToolSwitch, settingsOpen, tabModalOpen, transferDialog]);

  return (
    <main className={["app-shell", `tool-${activeTool}`, darkMode ? "dark-mode" : ""].join(" ")} data-font-size={fontSize}>
      <section className="topbar">
        <button
          className="settings-toggle"
          type="button"
          data-tooltip="设置"
          aria-label="设置"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={21} />
        </button>
        <div className="tool-switcher">
          <button
            className="title-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded={toolMenuOpen}
            onClick={() => setToolMenuOpen((open) => !open)}
          >
            <p>{activeTool === "strum" ? "STRUMMING MATE" : "TAB PLAYER"}</p>
            <span className="title-line">
              <h1>{activeTool === "strum" ? "扫弦跟练器" : "吉他谱播放器"}</h1>
              <ChevronDown className={toolMenuOpen ? "open" : ""} size={19} />
            </span>
          </button>
        </div>
        <div className="top-actions">
          <button
            className="calibration-toggle"
            type="button"
            aria-label={`延迟校准 ${latencyMs}ms`}
            onClick={() => {
              setCalibrationOpen((open) => {
                if (open) stopCalibration();
                return !open;
              });
            }}
          >
            <span className="calibration-label">延迟校准</span>
            <span className="calibration-value">{latencyMs}ms</span>
          </button>
          <button
            className="play-button"
            type="button"
            aria-label={(activeTool === "strum" ? isPlaying : tabPlayerPlaying) ? "暂停" : "播放"}
            data-tooltip={(activeTool === "strum" ? isPlaying : tabPlayerPlaying) ? "暂停" : "播放"}
            onClick={() => {
              stopCalibration();
              if (activeTool === "strum") void togglePlayback();
              else tabPlayerRef.current?.togglePlayback();
            }}
          >
            {(activeTool === "strum" ? isPlaying : tabPlayerPlaying) ? <Pause size={22} /> : <Play size={22} />}
          </button>
        </div>
      </section>

      {toolMenuOpen ? (
        <>
          <button className="tool-menu-scrim" type="button" aria-label="关闭功能菜单" onClick={() => setToolMenuOpen(false)} />
          <div className="tool-menu" role="menu" aria-label="切换功能">
            <button className={activeTool === "tab" ? "selected" : ""} type="button" role="menuitem" onClick={() => switchTool("tab")}>
              <strong>吉他谱播放器</strong>
              <span>六线谱解析、试听与本地谱库</span>
            </button>
            <button className={activeTool === "strum" ? "selected" : ""} type="button" role="menuitem" onClick={() => switchTool("strum")}>
              <strong>扫弦跟练器</strong>
              <span>节奏型、跟拍与循环练习</span>
            </button>
          </div>
        </>
      ) : null}

      {settingsOpen ? (
        <div className="overlay" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="floating-panel settings-panel"
            aria-label="设置"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="floating-header">
              <div>
                <strong>设置</strong>
                <span>两个功能共用外观和数据管理</span>
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
              <strong>数据与分享</strong>
              <div className="settings-actions">
                <button className="settings-clear" type="button" data-tooltip="清空配置" aria-label="清空配置" onClick={() => setClearConfirmOpen(true)}>
                  <Eraser size={19} />
                </button>
                <button type="button" data-tooltip="导入配置" aria-label="导入配置" onClick={() => {
                  setTabTransferScores(null); setPlayerOnlyImport(false); setTransferScope("all");
                  setShareCode("");
                  setShareCopyFallback(null);
                  setShareStatus(null);
                  setTransferDialog("import");
                }}>
                  <Download size={19} />
                </button>
                <button type="button" data-tooltip="导出配置" aria-label="导出配置" onClick={() => { setTabTransferScores(null); setPlayerOnlyImport(false); setTransferScope("all"); setShareStatus(null); setShareCopyFallback(null); setTransferDialog("export"); }}>
                  <Upload size={19} />
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {transferDialog ? (
        <div className="overlay" role="presentation" onClick={() => {
          setTransferDialog(null);
          setShareCode("");
          setShareCopyFallback(null);
          setShareStatus(null);
        }}>
          <section
            className="floating-panel transfer-panel"
            role="dialog"
            aria-modal="true"
            aria-label={transferDialog === "import" ? "导入配置" : "导出配置"}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="floating-header">
              <div>
                <strong>{playerOnlyImport ? transferDialog === "import" ? "导入谱面" : "导出谱面" : transferDialog === "import" ? "导入配置" : "导出配置"}</strong>
                <span>{transferDialog === "import" ? playerOnlyImport ? "自动识别单谱或多谱，跳过完全重复的谱面" : "自动识别完整备份、资料库或单项文件" : "按需要选择分享范围"}</span>
              </div>
            </div>
            {transferDialog === "import" ? (
              <div className="transfer-options">
                <label className="transfer-choice">
                  <span className="transfer-choice-icon"><Download size={20} /></span>
                  <span>
                    <strong>选择本地文件</strong>
                    <small>{playerOnlyImport ? "仅接受吉他谱 JSON 文件" : "支持完整备份、扫弦资料库和吉他谱文件"}</small>
                  </span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importTransferFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {(
                  <>
                    <div className="transfer-divider"><span>云端临时分享 · 自动识别数据类型</span></div>
                    <div className="share-code-entry">
                      <input
                        value={shareCode}
                        onChange={(event) => setShareCode(event.target.value)}
                        placeholder="粘贴分享口令"
                        aria-label="分享口令"
                      />
                      <button type="button" disabled={!shareCode.trim() || shareBusy} onClick={() => void importShareCode()}>
                        {shareBusy ? "导入中..." : "导入口令"}
                      </button>
                    </div>
                  </>
                )}
                {shareStatus ? <p className="share-status">{shareStatus}</p> : null}
              </div>
            ) : (
              <div className="transfer-options">
                {tabTransferScores ? <p className="transfer-local-note">导出已选 {tabTransferScores.length} 首谱面</p> : <div className="transfer-scope" role="group" aria-label="分享范围">{([['all', '全部'], ['tab', '播放器'], ['strum', '跟练器']] as const).map(([scope, label]) => <button type="button" key={scope} aria-pressed={transferScope === scope} onClick={() => { setTransferScope(scope); setShareStatus(null); setShareCopyFallback(null); }}>{label}</button>)}</div>}
                <button className="transfer-choice" type="button" onClick={() => {
                  if (tabTransferScores) void saveJsonFile(`guitar-tabs-${exportTimestamp()}.json`, { format: "guitar-tab-player", version: 1, scores: tabTransferScores }, "导出吉他谱");
                  else if (transferScope === "all") void exportGlobalBackup();
                  else if (transferScope === "tab") void exportTabLibrary();
                  else void exportPattern();
                }}>
                  <span className="transfer-choice-icon"><Upload size={20} /></span>
                  <span>
                    <strong>导出本地文件</strong>
                    <small>保存所选范围的 JSON 文件</small>
                  </span>
                </button>
                {(
                  <>
                    <div className="transfer-divider"><span>在线临时分享</span></div>
                    <button className="transfer-choice compact" type="button" disabled={shareBusy} onClick={() => void createShareCode()}>
                      <span className="transfer-choice-icon"><Reply className="share-forward-icon" size={22} /></span>
                      <span>
                        <strong>{shareBusy ? "生成中..." : "生成云端分享口令"}</strong>
                        <small>上传所选资料，30 分钟后失效</small>
                      </span>
                    </button>
                  </>
                )}
                {!tabTransferScores && <p className="transfer-local-note">单首／部分谱面请进入本地谱库：单谱右侧 ⋮ → 导出，或多选后导出。</p>}
                {shareCopyFallback ? (
                  <textarea
                    className="share-code-display"
                    ref={shareCopyFallbackRef}
                    readOnly
                    value={shareCopyFallback}
                    aria-label="完整分享文本，可长按复制"
                  />
                ) : null}
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
                <span>将清除扫弦设置和本地吉他谱，并恢复默认状态。</span>
              </div>
            </div>
            <div className="confirmation-actions">
              <button type="button" onClick={() => setClearConfirmOpen(false)}>取消</button>
              <button className="danger-button" type="button" onClick={clearConfiguration}>确认清空</button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteConfirmation ? (
        <div className="overlay confirmation-overlay" role="presentation" onClick={() => setDeleteConfirmation(null)}>
          <section className="floating-panel confirmation-panel" role="dialog" aria-modal="true" aria-label={deleteConfirmation.title} onClick={(event) => event.stopPropagation()}>
            <div className="floating-header"><div><strong>{deleteConfirmation.title}</strong><span>{deleteConfirmation.message}</span></div></div>
            <div className="confirmation-actions">
              <button type="button" onClick={() => setDeleteConfirmation(null)}>取消</button>
              <button className="danger-button" type="button" onClick={confirmDeletion}>确认删除</button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingToolSwitch ? (
        <div className="overlay confirmation-overlay" role="presentation">
          <section className="floating-panel confirmation-panel" role="dialog" aria-modal="true" aria-label="保存谱面修改">
            <div className="floating-header"><div><strong>保存当前修改？</strong><span>当前谱面有尚未保存的修改。</span></div></div>
            <div className="confirmation-actions three-actions">
              <button type="button" onClick={() => { pendingToolSwitchRef.current = null; setPendingToolSwitch(null); }}>取消</button>
              <button type="button" onClick={() => { const tool = pendingToolSwitchRef.current; pendingToolSwitchRef.current = null; setPendingToolSwitch(null); if (tool) completeToolSwitch(tool); }}>不保存</button>
              <button className="danger-button" type="button" onClick={() => tabPlayerRef.current?.saveCurrent()}>保存修改</button>
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
                <button type="button" data-tooltip="减少 20ms" aria-label="减少 20ms" onClick={() => adjustLatency(-20)}>
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
                <button type="button" data-tooltip="增加 20ms" aria-label="增加 20ms" onClick={() => adjustLatency(20)}>
                  <Plus size={17} />
                </button>
              </div>
              <button className="icon-button latency-reset" type="button" data-tooltip="重置为 0" aria-label="重置为 0" onClick={resetLatency}>
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

      {activeTool === "strum" ? (
      <>
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
                <span>{savedPatterns.length > 0 ? "拖动左侧按钮排序" : "暂无自定义节奏型"}</span>
              </div>
            </div>
            {savedPatterns.length > 0 ? (
              <div className="saved-list saved-editor-list">
                {savedPatterns.map((pattern) => (
                  <div
                    className={[
                      "saved-item",
                      customSortDrag?.id === pattern.id ? "custom-sorting" : "",
                      customSortDrag?.id === pattern.id && customSortDrag.settling
                        ? "custom-settling"
                        : "",
                      customSortCommitting ? "sort-committing" : "",
                    ].join(" ")}
                    key={pattern.id}
                    data-sort-id={pattern.id}
                    data-sort-kind="saved"
                    style={{ transform: getCustomSortTransform(savedPatterns.findIndex((item) => item.id === pattern.id)) }}
                  >
                    <button
                      type="button"
                      className="drag-handle"
                      aria-label={`拖动${pattern.name}排序`}
                      onContextMenu={(event) => event.preventDefault()}
                      onPointerDown={(event) => {
                        beginCustomSortDrag(event, pattern.id);
                      }}
                    >
                      <List size={18} />
                    </button>
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
                      data-tooltip="删除"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        requestDeletion("删除节奏型？", `确定删除“${pattern.name}”吗？删除后无法恢复。`, () => deleteSaved(pattern.id));
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
                <span>{loopItems.length > 0 ? "拖动左侧按钮排序" : "从下方添加节奏型"}</span>
              </div>
              <button
                className="icon-button"
                type="button"
                data-tooltip="关闭"
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
                      "loop-editor-row",
                      loopSortDrag?.id === item.id ? "loop-sorting" : "",
                      loopSortDrag?.id === item.id && loopSortDrag.settling
                        ? "loop-settling"
                        : "",
                      loopSortCommitting ? "sort-committing" : "",
                    ].join(" ")}
                    key={item.id}
                    data-sort-id={item.id}
                    data-sort-kind="loop"
                    style={{ transform: getLoopSortTransform(loopItems.findIndex((loopItem) => loopItem.id === item.id)) }}
                  >
                    <button
                      type="button"
                      className="drag-handle"
                      aria-label={`拖动${source.name}排序`}
                      onContextMenu={(event) => event.preventDefault()}
                      onPointerDown={(event) => beginLoopSortDrag(event, item.id)}
                    >
                      <List size={18} />
                    </button>
                    <div className={[
                      "loop-item",
                      activeLoopIndex === index ? "active" : "",
                    ].join(" ")}>
                      <span>{getLoopDisplayNumber(index)}</span>
                      <strong>{source.name}</strong>
                      <button
                        type="button"
                        data-tooltip="删除循环项"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          requestDeletion("删除循环项？", `确定从循环中移除“${source.name}”吗？`, () => removeLoopItem(item.id));
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
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
      </>
      ) : (
        <TabPlayerFrame
          ref={tabPlayerRef}
          darkMode={darkMode}
          fontSize={fontSize}
          latencyMs={latencyMs}
          revision={tabPlayerRevision}
          onPlaybackChange={setTabPlayerPlaying}
          onDirtyChange={handleTabDirtyChange}
        />
      )}
    </main>
  );
}
