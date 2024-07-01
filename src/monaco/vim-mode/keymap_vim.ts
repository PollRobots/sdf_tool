/**
MIT License

Copyright (C) 2017 by Marijn Haverbeke <marijnh@gmail.com> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
 */
import CodeMirror, {
  Change,
  CmSelection,
  isPos,
  KeyMapEntry,
  makePos,
  Marker,
  Pos,
  signal,
} from "./cm_adapter";
import { StringStream } from "./string-stream";
import { defaultKeymap, defaultKeymapLength } from "./defaultKeyMap";
import { SecInfoOptions } from "./statusbar";

type VimOptions = Record<string, { value?: string | number | boolean }>;

interface LastSelection {
  anchorMark: Marker;
  headMark: Marker;
  anchor: Pos;
  head: Pos;
  visualMode: boolean;
  visualLine: boolean;
  visualBlock: boolean;
}

interface VimState {
  inputState: InputState;
  // Vim's input state that triggered the last edit, used to repeat
  // motions and operators with '.'.
  lastEditInputState?: InputState;
  // Vim's action command before the last edit, used to repeat actions
  // with '.' and insert mode repeat.
  lastEditActionCommand?: KeyMapping;
  // When using jk for navigation, if you move from a longer line to a
  // shorter line, the cursor may clip to the end of the shorter line.
  // If j is pressed again and cursor goes to the next line, the
  // cursor should go back to its horizontal position on the longer
  // line if it can. This is to keep track of the horizontal position.
  lastHPos: number;
  // Doing the same with screen-position for gj/gk
  lastHSPos: number;
  // The last motion command run. Cleared if a non-motion command gets
  // executed in between.
  lastMotion?: MotionFunc;
  marks: Record<string, Marker>;
  insertMode: boolean;
  // Repeat count for changes made in insert mode, triggered by key
  // sequences like 3,i. Only exists when insertMode is true.
  insertModeRepeat?: number;
  visualMode: boolean;
  // If we are in visual line mode. No effect if visualMode is false.
  visualLine: boolean;
  visualBlock: boolean;
  lastSelection?: LastSelection;
  lastPastedText?: string;
  sel?: CmSelection;
  // Buffer-local/window-local values of vim options.
  options: VimOptions;

  searchState_?: SearchState;
  exMode?: boolean;
}

interface VimGlobalState {
  // The current search query.
  searchQuery?: string;
  // Whether we are searching backwards.
  searchIsReversed: boolean;
  // Replace part of the last substituted pattern
  lastSubstituteReplacePart?: string;
  jumpList: CircularJumpList;
  macroModeState: MacroModeState;
  // Recording latest f, t, F or T motion command.
  lastCharacterSearch: {
    increment: number;
    forward: boolean;
    selectedCharacter: string;
  };
  registerController: RegisterController;
  // search history buffer
  searchHistoryController: HistoryController;
  // ex Command history buffer
  exCommandHistoryController: HistoryController;
  query?: RegExp;
  isReversed?: boolean;
}

function transformCursor(cm: CodeMirror, range: CmSelection): Pos {
  const vim = cm.state.vim as VimState;
  if (!vim || vim.insertMode) return range.head;
  const head = vim.sel.head;
  if (!head) return range.head;

  if (vim.visualBlock) {
    if (range.head.line != head.line) {
      return;
    }
  }
  if (range.from() == range.anchor && !range.empty()) {
    if (range.head.line == head.line && range.head.ch != head.ch) {
      return makePos(range.head.line, range.head.ch - 1);
    }
  }

  return range.head;
}

interface MotionArgs {
  linewise?: boolean;
  toJumplist?: boolean;
  forward?: boolean;
  wordEnd?: boolean;
  bigWord?: boolean;
  inclusive?: boolean;
  explicitRepeat?: boolean;
  toFirstChar?: boolean;
  repeatOffset?: number;
  sameLine?: boolean;
  textObjectInner?: boolean;
  selectedCharacter?: string;
  repeatIsExplicit?: boolean;
  noRepeat?: boolean;
  repeat?: number;
}

interface ActionArgs {
  after?: boolean;
  isEdit?: boolean;
  matchIndent?: boolean;
  forward?: boolean;
  linewise?: boolean;
  insertAt?: string;
  blockwise?: boolean;
  keepSpaces?: boolean;
  replace?: boolean;
  position?: "center" | "top" | "bottom";
  increase?: boolean;
  backtrack?: boolean;
  indentRight?: boolean;
  selectedCharacter?: string;
  repeat?: number;
  repeatIsExplicit?: boolean;
  registerName?: string;
  head?: Pos;
}

interface OperatorArgs {
  indentRight?: boolean;
  toLower?: boolean;
  linewise?: boolean;
  shouldMoveCursor?: boolean;
  fullLine?: boolean;
  selectedCharacter?: string;
  lastSel?: Pick<
    LastSelection,
    "anchor" | "head" | "visualBlock" | "visualLine"
  >;
  repeat?: number;
  registerName?: string;
}

interface SearchArgs {
  forward: boolean;
  querySrc: "prompt" | "wordUnderCursor";
  toJumplist: boolean;
  wholeWordOnly?: boolean;
  selectedCharacter?: string;
}

interface OperatorMotionArgs {
  visualLine: boolean;
}

interface ExArgs {
  input: string;
}

type Context = "insert" | "normal" | "visual";

type MappableCommandType =
  | "motion"
  | "action"
  | "operator"
  | "operatorMotion"
  | "search"
  | "ex";
type MappableArgType =
  | MotionArgs
  | ActionArgs
  | OperatorArgs
  | OperatorMotionArgs
  | SearchArgs
  | ExArgs;

export interface KeyMapping {
  keys: string;
  type: "keyToKey" | "idle" | "keyToEx" | MappableCommandType;
  context?: Context;
  toKeys?: string;
  action?: string;
  actionArgs?: ActionArgs;
  motion?: string;
  motionArgs?: MotionArgs;
  isEdit?: boolean;
  operator?: string;
  operatorArgs?: OperatorArgs;
  operatorMotion?: string;
  operatorMotionArgs?: OperatorMotionArgs;
  interlaceInsertRepeat?: boolean;
  exitVisualBlock?: boolean;
  search?: string;
  searchArgs?: SearchArgs;
  repeatOverride?: number;
  ex?: string;
  exArgs?: ExArgs;
}

interface ExCommand {
  name: string;
  type?: "exToEx" | "exToKey" | "api";
  shortName?: string;
  possiblyAsync?: boolean;
  excludeFromCommandHistory?: boolean;
  toKeys?: string;
  toInput?: string;
  user?: boolean;
}
/**
 * Ex commands
 * Care must be taken when adding to the default Ex command map. For any
 * pair of commands that have a shared prefix, at least one of their
 * shortNames must not match the prefix of the other command.
 */
const defaultExCommandMap: ExCommand[] = [
  { name: "colorscheme", shortName: "colo" },
  { name: "map" },
  { name: "imap", shortName: "im" },
  { name: "nmap", shortName: "nm" },
  { name: "vmap", shortName: "vm" },
  { name: "unmap" },
  { name: "edit", shortName: "e" },
  { name: "write", shortName: "w" },
  { name: "undo", shortName: "u" },
  { name: "redo", shortName: "red" },
  { name: "set", shortName: "se" },
  { name: "setlocal", shortName: "setl" },
  { name: "setglobal", shortName: "setg" },
  { name: "sort", shortName: "sor" },
  { name: "substitute", shortName: "s", possiblyAsync: true },
  { name: "nohlsearch", shortName: "noh" },
  { name: "yank", shortName: "y" },
  { name: "delmarks", shortName: "delm" },
  { name: "registers", shortName: "reg", excludeFromCommandHistory: true },
  { name: "vglobal", shortName: "v" },
  { name: "global", shortName: "g" },
];

function enterVimMode(cm: CodeMirror) {
  cm.setOption("disableInput", true);
  cm.setOption("showCursorWhenSelecting", false);
  signal(cm, "vim-mode-change", { mode: "normal" });
  cm.on("cursorActivity", onCursorActivity);
  maybeInitVimState(cm);
  // CodeMirror.on(cm.getInputField(), 'paste', getOnPasteFn(cm));
  cm.enterVimMode();
}

function leaveVimMode(cm: CodeMirror) {
  cm.setOption("disableInput", false);
  cm.off("cursorActivity", onCursorActivity);
  // CodeMirror.off(cm.getInputField(), 'paste', getOnPasteFn(cm));
  cm.state.vim = null;
  if (highlightTimeout) clearTimeout(highlightTimeout);
  cm.leaveVimMode();
}

function detachVimMap(cm: CodeMirror, next?: KeyMapEntry) {
  cm.attached = false;
  if (this == CodeMirror.keyMap.vim) {
    cm.options.$customCursor = null;
    // CodeMirror.rmClass(cm.getWrapperElement(), "cm-fat-cursor");
  }

  if (!next || next.attach != attachVimMap) leaveVimMode(cm);
}
function attachVimMap(cm: CodeMirror, prev?: KeyMapEntry) {
  if (this == CodeMirror.keyMap.vim) {
    cm.attached = true;
    if (cm.curOp) {
      cm.curOp.selectionChanged = true;
    }
    cm.options.$customCursor = transformCursor;
  }

  if (!prev || prev.attach != attachVimMap) enterVimMode(cm);
}

function cmKey(key: string, cm: CodeMirror) {
  if (!cm) {
    return undefined;
  }
  if (this[key]) {
    // return this[key];
    console.error("cmKey: return this[key];", key);
    throw new Error(`cmKey: return this[key]; ${key}`);
  }
  const vimKey = cmKeyToVimKey(key);
  if (!vimKey) {
    return false;
  }
  const cmd = vimApi.findKey(cm, vimKey);
  if (typeof cmd == "function") {
    signal(cm, "vim-keypress", vimKey);
  }
  return cmd;
}

const modifiers: Record<string, string> = {
  Shift: "S",
  Ctrl: "C",
  Alt: "A",
  Cmd: "D",
  Mod: "A",
  CapsLock: "",
};
const specialKeys: Record<string, string> = {
  Enter: "CR",
  Backspace: "BS",
  Delete: "Del",
  Insert: "Ins",
};
function cmKeyToVimKey(key: string) {
  if (key.charAt(0) == "'") {
    // Keypress character binding of format "'a'"
    return key.charAt(1);
  }
  if (key === "AltGraph") {
    return false;
  }
  const pieces = key.split(/-(?!$)/);
  const lastPiece = pieces[pieces.length - 1];
  if (pieces.length == 1 && pieces[0].length == 1) {
    // No-modifier bindings use literal character bindings above. Skip.
    return false;
  } else if (
    pieces.length == 2 &&
    pieces[0] == "Shift" &&
    lastPiece.length == 1
  ) {
    // Ignore Shift+char bindings as they should be handled by literal character.
    return false;
  }
  let hasCharacter = false;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (piece in modifiers) {
      pieces[i] = modifiers[piece];
    } else {
      hasCharacter = true;
    }
    if (piece in specialKeys) {
      pieces[i] = specialKeys[piece];
    }
  }
  if (!hasCharacter) {
    // Vim does not support modifier only keys.
    return false;
  }
  // TODO: Current bindings expect the character to be lower case, but
  // it looks like vim key notation uses upper case.
  if (isUpperCase(lastPiece)) {
    pieces[pieces.length - 1] = lastPiece.toLowerCase();
  }
  return "<" + pieces.join("-") + ">";
}

// function getOnPasteFn(cm) {
//   var vim = cm.state.vim;
//   if (!vim.onPasteFn) {
//     vim.onPasteFn = function () {
//       if (!vim.insertMode) {
//         cm.setCursor(offsetCursor(cm.getCursor(), 0, 1));
//         actions.enterInsertMode(cm, {}, vim);
//       }
//     };
//   }
//   return vim.onPasteFn;
// }

const numberRegex = /[\d]/;
const wordCharTest = [
  CodeMirror.isWordChar,
  function (ch: string) {
    return ch && !CodeMirror.isWordChar(ch) && !/\s/.test(ch);
  },
];
const bigWordCharTest = [
  function (ch: string) {
    return /\S/.test(ch);
  },
];
function makeKeyRange(start: number, size: number) {
  const keys = [];
  for (let i = start; i < start + size; i++) {
    keys.push(String.fromCharCode(i));
  }
  return keys;
}
const upperCaseAlphabet = makeKeyRange(65, 26);
const lowerCaseAlphabet = makeKeyRange(97, 26);
const numbers = makeKeyRange(48, 10);
const validMarks = [
  ...upperCaseAlphabet,
  ...lowerCaseAlphabet,
  ...numbers,
  "<",
  ">",
];
const validRegisters = [
  ...upperCaseAlphabet,
  ...lowerCaseAlphabet,
  ...numbers,
  "-",
  '"',
  ".",
  ":",
  "_",
  "/",
];
const upperCaseChars = /^[\p{Lu}]$/u;

function isLine(cm: CodeMirror, line: number) {
  return line >= cm.firstLine() && line <= cm.lastLine();
}
function isLowerCase(k: string) {
  return /^[a-z]$/.test(k);
}
function isMatchableSymbol(k: string) {
  return "()[]{}".includes(k);
}
function isNumber(k: string) {
  return numberRegex.test(k);
}
function isUpperCase(k: string) {
  return upperCaseChars.test(k);
}
function isWhiteSpaceString(k: string) {
  return /^\s*$/.test(k);
}
function isEndOfSentenceSymbol(k: string) {
  return ".?!".includes(k);
}
function inArray<T>(val: T, arr: T[]) {
  return arr.includes(val);
}

type OptionCallback = (
  value?: string | number | boolean,
  cm?: CodeMirror
) => string | number | boolean | undefined;

interface Option {
  type: "string" | "number" | "boolean";
  value?: string | number | boolean;
  defaultValue: string | number | boolean | undefined;
  callback: OptionCallback;
}

const options = new Map<string, Option>();

function defineOption(
  name: string,
  defaultValue: string | number | boolean | undefined,
  type: "string" | "number" | "boolean",
  aliases?: string[],
  callback?: OptionCallback
): void {
  if (defaultValue === undefined && !callback) {
    throw Error("defaultValue is required unless callback is provided");
  }
  if (!type) {
    type = "string";
  }
  const option: Option = {
    type: type,
    defaultValue: defaultValue,
    callback: callback,
  };
  options.set(name, option);
  if (aliases) {
    aliases.forEach((a) => options.set(a, option));
  }
  if (defaultValue) {
    setOption(name, defaultValue);
  }
}

interface Config {
  scope?: "local" | "global";
}

function setOption(
  name: string,
  value: string | number | boolean,
  cm?: CodeMirror,
  cfg?: Config
) {
  const option = options.get(name);
  if (!option) {
    return new Error("Unknown option: " + name);
  }

  cfg = cfg || {};
  const scope = cfg.scope;
  if (option.type == "boolean") {
    if (value && value !== true) {
      return new Error("Invalid argument: " + name + "=" + value);
    } else if (value !== false) {
      // Boolean options are set to true if value is not defined.
      value = true;
    }
  }
  if (option.callback) {
    if (scope !== "local") {
      option.callback(value, undefined);
    }
    if (scope !== "global" && cm) {
      option.callback(value, cm);
    }
  } else {
    if (scope !== "local") {
      option.value = option.type == "boolean" ? !!value : value;
    }
    if (scope !== "global" && cm) {
      (cm.state.vim as VimState).options[name] = { value: value };
    }
  }
}

function getOption(name: string, cm?: CodeMirror, cfg?: Config) {
  const option = options.get(name);
  cfg = cfg || {};
  const scope = cfg.scope;
  if (!option) {
    return new Error("Unknown option: " + name);
  }
  if (option.callback) {
    const local = cm && option.callback(undefined, cm);
    if (scope !== "global" && local !== undefined) {
      return local;
    }
    if (scope !== "local") {
      return option.callback();
    }
    return;
  } else {
    const local =
      scope !== "global" && cm && (cm.state.vim as VimState).options[name];
    return (local || (scope !== "local" && option) || {}).value;
  }
}

defineOption("filetype", undefined, "string", ["ft"], function (name, cm) {
  // Option is local. Do nothing for global.
  if (cm === undefined) {
    return;
  }
  // The 'filetype' option proxies to the CodeMirror 'mode' option.
  if (name === undefined) {
    const mode = cm.getOption("mode");
    return mode == "null" ? "" : mode;
  } else {
    const mode = name == "" ? "null" : name;
    cm.setOption("mode", mode);
  }
});

const createCircularJumpList = () => new CircularJumpList();

class CircularJumpList {
  size = 100;
  pointer = -1;
  head = 0;
  tail = 0;
  buffer: Marker[] = new Array(100);
  cachedCursor?: Pos = undefined;

  add(cm: CodeMirror, oldCur: Pos, newCur: Pos) {
    const current = this.pointer % this.size;
    const curMark = this.buffer[current];
    const useNextSlot = (cursor: Pos) => {
      const next = ++this.pointer % this.size;
      const trashMark = this.buffer[next];
      if (trashMark) {
        trashMark.clear();
      }
      this.buffer[next] = cm.setBookmark(cursor);
    };
    if (curMark) {
      const markPos = curMark.find();
      // avoid recording redundant cursor position
      if (markPos && !cursorEqual(markPos, oldCur)) {
        useNextSlot(oldCur);
      }
    } else {
      useNextSlot(oldCur);
    }
    useNextSlot(newCur);
    this.head = this.pointer;
    this.tail = this.pointer - this.size + 1;
    if (this.tail < 0) {
      this.tail = 0;
    }
  }

  move(cm: CodeMirror, offset: number) {
    this.pointer += offset;
    if (this.pointer > this.head) {
      this.pointer = this.head;
    } else if (this.pointer < this.tail) {
      this.pointer = this.tail;
    }
    let mark = this.buffer[(this.size + this.pointer) % this.size];
    // skip marks that are temporarily removed from text buffer
    if (mark && !mark.find()) {
      const inc = offset > 0 ? 1 : -1;
      let newCur: Pos;
      const oldCur = cm.getCursor();
      do {
        this.pointer += inc;
        mark = this.buffer[(this.size + this.pointer) % this.size];
        // skip marks that are the same as current position
        if (mark && (newCur = mark.find()) && !cursorEqual(oldCur, newCur)) {
          break;
        }
      } while (this.pointer < this.head && this.pointer > this.tail);
    }
    return mark;
  }

  find(cm: CodeMirror, offset: number) {
    const oldPointer = this.pointer;
    const mark = this.move(cm, offset);
    this.pointer = oldPointer;
    return mark && mark.find();
  }
}

interface InsertModeChanges {
  changes: string[];
  expectCursorActivityForChange: boolean;
  visualBlock?: number;
  ignoreCount?: number;
  maybeReset?: boolean;
}

// Returns an object to track the changes associated insert mode.  It
// clones the object that is passed in, or creates an empty object one if
// none is provided.
const createInsertModeChanges = (c?: InsertModeChanges) =>
  c
    ? // Copy construction
      { ...c }
    : {
        // Change list
        changes: [],
        // Set to true on change, false on cursorActivity.
        expectCursorActivityForChange: false,
      };

class MacroModeState {
  latestRegister?: string = undefined;
  isPlaying = false;
  isRecording = false;
  replaySearchQueries: string[] = [];
  onRecordingDone: () => void = undefined;
  lastInsertModeChanges: InsertModeChanges;

  constructor() {
    this.lastInsertModeChanges = createInsertModeChanges();
  }

  exitMacroRecordMode() {
    if (this.onRecordingDone) {
      this.onRecordingDone(); // close dialog
    }
    this.onRecordingDone = undefined;
    this.isRecording = false;
  }

  enterMacroRecordMode(cm: CodeMirror, registerName: string) {
    const register =
      vimGlobalState.registerController.getRegister(registerName);
    if (register) {
      register.clear();
      this.latestRegister = registerName;
      this.onRecordingDone = cm.displayMessage(`(recording)[${registerName}]`);
      this.isRecording = true;
    }
  }
}

function maybeInitVimState(cm: CodeMirror): VimState {
  if (!cm.state.vim) {
    // Store instance state in the CodeMirror object.
    const vimState: VimState = {
      inputState: new InputState(),
      // Vim's input state that triggered the last edit, used to repeat
      // motions and operators with '.'.
      lastEditInputState: undefined,
      // Vim's action command before the last edit, used to repeat actions
      // with '.' and insert mode repeat.
      lastEditActionCommand: undefined,
      // When using jk for navigation, if you move from a longer line to a
      // shorter line, the cursor may clip to the end of the shorter line.
      // If j is pressed again and cursor goes to the next line, the
      // cursor should go back to its horizontal position on the longer
      // line if it can. This is to keep track of the horizontal position.
      lastHPos: -1,
      // Doing the same with screen-position for gj/gk
      lastHSPos: -1,
      // The last motion command run. Cleared if a non-motion command gets
      // executed in between.
      lastMotion: null,
      marks: {},
      insertMode: false,
      // Repeat count for changes made in insert mode, triggered by key
      // sequences like 3,i. Only exists when insertMode is true.
      insertModeRepeat: undefined,
      visualMode: false,
      // If we are in visual line mode. No effect if visualMode is false.
      visualLine: false,
      visualBlock: false,
      lastSelection: null,
      lastPastedText: null,
      sel: new CmSelection(makePos(0, 0), makePos(0, 0)),
      // Buffer-local/window-local values of vim options.
      options: {},
    };
    cm.state.vim = vimState;
  }
  return cm.state.vim as VimState;
}

let vimGlobalState: VimGlobalState;
function resetVimGlobalState() {
  vimGlobalState = {
    // The current search query.
    searchQuery: null,
    // Whether we are searching backwards.
    searchIsReversed: false,
    // Replace part of the last substituted pattern
    lastSubstituteReplacePart: undefined,
    jumpList: createCircularJumpList(),
    macroModeState: new MacroModeState(),
    // Recording latest f, t, F or T motion command.
    lastCharacterSearch: {
      increment: 0,
      forward: true,
      selectedCharacter: "",
    },
    registerController: new RegisterController({}),
    // search history buffer
    searchHistoryController: new HistoryController(),
    // ex Command history buffer
    exCommandHistoryController: new HistoryController(),
  };
  for (const optionName in options) {
    const option = options.get(optionName);
    option.value = option.defaultValue;
  }
}

let lastInsertModeKeyTimer: ReturnType<typeof setTimeout>;

class VimApi {
  suppressErrorLogging = false;
  InsertModeKey: InsertModeKey;

  constructor() {
    resetVimGlobalState();
  }

  buildKeyMap() {
    // TODO: Convert keymap into dictionary format for fast lookup.
  }
  // Testing hook, though it might be useful to expose the register
  // controller anyway.
  getRegisterController() {
    return vimGlobalState.registerController;
  }
  // Testing hook.
  resetVimGlobalState_() {
    resetVimGlobalState();
  }

  // Testing hook.
  getVimGlobalState_() {
    return vimGlobalState;
  }

  // Testing hook.
  maybeInitVimState_(cm: CodeMirror) {
    maybeInitVimState(cm);
  }

  map(lhs: string, rhs: string, ctx?: Context) {
    // Add user defined key bindings.
    exCommandDispatcher.map(lhs, rhs, ctx);
  }

  unmap(lhs: string, ctx?: Context) {
    return exCommandDispatcher.unmap(lhs, ctx);
  }
  // Non-recursive map function.
  // NOTE: This will not create mappings to key maps that aren't present
  // in the default key map. See TODO at bottom of function.
  noremap(lhs: string, rhs: string, ctx?: Context) {
    const toCtxArray = (ctx?: Context): Context[] => {
      return ctx ? [ctx] : ["normal", "insert", "visual"];
    };

    let ctxsToMap = toCtxArray(ctx);
    // Look through all actual defaults to find a map candidate.
    const actualLength = defaultKeymap.length;
    const origLength = defaultKeymapLength;
    for (
      let i = actualLength - origLength;
      i < actualLength && ctxsToMap.length;
      i++
    ) {
      const mapping = defaultKeymap[i];
      // Omit mappings that operate in the wrong context(s) and those of invalid type.
      if (
        mapping.keys == rhs &&
        (!ctx || !mapping.context || mapping.context === ctx) &&
        !mapping.type.startsWith("ex") &&
        !mapping.type.startsWith("key")
      ) {
        // Make a shallow copy of the original keymap entry.
        const newMapping: KeyMapping = { ...mapping };
        // Modify it point to the new mapping with the proper context.
        newMapping.keys = lhs;
        if (ctx && !newMapping.context) {
          newMapping.context = ctx;
        }
        // Add it to the keymap with a higher priority than the original.
        this._mapCommand(newMapping);
        // Record the mapped contexts as complete.
        const mappedCtxs = toCtxArray(mapping.context);
        ctxsToMap = ctxsToMap.filter(function (el) {
          return mappedCtxs.indexOf(el) === -1;
        });
      }
    }
    // TODO: Create non-recursive keyToKey mappings for the unmapped contexts once those exist.
  }
  // Remove all user-defined mappings for the provided context.
  mapclear(ctx?: Context) {
    // Partition the existing keymap into user-defined and true defaults.
    const actualLength = defaultKeymap.length;
    const origLength = defaultKeymapLength;
    const userKeymap = defaultKeymap.splice(0, actualLength - origLength);
    if (ctx) {
      // If a specific context is being cleared, we need to keep mappings
      // from all other contexts.
      for (let i = userKeymap.length - 1; i >= 0; i--) {
        const mapping = userKeymap[i];
        if (ctx !== mapping.context) {
          if (mapping.context) {
            this._mapCommand(mapping);
          } else {
            // `mapping` applies to all contexts so create keymap copies
            // for each context except the one being cleared.
            ["normal", "insert", "visual"]
              .filter((el) => el !== ctx)
              .forEach((el) => {
                const newMapping: KeyMapping = { ...mapping };
                newMapping.context = el as Context;
                this._mapCommand(newMapping);
              });
          }
        }
      }
    }
  }

  // TODO: Expose setOption and getOption as instance methods. Need to decide how to namespace
  // them, or somehow make them work with the existing CodeMirror setOption/getOption API.
  setOption(
    name: string,
    value: string | number | boolean,
    cm?: CodeMirror,
    cfg?: Config
  ) {
    setOption(name, value, cm, cfg);
  }

  getOption(name: string, cm?: CodeMirror, cfg?: Config) {
    return getOption(name, cm, cfg);
  }

  defineOption(
    name: string,
    defaultValue: string | number | boolean | undefined,
    type: "string" | "number" | "boolean",
    aliases?: string[],
    callback?: OptionCallback
  ): void {
    defineOption(name, defaultValue, type, aliases, callback);
  }

  defineEx(name: string, prefix: string, func: ExCommandFunc) {
    if (!prefix) {
      prefix = name;
    } else if (!name.startsWith(prefix)) {
      throw new Error(
        `(Vim.defineEx) "${prefix}" is not a prefix of "${name}", command not registered`
      );
    }
    exCommands[name] = func;
    exCommandDispatcher.commandMap_[prefix] = {
      name: name,
      shortName: prefix,
      type: "api",
    };
  }

  handleKey(cm: CodeMirror, key: string, origin?: string) {
    const command = this.findKey(cm, key, origin);
    if (typeof command === "function") {
      return command();
    }
  }

  /**
   * This is the outermost function called by CodeMirror, after keys have
   * been mapped to their Vim equivalents.
   *
   * Finds a command based on the key (and cached keys if there is a
   * multi-key sequence). Returns `undefined` if no key is matched, a noop
   * function if a partial match is found (multi-key), and a function to
   * execute the bound command if a a key is matched. The function always
   * returns true.
   */
  findKey(cm: CodeMirror, key: string, origin?: string) {
    const vim = maybeInitVimState(cm);
    const handleMacroRecording = () => {
      const macroModeState = vimGlobalState.macroModeState;
      if (macroModeState.isRecording) {
        if (key == "q") {
          macroModeState.exitMacroRecordMode();
          clearInputState(cm);
          return true;
        }
        if (origin != "mapping") {
          logKey(macroModeState, key);
        }
      }
    };
    const handleEsc = () => {
      if (key == "<Esc>") {
        if (vim.visualMode) {
          // Get back to normal mode.
          exitVisualMode(cm);
        } else if (vim.insertMode) {
          // Get back to normal mode.
          exitInsertMode(cm);
        } else {
          // We're already in normal mode. Let '<Esc>' be handled normally.
          return;
        }
        clearInputState(cm);
        return true;
      }
    };
    const doKeyToKey = (keys: string) => {
      // TODO: prevent infinite recursion.
      let match;
      while (keys) {
        // Pull off one command key, which is either a single character
        // or a special sequence wrapped in '<' and '>', e.g. '<Space>'.
        match = /<\w+-.+?>|<\w+>|./.exec(keys);
        key = match[0];
        keys = keys.substring(match.index + key.length);
        vimApi.handleKey(cm, key, "mapping");
      }
    };
    const handleKeyInsertMode = () => {
      if (handleEsc()) {
        return true;
      }
      let keys = (vim.inputState.keyBuffer = vim.inputState.keyBuffer + key);
      const keysAreChars = key.length == 1;
      let match = commandDispatcher.matchCommand(
        keys,
        defaultKeymap,
        vim.inputState,
        "insert"
      );
      // Need to check all key substrings in insert mode.
      while (keys.length > 1 && match.type != "full") {
        keys = vim.inputState.keyBuffer = keys.slice(1);
        const thisMatch = commandDispatcher.matchCommand(
          keys,
          defaultKeymap,
          vim.inputState,
          "insert"
        );
        if (thisMatch.type != "none") {
          match = thisMatch;
        }
      }
      if (match.type == "none") {
        clearInputState(cm);
        return false;
      } else if (match.type == "partial") {
        if (lastInsertModeKeyTimer) {
          window.clearTimeout(lastInsertModeKeyTimer);
        }
        lastInsertModeKeyTimer = setTimeout(() => {
          if (vim.insertMode && vim.inputState.keyBuffer) {
            clearInputState(cm);
          }
        }, getOption("insertModeEscKeysTimeout") as number);
        return !keysAreChars;
      }

      if (lastInsertModeKeyTimer) {
        window.clearTimeout(lastInsertModeKeyTimer);
      }
      if (keysAreChars) {
        cm.listSelections().forEach((sel) => {
          cm.replaceRange(
            "",
            offsetCursor(sel.head, 0, -(keys.length - 1)),
            sel.head
            //"+input"
          );
        });
        vimGlobalState.macroModeState.lastInsertModeChanges.changes.pop();
      }
      clearInputState(cm);
      return match.command;
    };

    const handleKeyNonInsertMode = () => {
      if (handleMacroRecording() || handleEsc()) {
        return true;
      }

      const keys = (vim.inputState.keyBuffer = vim.inputState.keyBuffer + key);
      if (/^[1-9]\d*$/.test(keys)) {
        return true;
      }

      let keysMatcher = /^(\d*)(.*)$/.exec(keys);
      if (!keysMatcher) {
        clearInputState(cm);
        return false;
      }
      const context: Context = vim.visualMode ? "visual" : "normal";
      let mainKey = keysMatcher[2] || keysMatcher[1];
      if (
        vim.inputState.operatorShortcut &&
        vim.inputState.operatorShortcut.slice(-1) == mainKey
      ) {
        // multikey operators act linewise by repeating only the last character
        mainKey = vim.inputState.operatorShortcut;
      }
      const match = commandDispatcher.matchCommand(
        mainKey,
        defaultKeymap,
        vim.inputState,
        context
      );
      if (match.type == "none") {
        clearInputState(cm);
        return false;
      } else if (match.type == "partial") {
        return true;
      }

      vim.inputState.keyBuffer = "";
      keysMatcher = /^(\d*)(.*)$/.exec(keys);
      if (keysMatcher[1] && keysMatcher[1] != "0") {
        vim.inputState.pushRepeatDigit(keysMatcher[1]);
      }
      return match.command;
    };

    const command = vim.insertMode
      ? handleKeyInsertMode()
      : handleKeyNonInsertMode();
    if (command === false) {
      return !vim.insertMode && key.length === 1 ? () => true : undefined;
    } else if (command === true) {
      // TODO: Look into using CodeMirror's multi-key handling.
      // Return no-op since we are caching the key. Counts as handled, but
      // don't want act on it just yet.
      return () => true;
    } else {
      return () => {
        cm.curOp.isVimOp = true;
        try {
          if (command.type == "keyToKey") {
            doKeyToKey(command.toKeys);
          } else {
            commandDispatcher.processCommand(cm, vim, command);
          }
        } catch (e) {
          // clear VIM state in case it's in a bad state.
          cm.state.vim = undefined;
          maybeInitVimState(cm);
          if (!vimApi.suppressErrorLogging) {
            console.log(e);
          }
          throw e;
        }
        return true;
      };
    }
  }

  handleEx(cm: CodeMirror, input: string) {
    exCommandDispatcher.processCommand(cm, input);
  }

  defineMotion(name: string, fn: MotionFunc) {
    defineMotion(name, fn);
  }

  defineAction(name: string, fn: ActionFunc) {
    defineAction(name, fn);
  }

  defineOperator(name: string, fn: OperatorFunc) {
    defineOperator(name, fn);
  }

  mapCommand(
    keys: string,
    type: MappableCommandType,
    name: string,
    args: MappableArgType,
    extra: any
  ) {
    mapCommand(keys, type, name, args, extra);
  }

  _mapCommand(command: KeyMapping) {
    _mapCommand(command);
  }

  defineRegister(name: string, register: Register) {
    defineRegister(name, register);
  }

  exitVisualMode(cm: CodeMirror, moveHead?: boolean) {
    exitVisualMode(cm, moveHead);
  }
  exitInsertMode(cm: CodeMirror) {
    exitInsertMode(cm);
  }
}

// Represents the current input state.
class InputState {
  prefixRepeat: string[] = [];
  motionRepeat: string[] = [];

  operator?: string;
  operatorArgs?: OperatorArgs = null;
  motion?: string = null;
  motionArgs?: MotionArgs = null;
  keyBuffer: string = ""; // For matching multi-key commands.
  registerName?: string = null; // Defaults to the unnamed register.
  selectedCharacter?: string;
  repeatOverride?: number;
  operatorShortcut?: string;

  pushRepeatDigit(n: string) {
    if (!this.operator) {
      this.prefixRepeat.push(n);
    } else {
      this.motionRepeat.push(n);
    }
  }

  getRepeat() {
    let repeat = 0;
    if (this.prefixRepeat.length > 0 || this.motionRepeat.length > 0) {
      repeat = 1;
      if (this.prefixRepeat.length > 0) {
        repeat *= parseInt(this.prefixRepeat.join(""), 10);
      }
      if (this.motionRepeat.length > 0) {
        repeat *= parseInt(this.motionRepeat.join(""), 10);
      }
    }
    return repeat;
  }
}

function clearInputState(cm: CodeMirror, reason?: string) {
  (cm.state.vim as VimState).inputState = new InputState();
  signal(cm, "vim-command-done", reason);
}

/*
 * Register stores information about copy and paste registers.  Besides
 * text, a register must store whether it is linewise (i.e., when it is
 * pasted, should it insert itself into a new line, or should the text be
 * inserted at the cursor position.)
 */
class Register {
  keyBuffer: string[];
  insertModeChanges: InsertModeChanges[] = [];
  searchQueries: string[] = [];
  linewise: boolean;
  blockwise: boolean;

  constructor(text?: string, linewise?: boolean, blockwise?: boolean) {
    this.keyBuffer = [text || ""];
    this.linewise = !!linewise;
    this.blockwise = !!blockwise;
  }
  setText(text: string, linewise?: boolean, blockwise?: boolean) {
    this.keyBuffer = [text || ""];
    this.linewise = !!linewise;
    this.blockwise = !!blockwise;
  }

  pushText(text: string, linewise?: boolean) {
    // if this register has ever been set to linewise, use linewise.
    if (linewise) {
      if (!this.linewise) {
        this.keyBuffer.push("\n");
      }
      this.linewise = true;
    }
    this.keyBuffer.push(text);
  }

  pushInsertModeChanges(changes: InsertModeChanges) {
    this.insertModeChanges.push(createInsertModeChanges(changes));
  }
  pushSearchQuery(query: string) {
    this.searchQueries.push(query);
  }

  clear() {
    this.keyBuffer = [];
    this.insertModeChanges = [];
    this.searchQueries = [];
    this.linewise = false;
  }

  toString() {
    return this.keyBuffer.join("");
  }
}

/**
 * Defines an external register.
 *
 * The name should be a single character that will be used to reference the register.
 * The register should support setText, pushText, clear, and toString(). See Register
 * for a reference implementation.
 */
function defineRegister(name: string, register: Register) {
  const registers = vimGlobalState.registerController.registers;
  if (!name || name.length != 1) {
    throw Error("Register name must be 1 character");
  }
  if (registers[name]) {
    throw Error("Register already defined " + name);
  }
  registers[name] = register;
  validRegisters.push(name);
}

/*
 * vim registers allow you to keep many independent copy and paste buffers.
 * See http://usevim.com/2012/04/13/registers/ for an introduction.
 *
 * RegisterController keeps the state of all the registers.  An initial
 * state may be passed in.  The unnamed register '"' will always be
 * overridden.
 */
class RegisterController {
  registers: Record<string, Register>;
  unnamedRegister: Register;

  constructor(registers: Record<string, Register>) {
    this.registers = registers;
    this.unnamedRegister = registers['"'] = new Register();
    registers["."] = new Register();
    registers[":"] = new Register();
    registers["/"] = new Register();
  }

  pushText(
    registerName: string,
    operator: string,
    text: string,
    linewise?: boolean,
    blockwise?: boolean
  ) {
    // The black hole register, "_, means delete/yank to nowhere.
    if (registerName === "_") return;
    if (linewise && text.charAt(text.length - 1) !== "\n") {
      text += "\n";
    }
    // Lowercase and uppercase registers refer to the same register.
    // Uppercase just means append.
    const register = this.isValidRegister(registerName)
      ? this.getRegister(registerName)
      : null;
    // if no register/an invalid register was specified, things go to the
    // default registers
    if (!register) {
      switch (operator) {
        case "yank":
          // The 0 register contains the text from the most recent yank.
          this.registers["0"] = new Register(text, linewise, blockwise);
          break;
        case "delete":
        case "change":
          if (text.indexOf("\n") == -1) {
            // Delete less than 1 line. Update the small delete register.
            this.registers["-"] = new Register(text, linewise);
          } else {
            // Shift down the contents of the numbered registers and put the
            // deleted text into register 1.
            this.shiftNumericRegisters_();
            this.registers["1"] = new Register(text, linewise);
          }
          break;
      }
      // Make sure the unnamed register is set to what just happened
      this.unnamedRegister.setText(text, linewise, blockwise);
      return;
    }

    // If we've gotten to this point, we've actually specified a register
    const append = isUpperCase(registerName);
    if (append) {
      register.pushText(text, linewise);
    } else {
      register.setText(text, linewise, blockwise);
    }
    // The unnamed register always has the same value as the last used
    // register.
    this.unnamedRegister.setText(register.toString(), linewise);
  }

  // Gets the register named @name.  If one of @name doesn't already exist,
  // create it.  If @name is invalid, return the unnamedRegister.
  getRegister(name: string) {
    if (!this.isValidRegister(name)) {
      return this.unnamedRegister;
    }
    name = name.toLowerCase();
    if (!this.registers[name]) {
      this.registers[name] = new Register();
    }
    return this.registers[name];
  }

  isValidRegister(name: string) {
    return name && inArray(name, validRegisters);
  }

  private shiftNumericRegisters_() {
    for (let i = 9; i >= 2; i--) {
      this.registers[i] = this.getRegister(`${i - 1}`);
    }
  }
}

class HistoryController {
  historyBuffer: string[] = [];
  iterator: number = 0;
  initialPrefix?: string = null;

  constructor() {}

  // the input argument here acts a user entered prefix for a small time
  // until we start autocompletion in which case it is the autocompleted.
  nextMatch(input: string, up: boolean) {
    const dir = up ? -1 : 1;
    if (this.initialPrefix === null) {
      this.initialPrefix = input;
    }
    let i = 0;
    for (
      i = this.iterator + dir;
      up ? i >= 0 : i < this.historyBuffer.length;
      i += dir
    ) {
      const element = this.historyBuffer[i];
      for (let j = 0; j <= element.length; j++) {
        if (this.initialPrefix == element.substring(0, j)) {
          this.iterator = i;
          return element;
        }
      }
    }
    // should return the user input in case we reach the end of buffer.
    if (i >= this.historyBuffer.length) {
      this.iterator = this.historyBuffer.length;
      return this.initialPrefix;
    }
    // return the last autocompleted query or exCommand as it is.
    if (i < 0) {
      return input;
    }
  }

  pushInput(input: string) {
    const index = this.historyBuffer.indexOf(input);
    if (index > -1) this.historyBuffer.splice(index, 1);
    if (input.length) this.historyBuffer.push(input);
  }

  reset() {
    this.initialPrefix = null;
    this.iterator = this.historyBuffer.length;
  }
}

class CommandDispatcher {
  matchCommand(
    keys: string,
    keyMap: KeyMapping[],
    inputState: InputState,
    context: Context
  ) {
    const matches = commandMatches(keys, keyMap, context, inputState);
    if (!matches.full && !matches.partial) {
      return { type: "none" };
    } else if (!matches.full && matches.partial) {
      return { type: "partial" };
    }

    let bestMatch;
    for (let i = 0; i < matches.full.length; i++) {
      const match = matches.full[i];
      if (!bestMatch) {
        bestMatch = match;
      }
    }
    if (bestMatch.keys.endsWith("<character>")) {
      const character = lastChar(keys);
      if (!character) return { type: "none" };
      inputState.selectedCharacter = character;
    }
    return { type: "full", command: bestMatch };
  }

  processCommand(cm: CodeMirror, vim: VimState, command: KeyMapping) {
    vim.inputState.repeatOverride = command.repeatOverride;
    switch (command.type) {
      case "motion":
        this.processMotion(cm, vim, command);
        break;
      case "operator":
        this.processOperator(cm, vim, command);
        break;
      case "operatorMotion":
        this.processOperatorMotion(cm, vim, command);
        break;
      case "action":
        this.processAction(cm, vim, command);
        break;
      case "search":
        this.processSearch(cm, vim, command);
        break;
      case "ex":
      case "keyToEx":
        this.processEx(cm, vim, command);
        break;
      default:
        break;
    }
  }

  processMotion(cm: CodeMirror, vim: VimState, command: KeyMapping) {
    vim.inputState.motion = command.motion;
    vim.inputState.motionArgs = copyArgs(command.motionArgs);
    this.evalInput(cm, vim);
  }

  processOperator(cm: CodeMirror, vim: VimState, command: KeyMapping) {
    const inputState = vim.inputState;
    if (inputState.operator) {
      if (inputState.operator == command.operator) {
        // Typing an operator twice like 'dd' makes the operator operate
        // linewise
        inputState.motion = "expandToLine";
        inputState.motionArgs = { linewise: true };
        this.evalInput(cm, vim);
        return;
      } else {
        // 2 different operators in a row doesn't make sense.
        clearInputState(cm);
      }
    }
    inputState.operator = command.operator;
    inputState.operatorArgs = copyArgs(command.operatorArgs);
    if (command.keys.length > 1) {
      inputState.operatorShortcut = command.keys;
    }
    if (command.exitVisualBlock) {
      vim.visualBlock = false;
      updateCmSelection(cm);
    }
    if (vim.visualMode) {
      // Operating on a selection in visual mode. We don't need a motion.
      this.evalInput(cm, vim);
    }
  }

  processOperatorMotion(cm: CodeMirror, vim: VimState, command: KeyMapping) {
    const visualMode = vim.visualMode;
    const operatorMotionArgs = copyArgs(command.operatorMotionArgs);
    if (operatorMotionArgs) {
      // Operator motions may have special behavior in visual mode.
      if (visualMode && operatorMotionArgs.visualLine) {
        vim.visualLine = true;
      }
    }
    this.processOperator(cm, vim, command);
    if (!visualMode) {
      this.processMotion(cm, vim, command);
    }
  }

  processAction(cm: CodeMirror, vim: VimState, command: KeyMapping) {
    const inputState = vim.inputState;
    const repeat = inputState.getRepeat();
    const repeatIsExplicit = !!repeat;
    const actionArgs = copyArgs(command.actionArgs) || {};
    if (inputState.selectedCharacter) {
      actionArgs.selectedCharacter = inputState.selectedCharacter;
    }
    // Actions may or may not have motions and operators. Do these first.
    if (command.operator) {
      this.processOperator(cm, vim, command);
    }
    if (command.motion) {
      this.processMotion(cm, vim, command);
    }
    if (command.motion || command.operator) {
      this.evalInput(cm, vim);
    }
    actionArgs.repeat = repeat || 1;
    actionArgs.repeatIsExplicit = repeatIsExplicit;
    actionArgs.registerName = inputState.registerName;
    clearInputState(cm);
    vim.lastMotion = null;
    if (command.isEdit) {
      this.recordLastEdit(vim, inputState, command);
    }
    actions[command.action](cm, actionArgs, vim);
  }

  processSearch(cm: CodeMirror, vim: VimState, command: KeyMapping) {
    if (!cm.getSearchCursor) {
      // Search depends on SearchCursor.
      return;
    }
    const forward = command.searchArgs.forward;
    const wholeWordOnly = command.searchArgs.wholeWordOnly;
    getSearchState(cm).setReversed(!forward);
    const promptPrefix = forward ? "/" : "?";
    const originalQuery = getSearchState(cm).getQuery();
    const originalScrollPos = cm.getScrollInfo();
    const handleQuery = (
      query: string,
      ignoreCase: boolean,
      smartCase: boolean
    ) => {
      vimGlobalState.searchHistoryController.pushInput(query);
      vimGlobalState.searchHistoryController.reset();
      try {
        updateSearchQuery(cm, query, ignoreCase, smartCase);
      } catch (e) {
        showConfirm(cm, "Invalid regex: " + query);
        clearInputState(cm);
        return;
      }
      commandDispatcher.processMotion(cm, vim, {
        keys: "",
        type: "motion",
        motion: "findNext",
        motionArgs: {
          forward: true,
          toJumplist: command.searchArgs.toJumplist,
        },
      });
    };
    const onPromptClose = (query: string) => {
      cm.scrollTo(originalScrollPos.left, originalScrollPos.top);
      handleQuery(query, true /** ignoreCase */, true /** smartCase */);
      const macroModeState = vimGlobalState.macroModeState;
      if (macroModeState.isRecording) {
        logSearchQuery(macroModeState, query);
      }
    };
    const onPromptKeyUp = (
      e: KeyboardEvent,
      query: string,
      close: (input?: string) => void
    ) => {
      const keyName = CodeMirror.keyName(e);
      let up: boolean;
      let offset: number;
      if (keyName == "Up" || keyName == "Down") {
        const target = e.target as HTMLInputElement;
        up = keyName == "Up" ? true : false;
        offset = e.target ? target.selectionEnd : 0;
        query =
          vimGlobalState.searchHistoryController.nextMatch(query, up) || "";
        close(query);
        if (offset && e.target)
          target.selectionEnd = target.selectionStart = Math.min(
            offset,
            target.value.length
          );
      } else {
        if (
          keyName != "Left" &&
          keyName != "Right" &&
          keyName != "Ctrl" &&
          keyName != "Alt" &&
          keyName != "Shift"
        )
          vimGlobalState.searchHistoryController.reset();
      }
      let parsedQuery: RegExp;
      try {
        parsedQuery = updateSearchQuery(
          cm,
          query,
          true /** ignoreCase */,
          true /** smartCase */
        );
      } catch (e) {
        // Swallow bad regexes for incremental search.
      }
      if (parsedQuery) {
        cm.scrollIntoView(findNext(cm, !forward, parsedQuery), 30);
      } else {
        clearSearchHighlight(cm);
        cm.scrollTo(originalScrollPos.left, originalScrollPos.top);
      }
    };
    const onPromptKeyDown = (
      e: KeyboardEvent,
      query: string,
      close: (text?: string) => void
    ): boolean => {
      const keyName = CodeMirror.keyName(e);
      if (
        keyName == "Esc" ||
        keyName == "Ctrl-C" ||
        keyName == "Ctrl-[" ||
        (keyName == "Backspace" && query == "")
      ) {
        vimGlobalState.searchHistoryController.pushInput(query);
        vimGlobalState.searchHistoryController.reset();
        updateSearchQuery(cm, originalQuery.source);
        clearSearchHighlight(cm);
        cm.scrollTo(originalScrollPos.left, originalScrollPos.top);
        CodeMirror.e_stop(e);
        clearInputState(cm);
        close();
        cm.focus();
      } else if (keyName == "Up" || keyName == "Down") {
        CodeMirror.e_stop(e);
      } else if (keyName == "Ctrl-U") {
        // Ctrl-U clears input.
        CodeMirror.e_stop(e);
        close("");
      }
      return false;
    };
    switch (command.searchArgs.querySrc) {
      case "prompt":
        const macroModeState = vimGlobalState.macroModeState;
        if (macroModeState.isPlaying) {
          const query = macroModeState.replaySearchQueries.shift();
          handleQuery(query, true /** ignoreCase */, false /** smartCase */);
        } else {
          showPrompt(cm, {
            onClose: onPromptClose,
            prefix: promptPrefix,
            desc: "(JavaScript regexp)",
            onKeyUp: onPromptKeyUp,
            onKeyDown: onPromptKeyDown,
          });
        }
        break;
      case "wordUnderCursor":
        let word = expandWordUnderCursor(
          cm,
          false /** inclusive */,
          true /** forward */,
          false /** bigWord */,
          true /** noSymbol */
        );
        let isKeyword = true;
        if (!word) {
          word = expandWordUnderCursor(
            cm,
            false /** inclusive */,
            true /** forward */,
            false /** bigWord */,
            false /** noSymbol */
          );
          isKeyword = false;
        }
        if (!word) {
          return;
        }
        let query = cm.getLine(word[0].line).substring(word[0].ch, word[1].ch);
        if (isKeyword && wholeWordOnly) {
          query = "\\b" + query + "\\b";
        } else {
          query = escapeRegex(query);
        }

        // cachedCursor is used to save the old position of the cursor
        // when * or # causes vim to seek for the nearest word and shift
        // the cursor before entering the motion.
        vimGlobalState.jumpList.cachedCursor = cm.getCursor();
        cm.setCursor(word[0]);

        handleQuery(query, true /** ignoreCase */, false /** smartCase */);
        break;
    }
  }

  processEx(cm: CodeMirror, vim: VimState, command: KeyMapping) {
    const onPromptClose = (input: string) => {
      // Give the prompt some time to close so that if processCommand shows
      // an error, the elements don't overlap.
      vimGlobalState.exCommandHistoryController.pushInput(input);
      vimGlobalState.exCommandHistoryController.reset();
      exCommandDispatcher.processCommand(cm, input);
    };
    const onPromptKeyDown = (
      e: KeyboardEvent,
      input: string,
      close: (value?: string) => void
    ): boolean => {
      const keyName = CodeMirror.keyName(e);
      let up;
      let offset;
      if (
        keyName == "Esc" ||
        keyName == "Ctrl-C" ||
        keyName == "Ctrl-[" ||
        (keyName == "Backspace" && input == "")
      ) {
        vimGlobalState.exCommandHistoryController.pushInput(input);
        vimGlobalState.exCommandHistoryController.reset();
        CodeMirror.e_stop(e);
        clearInputState(cm);
        close();
        cm.focus();
      }
      const target = e.target as HTMLInputElement;
      if (keyName == "Up" || keyName == "Down") {
        CodeMirror.e_stop(e);
        up = keyName == "Up" ? true : false;
        offset = target ? target.selectionEnd : 0;
        input =
          vimGlobalState.exCommandHistoryController.nextMatch(input, up) || "";
        close(input);
        if (offset && target)
          target.selectionEnd = target.selectionStart = Math.min(
            offset,
            target.value.length
          );
      } else if (keyName == "Ctrl-U") {
        // Ctrl-U clears input.
        CodeMirror.e_stop(e);
        close("");
      } else {
        if (
          keyName != "Left" &&
          keyName != "Right" &&
          keyName != "Ctrl" &&
          keyName != "Alt" &&
          keyName != "Shift"
        )
          vimGlobalState.exCommandHistoryController.reset();
      }
      return false;
    };
    if (command.type == "keyToEx") {
      // Handle user defined Ex to Ex mappings
      exCommandDispatcher.processCommand(cm, command.exArgs.input);
    } else {
      if (vim.visualMode) {
        showPrompt(cm, {
          onClose: onPromptClose,
          prefix: ":",
          value: "'<,'>",
          onKeyDown: onPromptKeyDown,
          selectValueOnOpen: false,
        });
      } else {
        showPrompt(cm, {
          onClose: onPromptClose,
          prefix: ":",
          onKeyDown: onPromptKeyDown,
        });
      }
    }
  }
  evalInput(cm: CodeMirror, vim: VimState) {
    // If the motion command is set, execute both the operator and motion.
    // Otherwise return.
    const inputState = vim.inputState;
    const motion = inputState.motion;
    const motionArgs = inputState.motionArgs || {};
    const operator = inputState.operator;
    const operatorArgs = inputState.operatorArgs || {};
    const registerName = inputState.registerName;
    let sel = vim.sel;
    // TODO: Make sure cm and vim selections are identical outside visual mode.
    const origHead = copyCursor(
      vim.visualMode ? clipCursorToContent(cm, sel.head) : cm.getCursor("head")
    );
    const origAnchor = copyCursor(
      vim.visualMode
        ? clipCursorToContent(cm, sel.anchor)
        : cm.getCursor("anchor")
    );
    const oldHead = copyCursor(origHead);
    const oldAnchor = copyCursor(origAnchor);
    let newHead: Pos;
    let newAnchor: Pos;
    if (operator) {
      this.recordLastEdit(vim, inputState);
    }
    // If repeatOverride is specified, that takes precedence over the
    // input state's repeat. Used by Ex mode and can be user defined.
    let repeat =
      inputState.repeatOverride !== undefined
        ? inputState.repeatOverride
        : inputState.getRepeat();

    if (repeat > 0 && motionArgs.explicitRepeat) {
      motionArgs.repeatIsExplicit = true;
    } else if (
      motionArgs.noRepeat ||
      (!motionArgs.explicitRepeat && repeat === 0)
    ) {
      repeat = 1;
      motionArgs.repeatIsExplicit = false;
    }
    if (inputState.selectedCharacter) {
      // If there is a character input, stick it in all of the arg arrays.
      motionArgs.selectedCharacter = operatorArgs.selectedCharacter =
        inputState.selectedCharacter;
    }
    motionArgs.repeat = repeat;
    clearInputState(cm);
    if (motion) {
      const motionResult = motions[motion](
        cm,
        origHead,
        motionArgs,
        vim,
        inputState
      );
      vim.lastMotion = motions[motion];
      if (!motionResult) {
        return;
      }
      if (motionArgs.toJumplist) {
        const jumpList = vimGlobalState.jumpList;
        // if the current motion is # or *, use cachedCursor
        const cachedCursor = jumpList.cachedCursor;
        if (cachedCursor) {
          recordJumpPosition(cm, cachedCursor, motionResult as Pos);
          delete jumpList.cachedCursor;
        } else {
          recordJumpPosition(cm, origHead, motionResult as Pos);
        }
      }
      if (motionResult instanceof Array) {
        newAnchor = motionResult[0];
        newHead = motionResult[1];
      } else {
        newHead = motionResult;
      }
      // TODO: Handle null returns from motion commands better.
      if (!newHead) {
        newHead = copyCursor(origHead);
      }
      if (vim.visualMode) {
        if (!(vim.visualBlock && newHead.ch === Infinity)) {
          newHead = clipCursorToContent(cm, newHead);
        }
        if (newAnchor) {
          newAnchor = clipCursorToContent(cm, newAnchor);
        }
        newAnchor = newAnchor || oldAnchor;
        sel = vim.sel = new CmSelection(newAnchor, newHead);
        updateCmSelection(cm);
        updateMark(
          cm,
          vim,
          "<",
          cursorIsBefore(newAnchor, newHead) ? newAnchor : newHead
        );
        updateMark(
          cm,
          vim,
          ">",
          cursorIsBefore(newAnchor, newHead) ? newHead : newAnchor
        );
      } else if (!operator) {
        newHead = clipCursorToContent(cm, newHead);
        cm.setCursor(newHead.line, newHead.ch);
      }
    }
    if (operator) {
      if (operatorArgs.lastSel) {
        // Replaying a visual mode operation
        newAnchor = oldAnchor;
        const lastSel = operatorArgs.lastSel;
        const lineOffset = Math.abs(lastSel.head.line - lastSel.anchor.line);
        const chOffset = Math.abs(lastSel.head.ch - lastSel.anchor.ch);
        if (lastSel.visualLine) {
          // Linewise Visual mode: The same number of lines.
          newHead = makePos(oldAnchor.line + lineOffset, oldAnchor.ch);
        } else if (lastSel.visualBlock) {
          // Blockwise Visual mode: The same number of lines and columns.
          newHead = makePos(
            oldAnchor.line + lineOffset,
            oldAnchor.ch + chOffset
          );
        } else if (lastSel.head.line == lastSel.anchor.line) {
          // Normal Visual mode within one line: The same number of characters.
          newHead = makePos(oldAnchor.line, oldAnchor.ch + chOffset);
        } else {
          // Normal Visual mode with several lines: The same number of lines, in the
          // last line the same number of characters as in the last line the last time.
          newHead = makePos(oldAnchor.line + lineOffset, oldAnchor.ch);
        }
        vim.visualMode = true;
        vim.visualLine = lastSel.visualLine;
        vim.visualBlock = lastSel.visualBlock;
        sel = vim.sel = new CmSelection(newAnchor, newHead);
        updateCmSelection(cm);
      } else if (vim.visualMode) {
        operatorArgs.lastSel = {
          anchor: copyCursor(sel.anchor),
          head: copyCursor(sel.head),
          visualBlock: vim.visualBlock,
          visualLine: vim.visualLine,
        };
      }
      let curStart: Pos;
      let curEnd: Pos;
      let linewise: boolean;
      let mode: "block" | "line" | "char";
      let cmSel: { ranges: CmSelection[]; primary: number };
      if (vim.visualMode) {
        // Init visual op
        curStart = cursorMin(sel.head, sel.anchor);
        curEnd = cursorMax(sel.head, sel.anchor);
        linewise = vim.visualLine || operatorArgs.linewise;
        mode = vim.visualBlock ? "block" : linewise ? "line" : "char";
        cmSel = makeCmSelection(cm, new CmSelection(curStart, curEnd), mode);
        if (linewise) {
          const ranges = cmSel.ranges;
          if (mode == "block") {
            // Linewise operators in visual block mode extend to end of line
            for (let i = 0; i < ranges.length; i++) {
              ranges[i].head.ch = lineLength(cm, ranges[i].head.line);
            }
          } else if (mode == "line") {
            ranges[0].head.line = ranges[0].head.line + 1;
            ranges[0].head.ch = 0;
          }
        }
      } else {
        // Init motion op
        curStart = copyCursor(newAnchor || oldAnchor);
        curEnd = copyCursor(newHead || oldHead);
        if (cursorIsBefore(curEnd, curStart)) {
          const tmp = curStart;
          curStart = curEnd;
          curEnd = tmp;
        }
        linewise = motionArgs.linewise || operatorArgs.linewise;
        if (linewise) {
          // Expand selection to entire line.
          expandSelectionToLine(cm, curStart, curEnd);
        } else if (motionArgs.forward) {
          // Clip to trailing newlines only if the motion goes forward.
          clipToLine(cm, curStart, curEnd);
        }
        mode = "char";
        const exclusive = !motionArgs.inclusive || linewise;
        cmSel = makeCmSelection(
          cm,
          new CmSelection(curStart, curEnd),
          mode,
          exclusive
        );
      }
      cm.setSelections(cmSel.ranges, cmSel.primary);
      vim.lastMotion = null;
      operatorArgs.repeat = repeat; // For indent in visual mode.
      operatorArgs.registerName = registerName;
      // Keep track of linewise as it affects how paste and change behave.
      operatorArgs.linewise = linewise;
      const operatorMoveTo = operators[operator](
        cm,
        operatorArgs,
        cmSel.ranges,
        oldAnchor,
        newHead
      );
      if (vim.visualMode) {
        exitVisualMode(cm, operatorMoveTo != null);
      }
      if (operatorMoveTo) {
        cm.setCursor(operatorMoveTo);
      }
    }
  }
  recordLastEdit(
    vim: VimState,
    inputState: InputState,
    actionCommand?: KeyMapping
  ) {
    const macroModeState = vimGlobalState.macroModeState;
    if (macroModeState.isPlaying) {
      return;
    }
    vim.lastEditInputState = inputState;
    vim.lastEditActionCommand = actionCommand;
    macroModeState.lastInsertModeChanges.changes = [];
    macroModeState.lastInsertModeChanges.expectCursorActivityForChange = false;
    macroModeState.lastInsertModeChanges.visualBlock = vim.visualBlock
      ? vim.sel.head.line - vim.sel.anchor.line
      : 0;
  }
}
const commandDispatcher = new CommandDispatcher();

/**
 * typedef {Object{line:number,ch:number}} Cursor An object containing the
 *     position of the cursor.
 */
// All of the functions below return Cursor objects.
type MotionFunc = (
  cm: CodeMirror,
  head: Pos,
  motionArgs: MotionArgs,
  vim: VimState,
  previousInputState: InputState
) => MotionResult;
type MotionResult = Pos | [Pos, Pos] | undefined;
const motions: Record<string, MotionFunc> = {
  moveToTopLine: function (cm, _head, motionArgs) {
    const line = getUserVisibleLines(cm).top + motionArgs.repeat - 1;
    return makePos(line, findFirstNonWhiteSpaceCharacter(cm.getLine(line)));
  },
  moveToMiddleLine: function (cm) {
    const range = getUserVisibleLines(cm);
    const line = Math.floor((range.top + range.bottom) * 0.5);
    return makePos(line, findFirstNonWhiteSpaceCharacter(cm.getLine(line)));
  },
  moveToBottomLine: function (cm, _head, motionArgs) {
    const line = getUserVisibleLines(cm).bottom - motionArgs.repeat + 1;
    return makePos(line, findFirstNonWhiteSpaceCharacter(cm.getLine(line)));
  },
  expandToLine: function (_cm, head, motionArgs) {
    // Expands forward to end of line, and then to next line if repeat is
    // >1. Does not handle backward motion!
    return makePos(head.line + motionArgs.repeat - 1, Infinity);
  },
  findNext: function (cm, _head, motionArgs) {
    const state = getSearchState(cm);
    const query = state.getQuery();
    if (!query) {
      return;
    }
    let prev = !motionArgs.forward;
    // If search is initiated with ? instead of /, negate direction.
    prev = state.isReversed() ? !prev : prev;
    highlightSearchMatches(cm, query);
    return findNext(cm, prev /** prev */, query, motionArgs.repeat);
  },
  /**
   * Find and select the next occurrence of the search query. If the cursor is currently
   * within a match, then find and select the current match. Otherwise, find the next occurrence in the
   * appropriate direction.
   *
   * This differs from `findNext` in the following ways:
   *
   * 1. Instead of only returning the "from", this returns a "from", "to" range.
   * 2. If the cursor is currently inside a search match, this selects the current match
   *    instead of the next match.
   * 3. If there is no associated operator, this will turn on visual mode.
   */
  findAndSelectNextInclusive: function (
    cm,
    _head,
    motionArgs,
    vim,
    prevInputState
  ) {
    const state = getSearchState(cm);
    const query = state.getQuery();

    if (!query) {
      return;
    }

    let prev = !motionArgs.forward;
    prev = state.isReversed() ? !prev : prev;

    // next: [from, to] | null
    const next = findNextFromAndToInclusive(
      cm,
      prev,
      query,
      motionArgs.repeat,
      vim
    );

    // No matches.
    if (!next) {
      return;
    }

    // If there's an operator that will be executed, return the selection.
    if (prevInputState.operator) {
      return next;
    }

    // At this point, we know that there is no accompanying operator -- let's
    // deal with visual mode in order to select an appropriate match.

    const from = next[0];
    // For whatever reason, when we use the "to" as returned by searchcursor.js directly,
    // the resulting selection is extended by 1 char. Let's shrink it so that only the
    // match is selected.
    const to = makePos(next[1].line, next[1].ch - 1);

    if (vim.visualMode) {
      // If we were in visualLine or visualBlock mode, get out of it.
      if (vim.visualLine || vim.visualBlock) {
        vim.visualLine = false;
        vim.visualBlock = false;
        signal(cm, "vim-mode-change", {
          mode: "visual",
          subMode: "",
        });
      }

      // If we're currently in visual mode, we should extend the selection to include
      // the search result.
      const anchor = vim.sel.anchor;
      if (anchor) {
        if (state.isReversed()) {
          if (motionArgs.forward) {
            return [anchor, from];
          }

          return [anchor, to];
        } else {
          if (motionArgs.forward) {
            return [anchor, to];
          }

          return [anchor, from];
        }
      }
    } else {
      // Let's turn visual mode on.
      vim.visualMode = true;
      vim.visualLine = false;
      vim.visualBlock = false;
      signal(cm, "vim-mode-change", {
        mode: "visual",
        subMode: "",
      });
    }

    return prev ? [to, from] : [from, to];
  },
  goToMark: function (cm, _head, motionArgs, vim) {
    const pos = getMarkPos(cm, vim, motionArgs.selectedCharacter);
    if (pos) {
      return motionArgs.linewise
        ? makePos(
            pos.line,
            findFirstNonWhiteSpaceCharacter(cm.getLine(pos.line))
          )
        : pos;
    }
    return;
  },
  moveToOtherHighlightedEnd: function (cm, _head, motionArgs, vim) {
    if (vim.visualBlock && motionArgs.sameLine) {
      const sel = vim.sel;
      return [
        clipCursorToContent(cm, makePos(sel.anchor.line, sel.head.ch)),
        clipCursorToContent(cm, makePos(sel.head.line, sel.anchor.ch)),
      ];
    } else {
      return [vim.sel.head, vim.sel.anchor];
    }
  },
  jumpToMark: function (cm, head, motionArgs, vim) {
    let best = head;
    for (let i = 0; i < motionArgs.repeat; i++) {
      let cursor = best;
      for (const key in vim.marks) {
        if (!isLowerCase(key)) {
          continue;
        }
        const mark = vim.marks[key].find();
        const isWrongDirection = motionArgs.forward
          ? cursorIsBefore(mark, cursor)
          : cursorIsBefore(cursor, mark);

        if (isWrongDirection) {
          continue;
        }
        if (motionArgs.linewise && mark.line == cursor.line) {
          continue;
        }

        const equal = cursorEqual(cursor, best);
        const between = motionArgs.forward
          ? cursorIsBetween(cursor, mark, best)
          : cursorIsBetween(best, mark, cursor);

        if (equal || between) {
          best = mark;
        }
      }
    }

    if (motionArgs.linewise) {
      // Vim places the cursor on the first non-whitespace character of
      // the line if there is one, else it places the cursor at the end
      // of the line, regardless of whether a mark was found.
      best = makePos(
        best.line,
        findFirstNonWhiteSpaceCharacter(cm.getLine(best.line))
      );
    }
    return best;
  },
  moveByCharacters: function (_cm, head, motionArgs) {
    const cur = head;
    const repeat = motionArgs.repeat || 0;
    const ch = motionArgs.forward ? cur.ch + repeat : cur.ch - repeat;
    return makePos(cur.line, ch);
  },
  moveByLines: function (cm, head, motionArgs, vim) {
    const cur = head;
    let endCh = cur.ch;
    // Depending what our last motion was, we may want to do different
    // things. If our last motion was moving vertically, we want to
    // preserve the HPos from our last horizontal move.  If our last motion
    // was going to the end of a line, moving vertically we should go to
    // the end of the line, etc.
    switch (vim.lastMotion) {
      case this.moveByLines:
      case this.moveByDisplayLines:
      case this.moveByScroll:
      case this.moveToColumn:
      case this.moveToEol:
        endCh = vim.lastHPos;
        break;
      default:
        vim.lastHPos = endCh;
    }
    const repeat = (motionArgs.repeat || 0) + (motionArgs.repeatOffset || 0);
    let line = motionArgs.forward ? cur.line + repeat : cur.line - repeat;
    const first = cm.firstLine();
    const last = cm.lastLine();
    const posV = cm.findPosV(
      cur,
      motionArgs.forward ? repeat : -repeat,
      "line"
      // vim.lastHSPos
    );
    const hasMarkedText = motionArgs.forward
      ? posV.line > line
      : posV.line < line;
    if (hasMarkedText) {
      line = posV.line;
      endCh = posV.ch;
    }
    // Vim go to line begin or line end when cursor at first/last line and
    // move to previous/next line is triggered.
    if (line < first && cur.line == first) {
      return this.moveToStartOfLine(cm, head, motionArgs, vim);
    } else if (line > last && cur.line == last) {
      return moveToEol(cm, head, motionArgs, vim, true);
    }
    if (motionArgs.toFirstChar) {
      endCh = findFirstNonWhiteSpaceCharacter(cm.getLine(line));
      vim.lastHPos = endCh;
    }
    vim.lastHSPos = cm.charCoords(makePos(line, endCh), "div").left;
    return makePos(line, endCh);
  },
  moveByDisplayLines: function (cm, head, motionArgs, vim) {
    const cur = head;
    switch (vim.lastMotion) {
      case this.moveByDisplayLines:
      case this.moveByScroll:
      case this.moveByLines:
      case this.moveToColumn:
      case this.moveToEol:
        break;
      default:
        vim.lastHSPos = cm.charCoords(cur, "div").left;
    }
    const repeat = motionArgs.repeat || 0;
    let res = cm.findPosV(
      cur,
      motionArgs.forward ? repeat : -repeat,
      "line"
      // vim.lastHSPos
    );
    vim.lastHPos = res.ch;
    return res;
  },
  moveByPage: function (cm, head, motionArgs) {
    // CodeMirror only exposes functions that move the cursor page down, so
    // doing this bad hack to move the cursor and move it back. evalInput
    // will move the cursor to where it should be in the end.
    const curStart = head;
    const repeat = motionArgs.repeat;
    return cm.findPosV(curStart, motionArgs.forward ? repeat : -repeat, "page");
  },
  moveByParagraph: function (cm, head, motionArgs) {
    const dir = motionArgs.forward ? 1 : -1;
    return findParagraph(cm, head, motionArgs.repeat, dir);
  },
  moveBySentence: function (cm, head, motionArgs) {
    const dir = motionArgs.forward ? 1 : -1;
    return findSentence(cm, head, motionArgs.repeat, dir);
  },
  moveByScroll: function (cm, head, motionArgs, vim) {
    const scrollbox = cm.getScrollInfo();
    let repeat = motionArgs.repeat;
    if (!repeat) {
      repeat = scrollbox.clientHeight / (2 * cm.defaultTextHeight());
    }
    const orig = cm.charCoords(head, "local");
    motionArgs.repeat = repeat;
    const curEnd = motions.moveByDisplayLines(
      cm,
      head,
      motionArgs,
      vim,
      undefined
    );
    if (!curEnd) {
      return null;
    }
    const dest = cm.charCoords(curEnd as Pos, "local");
    cm.scrollTo(null, scrollbox.top + dest.top - orig.top);
    return curEnd;
  },
  moveByWords: function (cm, head, motionArgs) {
    return moveToWord(
      cm,
      head,
      motionArgs.repeat,
      !!motionArgs.forward,
      !!motionArgs.wordEnd,
      !!motionArgs.bigWord
    );
  },
  moveTillCharacter: function (cm, _head, motionArgs) {
    const repeat = motionArgs.repeat || 0;
    const curEnd = moveToCharacter(
      cm,
      repeat,
      motionArgs.forward,
      motionArgs.selectedCharacter
    );
    const increment = motionArgs.forward ? -1 : 1;
    recordLastCharacterSearch(increment, motionArgs);
    if (!curEnd) return null;
    curEnd.ch += increment;
    return curEnd;
  },
  moveToCharacter: function (cm, head, motionArgs) {
    const repeat = motionArgs.repeat || 0;
    recordLastCharacterSearch(0, motionArgs);
    return (
      moveToCharacter(
        cm,
        repeat,
        motionArgs.forward,
        motionArgs.selectedCharacter
      ) || head
    );
  },
  moveToSymbol: function (cm, head, motionArgs) {
    const repeat = motionArgs.repeat || 0;
    return (
      findSymbol(
        cm,
        repeat,
        motionArgs.forward,
        motionArgs.selectedCharacter
      ) || head
    );
  },
  moveToColumn: function (cm, head, motionArgs, vim) {
    const repeat = motionArgs.repeat || 0;
    // repeat is equivalent to which column we want to move to!
    vim.lastHPos = repeat - 1;
    vim.lastHSPos = cm.charCoords(head, "div").left;
    return moveToColumn(cm, repeat);
  },
  moveToEol: function (cm, head, motionArgs, vim) {
    return moveToEol(cm, head, motionArgs, vim, false);
  },
  moveToFirstNonWhiteSpaceCharacter: function (cm, head) {
    // Go to the start of the line where the text begins, or the end for
    // whitespace-only lines
    const cursor = head;
    return makePos(
      cursor.line,
      findFirstNonWhiteSpaceCharacter(cm.getLine(cursor.line))
    );
  },
  moveToMatchedSymbol: function (cm, head) {
    const lineText = cm.getLine(head.line);
    // var symbol;
    // for (; ch < lineText.length; ch++) {
    //   symbol = lineText.charAt(ch);
    //   if (symbol && isMatchableSymbol(symbol)) {
    //     var style = cm.getTokenTypeAt(new Pos(line, ch + 1));
    //     if (style !== "string" && style !== "comment") {
    //       break;
    //     }
    //   }
    // }
    if (head.ch < lineText.length) {
      const matched = cm.findMatchingBracket(head);
      return matched.to;
    } else {
      return head;
    }
  },
  moveToStartOfLine: function (_cm, head) {
    return makePos(head.line, 0);
  },
  moveToLineOrEdgeOfDocument: function (cm, _head, motionArgs) {
    let lineNum = motionArgs.forward ? cm.lastLine() : cm.firstLine();
    if (motionArgs.repeatIsExplicit) {
      lineNum = motionArgs.repeat - cm.getOption("firstLineNumber");
    }
    return makePos(
      lineNum,
      findFirstNonWhiteSpaceCharacter(cm.getLine(lineNum))
    );
  },
  moveToStartOfDisplayLine: function (cm) {
    cm.execCommand("goLineLeft");
    return cm.getCursor();
  },
  moveToEndOfDisplayLine: function (cm) {
    cm.execCommand("goLineRight");
    return cm.getCursor();
  },
  textObjectManipulation: function (cm, head, motionArgs, vim) {
    // TODO: lots of possible exceptions that can be thrown here. Try da(
    //     outside of a () block.
    const mirroredPairs: Record<string, string> = {
      "(": ")",
      ")": "(",
      "{": "}",
      "}": "{",
      "[": "]",
      "]": "[",
      "<": ">",
      ">": "<",
    };
    const selfPaired: Record<string, boolean> = {
      "'": true,
      '"': true,
      "`": true,
    };

    let character = motionArgs.selectedCharacter;
    // 'b' refers to  '()' block.
    // 'B' refers to  '{}' block.
    if (character == "b") {
      character = "(";
    } else if (character == "B") {
      character = "{";
    }

    // Inclusive is the difference between a and i
    // TODO: Instead of using the additional text object map to perform text
    //     object operations, merge the map into the defaultKeyMap and use
    //     motionArgs to define behavior. Define separate entries for 'aw',
    //     'iw', 'a[', 'i[', etc.
    const inclusive = !motionArgs.textObjectInner;

    let tmp: [Pos, Pos];
    if (mirroredPairs[character]) {
      tmp = selectCompanionObject(cm, head, character, inclusive);
    } else if (selfPaired[character]) {
      tmp = findBeginningAndEnd(cm, head, character, inclusive);
    } else if (character === "W") {
      tmp = expandWordUnderCursor(
        cm,
        inclusive,
        true /** forward */,
        true /** bigWord */
      );
    } else if (character === "w") {
      tmp = expandWordUnderCursor(
        cm,
        inclusive,
        true /** forward */,
        false /** bigWord */
      );
    } else if (character === "p") {
      const para = findParagraph(cm, head, motionArgs.repeat, 0, inclusive);
      tmp = Array.isArray(para) ? para : [para, para];
      motionArgs.linewise = true;
      if (vim.visualMode) {
        if (!vim.visualLine) {
          vim.visualLine = true;
        }
      } else {
        const operatorArgs = vim.inputState.operatorArgs;
        if (operatorArgs) {
          operatorArgs.linewise = true;
        }
        tmp[1].line--;
      }
    } else if (character === "t") {
      tmp = expandTagUnderCursor(cm, head, inclusive);
    } else {
      // No text object defined for this, don't move.
      return null;
    }

    if (!cm.state.vim.visualMode) {
      return tmp;
    } else {
      return expandSelection(cm, tmp[0], tmp[1]);
    }
  },

  repeatLastCharacterSearch: function (cm, head, motionArgs) {
    const lastSearch = vimGlobalState.lastCharacterSearch;
    const repeat = motionArgs.repeat || 0;
    const forward = motionArgs.forward === lastSearch.forward;
    const increment = (lastSearch.increment ? 1 : 0) * (forward ? -1 : 1);
    cm.moveH(-increment, "char");
    motionArgs.inclusive = forward ? true : false;
    const curEnd = moveToCharacter(
      cm,
      repeat,
      forward,
      lastSearch.selectedCharacter
    );
    if (!curEnd) {
      cm.moveH(increment, "char");
      return head;
    }
    curEnd.ch += increment;
    return curEnd;
  },
};

const defineMotion = (name: string, fn: MotionFunc) => (motions[name] = fn);

const fillArray = <T>(val: T, times: number): T[] => new Array(times).fill(val);

/**
 * An operator acts on a text selection. It receives the list of selections
 * as input. The corresponding CodeMirror selection is guaranteed to
 * match the input selection.
 */
type OperatorFunc = (
  cm: CodeMirror,
  args: OperatorArgs,
  ranges: CmSelection[],
  oldAnchor: Pos,
  newHead: Pos
) => Pos | void;
const operators: Record<string, OperatorFunc> = {
  change: function (cm, args, ranges) {
    const vim = cm.state.vim as VimState;
    const anchor = ranges[0].anchor;
    let head = ranges[0].head;
    let finalHead: Pos;
    let text: string;
    if (!vim.visualMode) {
      text = cm.getRange(anchor, head);
      const lastState = vim.lastEditInputState;
      if (
        lastState &&
        lastState.motion === "moveByWords" &&
        !isWhiteSpaceString(text)
      ) {
        // Exclude trailing whitespace if the range is not all whitespace.
        const match = /\s+$/.exec(text);
        if (match && lastState.motionArgs && lastState.motionArgs.forward) {
          head = offsetCursor(head, 0, -match[0].length);
          text = text.slice(0, -match[0].length);
        }
      }
      const prevLineEnd = makePos(anchor.line - 1, Infinity);
      const wasLastLine = cm.firstLine() == cm.lastLine();
      if (head.line > cm.lastLine() && args.linewise && !wasLastLine) {
        cm.replaceRange("", prevLineEnd, head);
      } else {
        cm.replaceRange("", anchor, head);
      }
      if (args.linewise) {
        // Push the next line back down, if there is a next line.
        if (!wasLastLine) {
          cm.setCursor(prevLineEnd);
          CodeMirror.commands.newlineAndIndent(cm);
        }
        // make sure cursor ends up at the end of the line.
        anchor.ch = Number.MAX_VALUE;
      }
      finalHead = anchor;
    } else if (args.fullLine) {
      head.ch = Number.MAX_VALUE;
      head.line--;
      cm.setSelection(anchor, head);
      text = cm.getSelection();
      cm.replaceSelections([""]);
      finalHead = anchor;
    } else {
      text = cm.getSelection();
      const replacement = fillArray("", ranges.length);
      cm.replaceSelections(replacement);
      finalHead = cursorMin(ranges[0].head, ranges[0].anchor);
    }
    vimGlobalState.registerController.pushText(
      args.registerName,
      "change",
      text,
      args.linewise,
      ranges.length > 1
    );
    actions.enterInsertMode(cm, { head: finalHead }, cm.state.vim);
  },
  // delete is a javascript keyword.
  delete: function (cm, args, ranges) {
    // Add to the undo stack explicitly so that this delete is recorded as a
    // specific action instead of being bundled with generic other edits.
    cm.pushUndoStop();
    let finalHead: Pos;
    let text: string;
    const vim = cm.state.vim as VimState;
    if (!vim.visualBlock) {
      let anchor = ranges[0].anchor,
        head = ranges[0].head;
      if (
        args.linewise &&
        head.line != cm.firstLine() &&
        anchor.line == cm.lastLine() &&
        anchor.line == head.line - 1
      ) {
        // Special case for dd on last line (and first line).
        if (anchor.line == cm.firstLine()) {
          anchor.ch = 0;
        } else {
          anchor = makePos(anchor.line - 1, lineLength(cm, anchor.line - 1));
        }
      }
      text = cm.getRange(anchor, head);
      cm.replaceRange("", anchor, head);
      finalHead = anchor;
      if (args.linewise) {
        const res = motions.moveToFirstNonWhiteSpaceCharacter(
          cm,
          anchor,
          {},
          undefined,
          undefined
        );
        finalHead = Array.isArray(res) ? res[0] : res;
      }
    } else {
      text = cm.getSelection();
      const replacement = fillArray("", ranges.length);
      cm.replaceSelections(replacement);
      finalHead = cursorMin(ranges[0].head, ranges[0].anchor);
    }
    vimGlobalState.registerController.pushText(
      args.registerName,
      "delete",
      text,
      args.linewise,
      vim.visualBlock
    );
    return clipCursorToContent(cm, finalHead);
  },
  indent: function (cm, args, ranges) {
    const vim = cm.state.vim as VimState;
    const startLine = ranges[0].anchor.line;
    let endLine = vim.visualBlock
      ? ranges[ranges.length - 1].anchor.line
      : ranges[0].head.line;
    // In visual mode, n> shifts the selection right n times, instead of
    // shifting n lines right once.
    let repeat = vim.visualMode ? args.repeat || 0 : 1;
    if (args.linewise) {
      // The only way to delete a newline is to delete until the start of
      // the next line, so in linewise mode evalInput will include the next
      // line. We don't want this in indent, so we go back a line.
      endLine--;
    }
    cm.pushUndoStop();
    for (let i = startLine; i <= endLine; i++) {
      for (let j = 0; j < repeat; j++) {
        cm.indentLine(i, args.indentRight);
      }
    }
    cm.pushUndoStop();
    const res = motions.moveToFirstNonWhiteSpaceCharacter(
      cm,
      ranges[0].anchor,
      {},
      vim,
      undefined
    );
    return Array.isArray(res) ? res[0] : res;
  },
  indentAuto: function (cm, _args, ranges) {
    cm.execCommand("indentAuto");
    const res = motions.moveToFirstNonWhiteSpaceCharacter(
      cm,
      ranges[0].anchor,
      {},
      undefined,
      undefined
    );
    return Array.isArray(res) ? res[0] : res;
  },
  changeCase: function (cm, args, ranges, oldAnchor, newHead) {
    const selections = cm.getSelections();
    const toLower = args.toLower;

    const swapped = selections.map((toSwap) => {
      if (toLower === true) {
        return toSwap.toLowerCase();
      } else if (toLower === false) {
        return toSwap.toUpperCase();
      } else {
        return Array.from(toSwap)
          .map((character) =>
            isUpperCase(character)
              ? character.toLowerCase()
              : character.toUpperCase()
          )
          .join("");
      }
    });
    cm.replaceSelections(swapped);
    if (args.shouldMoveCursor) {
      return newHead;
    } else if (
      !cm.state.vim.visualMode &&
      args.linewise &&
      ranges[0].anchor.line + 1 == ranges[0].head.line
    ) {
      const res = motions.moveToFirstNonWhiteSpaceCharacter(
        cm,
        oldAnchor,
        {},
        undefined,
        undefined
      );
      return Array.isArray(res) ? res[0] : res;
    } else if (args.linewise) {
      return oldAnchor;
    } else {
      return cursorMin(ranges[0].anchor, ranges[0].head);
    }
  },
  yank: function (cm, args, ranges, oldAnchor) {
    const vim = cm.state.vim as VimState;
    const text = cm.getSelection();
    const endPos = vim.visualMode
      ? cursorMin(
          vim.sel.anchor,
          vim.sel.head,
          ranges[0].head,
          ranges[0].anchor
        )
      : oldAnchor;
    vimGlobalState.registerController.pushText(
      args.registerName,
      "yank",
      text,
      args.linewise,
      vim.visualBlock
    );
    return endPos;
  },
};

const defineOperator = (name: string, fn: OperatorFunc) =>
  (operators[name] = fn);

type ActionFunc = (
  cm: CodeMirror,
  actionArgs: ActionArgs,
  vim: VimState
) => void;
const actions: Record<string, ActionFunc> = {
  jumpListWalk: function (cm, actionArgs, vim) {
    if (vim.visualMode) {
      return;
    }
    const repeat = actionArgs.repeat || 0;
    const forward = actionArgs.forward;
    const jumpList = vimGlobalState.jumpList;

    const mark = jumpList.move(cm, forward ? repeat : -repeat);
    const markPos = mark ? mark.find() : cm.getCursor();
    cm.setCursor(markPos);
  },
  scroll: function (cm, actionArgs, vim) {
    if (vim.visualMode) {
      return;
    }
    const repeat = actionArgs.repeat || 1;
    const lineHeight = cm.defaultTextHeight();
    const top = cm.getScrollInfo().top;
    const delta = lineHeight * repeat;
    const newPos = actionArgs.forward ? top + delta : top - delta;
    const cursor = copyCursor(cm.getCursor());
    let cursorCoords = cm.charCoords(cursor, "local");
    if (actionArgs.forward) {
      if (newPos > cursorCoords.top) {
        cursor.line += (newPos - cursorCoords.top) / lineHeight;
        cursor.line = Math.ceil(cursor.line);
        cm.setCursor(cursor);
        cursorCoords = cm.charCoords(cursor, "local");
        cm.scrollTo(null, cursorCoords.top);
      } else {
        // Cursor stays within bounds.  Just reposition the scroll window.
        cm.scrollTo(null, newPos);
      }
    } else {
      // TODO: none of this can work becauso cursorCoords doesn't have bottom
      //const newBottom = newPos + cm.getScrollInfo().clientHeight;
      //if (newBottom < cursorCoords.bottom) {
      //  cursor.line -= (cursorCoords.bottom - newBottom) / lineHeight;
      //  cursor.line = Math.floor(cursor.line);
      //  cm.setCursor(cursor);
      //  cursorCoords = cm.charCoords(cursor, "local");
      //  cm.scrollTo(
      //    null,
      //    cursorCoords.bottom - cm.getScrollInfo().clientHeight
      //  );
      //} else {
      //  // Cursor stays within bounds.  Just reposition the scroll window.
      //  cm.scrollTo(null, newPos);
      //}
      cm.scrollTo(null, newPos);
    }
  },
  scrollToCursor: function (cm, actionArgs) {
    if (actionArgs.position) {
      cm.moveCurrentLineTo(actionArgs.position);
    } else {
      cm.scrollTo(null, cm.getCursor().line);
    }
  },
  replayMacro: function (cm, actionArgs, vim) {
    let registerName = actionArgs.selectedCharacter;
    let repeat = actionArgs.repeat || 1;
    const macroModeState = vimGlobalState.macroModeState;
    if (registerName == "@") {
      registerName = macroModeState.latestRegister;
    } else {
      macroModeState.latestRegister = registerName;
    }
    while (repeat--) {
      executeMacroRegister(cm, vim, macroModeState, registerName);
    }
  },
  enterMacroRecordMode: function (cm, actionArgs) {
    const macroModeState = vimGlobalState.macroModeState;
    const registerName = actionArgs.selectedCharacter;
    if (vimGlobalState.registerController.isValidRegister(registerName)) {
      macroModeState.enterMacroRecordMode(cm, registerName);
    }
  },
  toggleOverwrite: function (cm) {
    if (!cm.state.overwrite) {
      cm.toggleOverwrite(true);
      cm.setOption("keyMap", "vim-replace");
      signal(cm, "vim-mode-change", { mode: "replace" });
    } else {
      cm.toggleOverwrite(false);
      cm.setOption("keyMap", "vim-insert");
      signal(cm, "vim-mode-change", { mode: "insert" });
    }
  },
  enterInsertMode: function (cm, actionArgs, vim) {
    if (cm.getOption("readOnly")) {
      return;
    }
    vim.insertMode = true;
    vim.insertModeRepeat = (actionArgs && actionArgs.repeat) || 1;
    const insertAt = actionArgs ? actionArgs.insertAt : null;
    const sel = vim.sel;
    let head = actionArgs.head || cm.getCursor("head");
    let height = cm.listSelections().length;
    if (insertAt == "eol") {
      head = makePos(head.line, lineLength(cm, head.line));
    } else if (insertAt == "bol") {
      head = makePos(head.line, 0);
    } else if (insertAt == "charAfter") {
      head = offsetCursor(head, 0, 1);
    } else if (insertAt == "firstNonBlank") {
      const res = motions.moveToFirstNonWhiteSpaceCharacter(
        cm,
        head,
        {},
        undefined,
        undefined
      );
      head = Array.isArray(res) ? res[0] : res;
    } else if (insertAt == "startOfSelectedArea") {
      if (!vim.visualMode) return;
      if (!vim.visualBlock) {
        if (sel.head.line < sel.anchor.line) {
          head = sel.head;
        } else {
          head = makePos(sel.anchor.line, 0);
        }
      } else {
        head = makePos(
          Math.min(sel.head.line, sel.anchor.line),
          Math.min(sel.head.ch, sel.anchor.ch)
        );
        height = Math.abs(sel.head.line - sel.anchor.line) + 1;
      }
    } else if (insertAt == "endOfSelectedArea") {
      if (!vim.visualMode) return;
      if (!vim.visualBlock) {
        if (sel.head.line >= sel.anchor.line) {
          head = offsetCursor(sel.head, 0, 1);
        } else {
          head = makePos(sel.anchor.line, 0);
        }
      } else {
        head = makePos(
          Math.min(sel.head.line, sel.anchor.line),
          Math.max(sel.head.ch, sel.anchor.ch) + 1
        );
        height = Math.abs(sel.head.line - sel.anchor.line) + 1;
      }
    } else if (insertAt == "inplace") {
      if (vim.visualMode) {
        return;
      }
    } else if (insertAt == "lastEdit") {
      head = getLastEditPos(cm) || head;
    }
    cm.setOption("disableInput", false);
    if (actionArgs && actionArgs.replace) {
      // Handle Replace-mode as a special case of insert mode.
      cm.toggleOverwrite(true);
      cm.setOption("keyMap", "vim-replace");
      signal(cm, "vim-mode-change", { mode: "replace" });
    } else {
      cm.toggleOverwrite(false);
      cm.setOption("keyMap", "vim-insert");
      signal(cm, "vim-mode-change", { mode: "insert" });
    }
    if (!vimGlobalState.macroModeState.isPlaying) {
      // Only record if not replaying.
      cm.on("change", onChange);
    }
    if (vim.visualMode) {
      exitVisualMode(cm);
    }
    selectForInsert(cm, head, height);
  },
  toggleVisualMode: function (cm, actionArgs, vim) {
    const repeat = actionArgs.repeat;
    const anchor = cm.getCursor();
    let head: Pos;
    // TODO: The repeat should actually select number of characters/lines
    //     equal to the repeat times the size of the previous visual
    //     operation.
    if (!vim.visualMode) {
      // Entering visual mode
      vim.visualMode = true;
      vim.visualLine = !!actionArgs.linewise;
      vim.visualBlock = !!actionArgs.blockwise;
      head = clipCursorToContent(
        cm,
        makePos(anchor.line, anchor.ch + repeat - 1)
      );
      vim.sel = new CmSelection(anchor, head);
      signal(cm, "vim-mode-change", {
        mode: "visual",
        subMode: vim.visualLine
          ? "linewise"
          : vim.visualBlock
          ? "blockwise"
          : "",
      });
      updateCmSelection(cm);
      updateMark(cm, vim, "<", cursorMin(anchor, head));
      updateMark(cm, vim, ">", cursorMax(anchor, head));
    } else if (
      vim.visualLine !== actionArgs.linewise ||
      vim.visualBlock !== actionArgs.blockwise
    ) {
      // Toggling between modes
      vim.visualLine = !!actionArgs.linewise;
      vim.visualBlock = !!actionArgs.blockwise;
      signal(cm, "vim-mode-change", {
        mode: "visual",
        subMode: vim.visualLine
          ? "linewise"
          : vim.visualBlock
          ? "blockwise"
          : "",
      });
      updateCmSelection(cm);
    } else {
      exitVisualMode(cm);
    }
  },
  reselectLastSelection: function (cm, _actionArgs, vim) {
    const lastSelection = vim.lastSelection;
    if (vim.visualMode) {
      updateLastSelection(cm, vim);
    }
    if (lastSelection) {
      const anchor = lastSelection.anchorMark.find();
      const head = lastSelection.headMark.find();
      if (!anchor || !head) {
        // If the marks have been destroyed due to edits, do nothing.
        return;
      }
      vim.sel = new CmSelection(anchor, head);
      vim.visualMode = true;
      vim.visualLine = lastSelection.visualLine;
      vim.visualBlock = lastSelection.visualBlock;
      updateCmSelection(cm);
      updateMark(cm, vim, "<", cursorMin(anchor, head));
      updateMark(cm, vim, ">", cursorMax(anchor, head));
      signal(cm, "vim-mode-change", {
        mode: "visual",
        subMode: vim.visualLine
          ? "linewise"
          : vim.visualBlock
          ? "blockwise"
          : "",
      });
    }
  },
  joinLines: function (cm, actionArgs, vim) {
    let curStart: Pos;
    let curEnd: Pos;
    if (vim.visualMode) {
      curStart = cm.getCursor("anchor");
      curEnd = cm.getCursor("head");
      if (cursorIsBefore(curEnd, curStart)) {
        const tmp = curEnd;
        curEnd = curStart;
        curStart = tmp;
      }
      curEnd.ch = lineLength(cm, curEnd.line) - 1;
    } else {
      // Repeat is the number of lines to join. Minimum 2 lines.
      const repeat = Math.max(actionArgs.repeat, 2);
      curStart = cm.getCursor();
      curEnd = clipCursorToContent(
        cm,
        makePos(curStart.line + repeat - 1, Infinity)
      );
    }
    let finalCh = 0;
    for (let i = curStart.line; i < curEnd.line; i++) {
      finalCh = lineLength(cm, curStart.line);
      const tmp = makePos(curStart.line + 1, lineLength(cm, curStart.line + 1));
      let text = cm.getRange(curStart, tmp);
      text = actionArgs.keepSpaces
        ? text.replace(/\n\r?/g, "")
        : text.replace(/\n\s*/g, " ");
      cm.replaceRange(text, curStart, tmp);
    }
    const curFinalPos = makePos(curStart.line, finalCh);
    if (vim.visualMode) {
      exitVisualMode(cm, false);
    }
    cm.setCursor(curFinalPos);
  },
  newLineAndEnterInsertMode: function (cm, actionArgs, vim) {
    if (cm.getOption("readOnly")) {
      return;
    }
    vim.insertMode = true;
    const insertAt = copyCursor(cm.getCursor());
    if (insertAt.line === cm.firstLine() && !actionArgs.after) {
      // Special case for inserting newline before start of document.
      cm.replaceRange("\n", makePos(cm.firstLine(), 0));
      cm.setCursor(cm.firstLine(), 0);
    } else {
      insertAt.line = actionArgs.after ? insertAt.line : insertAt.line - 1;
      insertAt.ch = lineLength(cm, insertAt.line);
      cm.setCursor(insertAt);
      const newlineFn =
        CodeMirror.commands.newlineAndIndentContinueComment ||
        CodeMirror.commands.newlineAndIndent;
      newlineFn(cm);
    }
    this.enterInsertMode(cm, { repeat: actionArgs.repeat }, vim);
  },
  paste: function (cm, actionArgs, vim) {
    const cur = copyCursor(cm.getCursor());
    const register = vimGlobalState.registerController.getRegister(
      actionArgs.registerName
    );
    let text = register.toString();
    let blockText: string[] = [];
    if (!text) {
      return;
    }
    if (actionArgs.matchIndent) {
      const tabSize = cm.getOption("tabSize") as number;
      // length that considers tabs and tabSize
      const whitespaceLength = (str: string) => {
        const tabs = str.split("\t").length - 1;
        const spaces = str.split(" ").length - 1;
        return tabs * tabSize + spaces * 1;
      };
      const currentLine = cm.getLine(cm.getCursor().line);
      const indent = whitespaceLength(currentLine.match(/^\s*/)[0]);
      // chomp last newline b/c don't want it to match /^\s*/gm
      const chompedText = text.replace(/\n$/, "");
      const wasChomped = text !== chompedText;
      const firstIndent = whitespaceLength(text.match(/^\s*/)[0]);
      text = chompedText.replace(/^\s*/gm, (wspace) => {
        const newIndent = indent + (whitespaceLength(wspace) - firstIndent);
        if (newIndent < 0) {
          return "";
        } else if (cm.getOption("indentWithTabs")) {
          const quotient = Math.floor(newIndent / tabSize);
          return Array(quotient + 1).join("\t");
        } else {
          return Array(newIndent + 1).join(" ");
        }
      });
      text += wasChomped ? "\n" : "";
    }
    if (actionArgs.repeat > 1) {
      text = Array(actionArgs.repeat + 1).join(text);
    }
    const linewise = register.linewise;
    const blockwise = register.blockwise;
    if (blockwise) {
      blockText = text.split("\n");
      if (linewise) {
        blockText.pop();
      }
      blockText = blockText.map((line) => (line == "" ? " " : line));
      cur.ch += actionArgs.after ? 1 : 0;
      cur.ch = Math.min(lineLength(cm, cur.line), cur.ch);
    } else if (linewise) {
      if (vim.visualMode) {
        text = vim.visualLine
          ? text.slice(0, -1)
          : "\n" + text.slice(0, text.length - 1) + "\n";
      } else if (actionArgs.after) {
        // Move the newline at the end to the start instead, and paste just
        // before the newline character of the line we are on right now.
        text = "\n" + text.slice(0, text.length - 1);
        cur.ch = lineLength(cm, cur.line);
      } else {
        cur.ch = 0;
      }
    } else {
      cur.ch += actionArgs.after ? 1 : 0;
    }
    let curPosFinal: Pos;
    let idx: number;
    if (vim.visualMode) {
      //  save the pasted text for reselection if the need arises
      vim.lastPastedText = text;
      let lastSelectionCurEnd: Pos;
      const selectedArea = getSelectedAreaRange(cm, vim);
      const selectionStart = selectedArea[0];
      let selectionEnd = selectedArea[1];
      const selectedText = cm.getSelection();
      const selections = cm.listSelections();
      const emptyStrings = new Array(selections.length).fill("");
      // save the curEnd marker before it get cleared due to cm.replaceRange.
      if (vim.lastSelection) {
        lastSelectionCurEnd = vim.lastSelection.headMark.find();
      }
      // push the previously selected text to unnamed register
      vimGlobalState.registerController.unnamedRegister.setText(selectedText);
      if (blockwise) {
        // first delete the selected text
        cm.replaceSelections(emptyStrings);
        // Set new selections as per the block length of the yanked text
        selectionEnd = makePos(
          selectionStart.line + blockText.length - 1,
          selectionStart.ch
        );
        cm.setCursor(selectionStart);
        selectBlock(cm, selectionEnd);
        cm.replaceSelections(blockText);
        curPosFinal = selectionStart;
      } else if (vim.visualBlock) {
        cm.replaceSelections(emptyStrings);
        cm.setCursor(selectionStart);
        cm.replaceRange(text, selectionStart, selectionStart);
        curPosFinal = selectionStart;
      } else {
        cm.replaceRange(text, selectionStart, selectionEnd);
        curPosFinal = cm.posFromIndex(
          cm.indexFromPos(selectionStart) + text.length - 1
        );
      }
      // restore the the curEnd marker
      if (lastSelectionCurEnd) {
        vim.lastSelection.headMark = cm.setBookmark(lastSelectionCurEnd);
      }
      if (linewise) {
        curPosFinal.ch = 0;
      }
    } else {
      if (blockwise) {
        cm.setCursor(cur);
        for (let i = 0; i < blockText.length; i++) {
          const line = cur.line + i;
          if (line > cm.lastLine()) {
            cm.replaceRange("\n", makePos(line, cur.ch));
          }
          const lastCh = lineLength(cm, line);
          if (lastCh < cur.ch) {
            extendLineToColumn(cm, line, cur.ch);
          }
        }
        cm.setCursor(cur);
        selectBlock(cm, makePos(cur.line + text.length - 1, cur.ch));
        cm.replaceSelections(blockText);
        curPosFinal = cur;
      } else {
        cm.replaceRange(text, cur);
        // Now fine tune the cursor to where we want it.
        if (linewise && actionArgs.after) {
          curPosFinal = makePos(
            cur.line + 1,
            findFirstNonWhiteSpaceCharacter(cm.getLine(cur.line + 1))
          );
        } else if (linewise && !actionArgs.after) {
          curPosFinal = makePos(
            cur.line,
            findFirstNonWhiteSpaceCharacter(cm.getLine(cur.line))
          );
        } else if (!linewise && actionArgs.after) {
          idx = cm.indexFromPos(cur);
          curPosFinal = cm.posFromIndex(idx + text.length - 1);
        } else {
          idx = cm.indexFromPos(cur);
          curPosFinal = cm.posFromIndex(idx + text.length);
        }
      }
    }
    if (vim.visualMode) {
      exitVisualMode(cm, false);
    }
    cm.setCursor(curPosFinal);
  },
  undo: function (cm, actionArgs) {
    repeatFn(cm, CodeMirror.commands.undo, actionArgs.repeat)();
    cm.setCursor(cm.getCursor("anchor"));
  },
  redo: function (cm, actionArgs) {
    repeatFn(cm, CodeMirror.commands.redo, actionArgs.repeat)();
  },
  setRegister: function (_cm, actionArgs, vim) {
    vim.inputState.registerName = actionArgs.selectedCharacter;
  },
  setMark: function (cm, actionArgs, vim) {
    const markName = actionArgs.selectedCharacter;
    updateMark(cm, vim, markName, cm.getCursor());
  },
  replace: function (cm, actionArgs, vim) {
    const replaceWith = actionArgs.selectedCharacter;
    let curStart = cm.getCursor();
    let replaceTo: number;
    let curEnd: Pos;
    const selections = cm.listSelections();
    if (vim.visualMode) {
      curStart = cm.getCursor("start");
      curEnd = cm.getCursor("end");
    } else {
      const line = cm.getLine(curStart.line);
      replaceTo = curStart.ch + actionArgs.repeat;
      if (replaceTo > line.length) {
        replaceTo = line.length;
      }
      curEnd = makePos(curStart.line, replaceTo);
    }
    if (replaceWith == "\n") {
      if (!vim.visualMode) cm.replaceRange("", curStart, curEnd);
      // special case, where vim help says to replace by just one line-break
      (
        CodeMirror.commands.newlineAndIndentContinueComment ||
        CodeMirror.commands.newlineAndIndent
      )(cm);
    } else {
      if (vim.visualBlock) {
        // Tabs are split in visua block before replacing
        const spaces = new Array(cm.getOption("tabSize") + 1).join(" ");
        const replaceWithStr = cm
          .getSelection()
          .replace(/\t/g, spaces)
          .replace(/[^\n]/g, replaceWith)
          .split("\n");
        cm.replaceSelections(replaceWithStr);
      } else {
        //replace all characters in range by selected, but keep linebreaks
        const replaceWithStr = cm
          .getRange(curStart, curEnd)
          .replace(/[^\n]/g, replaceWith);
        cm.replaceRange(replaceWithStr, curStart, curEnd);
      }
      if (vim.visualMode) {
        curStart = cursorIsBefore(selections[0].anchor, selections[0].head)
          ? selections[0].anchor
          : selections[0].head;
        cm.setCursor(curStart);
        exitVisualMode(cm, false);
      } else {
        cm.setCursor(offsetCursor(curEnd, 0, -1));
      }
    }
  },
  incrementNumberToken: function (cm, actionArgs) {
    const cur = cm.getCursor();
    const lineStr = cm.getLine(cur.line);
    const re = /(-?)(?:(0x)([\da-f]+)|(0b|0|)(\d+))/gi;
    const bases: Record<string, number> = {
      "0b": 2,
      "0": 8,
      "": 10,
      "0x": 16,
    };
    let match: RegExpExecArray;
    let start: number;
    let end: number;
    while ((match = re.exec(lineStr)) !== null) {
      start = match.index;
      end = start + match[0].length;
      if (cur.ch < end) break;
    }
    if (!actionArgs.backtrack && end <= cur.ch) return;
    if (!match) {
      return;
    }
    const baseStr = match[2] || match[4];
    const digits = match[3] || match[5];
    const increment = actionArgs.increase ? 1 : -1;
    const base = bases[baseStr.toLowerCase()] || 10;
    const number =
      parseInt(match[1] + digits, base) + increment * actionArgs.repeat;
    let numberStr = number.toString(base);
    const zeroPadding = baseStr
      ? new Array(digits.length - numberStr.length + 1 + match[1].length).join(
          "0"
        )
      : "";
    if (numberStr.charAt(0) === "-") {
      numberStr = "-" + baseStr + zeroPadding + numberStr.substr(1);
    } else {
      numberStr = baseStr + zeroPadding + numberStr;
    }
    const from = makePos(cur.line, start);
    const to = makePos(cur.line, end);
    cm.replaceRange(numberStr, from, to);

    cm.setCursor(makePos(cur.line, start + numberStr.length - 1));
  },
  repeatLastEdit: function (cm, actionArgs, vim) {
    const lastEditInputState = vim.lastEditInputState;
    if (!lastEditInputState) {
      return;
    }
    let repeat = actionArgs.repeat;
    if (repeat && actionArgs.repeatIsExplicit) {
      vim.lastEditInputState.repeatOverride = repeat;
    } else {
      repeat = vim.lastEditInputState.repeatOverride || repeat;
    }
    repeatLastEdit(cm, vim, repeat, false /** repeatForInsert */);
  },
  indent: function (cm, actionArgs) {
    cm.indentLine(cm.getCursor().line, actionArgs.indentRight);
  },
  exitInsertMode: exitInsertMode,
};

const defineAction = (name: string, fn: ActionFunc) => (actions[name] = fn);

/*
 * Below are miscellaneous utility functions used by vim.js
 */

/**
 * Clips cursor to ensure that line is within the buffer's range
 * If includeLineBreak is true, then allow cur.ch == lineLength.
 */
function clipCursorToContent(cm: CodeMirror, cur: Pos) {
  const vim = cm.state.vim as VimState;
  const includeLineBreak = vim.insertMode || vim.visualMode;
  const line = Math.min(Math.max(cm.firstLine(), cur.line), cm.lastLine());
  const maxCh = lineLength(cm, line) - 1 + (includeLineBreak ? 1 : 0);
  const ch = Math.min(Math.max(0, cur.ch), maxCh);
  return makePos(line, ch);
}

const copyArgs = <T>(args: T): T => ({ ...args });

function offsetCursor(cur: Pos, offsetLine: Pos): Pos;
function offsetCursor(cur: Pos, offsetLine: number, offsetCh: number): Pos;
function offsetCursor(
  cur: Pos,
  offsetLine: number | Pos,
  offsetCh?: number
): Pos {
  if (isPos(offsetLine)) {
    return makePos(cur.line + offsetLine.line, cur.ch + offsetLine.ch);
  }
  return makePos(cur.line + offsetLine, cur.ch + offsetCh);
}

function commandMatches(
  keys: string,
  keyMap: KeyMapping[],
  context: Context,
  inputState: InputState
) {
  // Partial matches are not applied. They inform the key handler
  // that the current key sequence is a subsequence of a valid key
  // sequence, so that the key buffer is not cleared.
  let match: false | "partial" | "full";
  const partial: KeyMapping[] = [];
  const full: KeyMapping[] = [];

  keyMap.forEach((command) => {
    if (
      (context == "insert" && command.context != "insert") ||
      (command.context && command.context != context) ||
      (inputState.operator && command.type == "action") ||
      !(match = commandMatch(keys, command.keys))
    ) {
    } else if (match == "partial") {
      partial.push(command);
    } else if (match == "full") {
      full.push(command);
    }
  });
  return {
    partial: partial.length && partial,
    full: full.length && full,
  };
}
function commandMatch(pressed: string, mapped: string) {
  if (mapped.endsWith("<character>")) {
    // Last character matches anything.
    const prefixLen = mapped.length - 11;
    const pressedPrefix = pressed.slice(0, prefixLen);
    const mappedPrefix = mapped.slice(0, prefixLen);
    return pressedPrefix == mappedPrefix && pressed.length > prefixLen
      ? "full"
      : mappedPrefix.indexOf(pressedPrefix) == 0
      ? "partial"
      : false;
  } else {
    return pressed == mapped
      ? "full"
      : mapped.indexOf(pressed) == 0
      ? "partial"
      : false;
  }
}

function lastChar(keys: string): string {
  const match = /^.*(<[^>]+>)$/.exec(keys);
  let selectedCharacter = match ? match[1] : keys.slice(-1);
  if (selectedCharacter.length > 1) {
    switch (selectedCharacter) {
      case "<CR>":
        selectedCharacter = "\n";
        break;
      case "<Space>":
        selectedCharacter = " ";
        break;
      default:
        selectedCharacter = "";
        break;
    }
  }
  return selectedCharacter;
}

function repeatFn(
  cm: CodeMirror,
  fn: (cm: CodeMirror) => void,
  repeat: number
) {
  return () => {
    for (let i = 0; i < repeat; i++) {
      fn(cm);
    }
  };
}

const copyCursor = (cur: Pos): Pos => ({ ...cur });

const cursorEqual = (cur1: Pos, cur2: Pos): boolean =>
  cur1.ch == cur2.ch && cur1.line == cur2.line;

const cursorIsBefore = (cur1: Pos, cur2: Pos): boolean => {
  if (cur1.line < cur2.line) {
    return true;
  }
  if (cur1.line == cur2.line && cur1.ch < cur2.ch) {
    return true;
  }
  return false;
};

const cursorMin = (...cursors: Pos[]): Pos =>
  cursors.reduce((m, cur) => (cursorIsBefore(m, cur) ? m : cur));

const cursorMax = (...cursors: Pos[]): Pos =>
  cursors.reduce((m, cur) => (cursorIsBefore(m, cur) ? cur : m));

const cursorIsBetween = (low: Pos, test: Pos, high: Pos): boolean =>
  // returns true if cur2 is between cur1 and cur3.
  cursorIsBefore(low, test) && cursorIsBefore(test, high);

function lineLength(cm: CodeMirror, lineNum: number) {
  return cm.getLine(lineNum).length;
}

const trim = (s: string) => s.trim();

function escapeRegex(s: string) {
  return s.replace(/([.?*+$\[\]\/\\(){}|\-])/g, "\\$1");
}

function extendLineToColumn(cm: CodeMirror, lineNum: number, column: number) {
  const endCh = lineLength(cm, lineNum);
  const spaces = "".padEnd(column - endCh, " ");
  cm.setCursor(makePos(lineNum, endCh));
  cm.replaceRange(spaces, cm.getCursor());
}
// This functions selects a rectangular block
// of text with selectionEnd as any of its corner
// Height of block:
// Difference in selectionEnd.line and first/last selection.line
// Width of the block:
// Distance between selectionEnd.ch and any(first considered here) selection.ch
function selectBlock(cm: CodeMirror, selectionEnd: Pos) {
  const ranges = cm.listSelections();
  const head = copyCursor(cm.clipPos(selectionEnd));
  const isClipped = !cursorEqual(selectionEnd, head);
  const curHead = cm.getCursor("head");
  const primIndex = getIndex(ranges, curHead);
  const wasClipped = cursorEqual(
    ranges[primIndex].head,
    ranges[primIndex].anchor
  );
  const max = ranges.length - 1;
  const index = max - primIndex > primIndex ? max : 0;
  const base = ranges[index].anchor;

  const firstLine = Math.min(base.line, head.line);
  const lastLine = Math.max(base.line, head.line);
  let baseCh = base.ch;
  let headCh = head.ch;

  const dir = ranges[index].head.ch - baseCh;
  const newDir = headCh - baseCh;
  if (dir > 0 && newDir <= 0) {
    baseCh++;
    if (!isClipped) {
      headCh--;
    }
  } else if (dir < 0 && newDir >= 0) {
    baseCh--;
    if (!wasClipped) {
      headCh++;
    }
  } else if (dir < 0 && newDir == -1) {
    baseCh--;
    headCh++;
  }

  const selections: CmSelection[] = [];
  for (let line = firstLine; line <= lastLine; line++) {
    const range = new CmSelection(makePos(line, baseCh), makePos(line, headCh));
    selections.push(range);
  }
  cm.setSelections(selections);
  selectionEnd.ch = headCh;
  base.ch = baseCh;
  return base;
}

function selectForInsert(cm: CodeMirror, head: Pos, height: number) {
  const sel: CmSelection[] = [];
  for (let i = 0; i < height; i++) {
    const lineHead = offsetCursor(head, i, 0);
    sel.push(new CmSelection(lineHead, lineHead));
  }
  cm.setSelections(sel, 0);
}

// getIndex returns the index of the cursor in the selections.
function getIndex(ranges: CmSelection[], cursor: Pos, end?: "anchor" | "head") {
  return ranges.findIndex(
    (range) =>
      (end != "head" && cursorEqual(range.anchor, cursor)) ||
      (end != "anchor" && cursorEqual(range.head, cursor))
  );
}

function getSelectedAreaRange(cm: CodeMirror, vim: VimState): [Pos, Pos] {
  const lastSelection = vim.lastSelection;
  const getCurrentSelectedAreaRange = (): [Pos, Pos] => {
    const selections = cm.listSelections();
    const start = selections[0];
    const end = selections[selections.length - 1];
    const selectionStart = cursorIsBefore(start.anchor, start.head)
      ? start.anchor
      : start.head;
    const selectionEnd = cursorIsBefore(end.anchor, end.head)
      ? end.head
      : end.anchor;
    return [selectionStart, selectionEnd];
  };
  const getLastSelectedAreaRange = (): [Pos, Pos] => {
    let selectionStart = cm.getCursor();
    let selectionEnd = cm.getCursor();
    const block = lastSelection.visualBlock;
    if (block) {
      const width = 0; // block.width;
      const height = 0; // block.height;
      selectionEnd = makePos(
        selectionStart.line + height,
        selectionStart.ch + width
      );
      const selections: CmSelection[] = [];
      // selectBlock creates a 'proper' rectangular block.
      // We do not want that in all cases, so we manually set selections.
      for (let i = selectionStart.line; i < selectionEnd.line; i++) {
        const anchor = makePos(i, selectionStart.ch);
        const head = makePos(i, selectionEnd.ch);
        selections.push(new CmSelection(anchor, head));
      }
      cm.setSelections(selections);
    } else {
      const start = lastSelection.anchorMark.find();
      const end = lastSelection.headMark.find();
      const line = end.line - start.line;
      const ch = end.ch - start.ch;
      selectionEnd = makePos(
        selectionEnd.line + line,
        line ? selectionEnd.ch : ch + selectionEnd.ch
      );
      if (lastSelection.visualLine) {
        selectionStart = makePos(selectionStart.line, 0);
        selectionEnd = makePos(
          selectionEnd.line,
          lineLength(cm, selectionEnd.line)
        );
      }
      cm.setSelection(selectionStart, selectionEnd);
    }
    return [selectionStart, selectionEnd];
  };
  if (!vim.visualMode) {
    // In case of replaying the action.
    return getLastSelectedAreaRange();
  } else {
    return getCurrentSelectedAreaRange();
  }
}
// Updates the previous selection with the current selection's values. This
// should only be called in visual mode.
function updateLastSelection(cm: CodeMirror, vim: VimState) {
  const anchor = vim.sel.anchor;
  let head = vim.sel.head;
  // To accommodate the effect of lastPastedText in the last selection
  if (vim.lastPastedText) {
    head = cm.posFromIndex(cm.indexFromPos(anchor) + vim.lastPastedText.length);
    vim.lastPastedText = null;
  }
  vim.lastSelection = {
    anchorMark: cm.setBookmark(anchor),
    headMark: cm.setBookmark(head),
    anchor: copyCursor(anchor),
    head: copyCursor(head),
    visualMode: vim.visualMode,
    visualLine: vim.visualLine,
    visualBlock: vim.visualBlock,
  };
}

function expandSelection(cm: CodeMirror, start: Pos, end: Pos): [Pos, Pos] {
  const vim = cm.state.vim as VimState;
  const sel = vim.sel;
  let head = sel.head;
  let anchor = sel.anchor;
  if (cursorIsBefore(end, start)) {
    const tmp = end;
    end = start;
    start = tmp;
  }
  if (cursorIsBefore(head, anchor)) {
    head = cursorMin(start, head);
    anchor = cursorMax(anchor, end);
  } else {
    anchor = cursorMin(start, anchor);
    head = cursorMax(head, end);
    head = offsetCursor(head, 0, -1);
    if (head.ch == -1 && head.line != cm.firstLine()) {
      head = makePos(head.line - 1, lineLength(cm, head.line - 1));
    }
  }
  return [anchor, head];
}
/**
 * Updates the CodeMirror selection to match the provided vim selection.
 * If no arguments are given, it uses the current vim selection state.
 */
function updateCmSelection(
  cm: CodeMirror,
  sel?: CmSelection,
  mode?: "line" | "block" | "char"
) {
  const vim = cm.state.vim as VimState;
  sel = sel || vim.sel;
  mode = mode || vim.visualLine ? "line" : vim.visualBlock ? "block" : "char";
  const cmSel = makeCmSelection(cm, sel, mode);
  cm.setSelections(cmSel.ranges, cmSel.primary);
}

function makeCmSelection(
  cm: CodeMirror,
  sel: CmSelection,
  mode: "line" | "block" | "char",
  exclusive?: boolean
): {
  ranges: CmSelection[];
  primary: number;
} {
  let head = copyCursor(sel.head);
  let anchor = copyCursor(sel.anchor);
  if (mode == "char") {
    const headOffset =
      !exclusive && !cursorIsBefore(sel.head, sel.anchor) ? 1 : 0;
    const anchorOffset = cursorIsBefore(sel.head, sel.anchor) ? 1 : 0;
    head = offsetCursor(sel.head, 0, headOffset);
    anchor = offsetCursor(sel.anchor, 0, anchorOffset);
    return {
      ranges: [new CmSelection(anchor, head)],
      primary: 0,
    };
  } else if (mode == "line") {
    if (!cursorIsBefore(sel.head, sel.anchor)) {
      anchor.ch = 0;

      const lastLine = cm.lastLine();
      if (head.line > lastLine) {
        head.line = lastLine;
      }
      head.ch = lineLength(cm, head.line);
    } else {
      head.ch = 0;
      anchor.ch = lineLength(cm, anchor.line);
    }
    return {
      ranges: [new CmSelection(anchor, head)],
      primary: 0,
    };
  } else if (mode == "block") {
    const top = Math.min(anchor.line, head.line);
    let fromCh = anchor.ch;
    const bottom = Math.max(anchor.line, head.line);
    let toCh = head.ch;
    if (fromCh < toCh) {
      toCh += 1;
    } else {
      fromCh += 1;
    }
    const height = bottom - top + 1;
    const primary = head.line == top ? 0 : height - 1;
    const ranges: CmSelection[] = [];
    for (let i = 0; i < height; i++) {
      ranges.push(
        new CmSelection(makePos(top + i, fromCh), makePos(top + i, toCh))
      );
    }
    return {
      ranges: ranges,
      primary: primary,
    };
  }
}

function getHead(cm: CodeMirror) {
  const cur = cm.getCursor("head");
  if (cm.getSelection().length == 1) {
    // Small corner case when only 1 character is selected. The "real"
    // head is the left of head and anchor.
    return cursorMin(cur, cm.getCursor("anchor"));
  }
  return cur;
}

/**
 * If moveHead is set to false, the CodeMirror selection will not be
 * touched. The caller assumes the responsibility of putting the cursor
 * in the right place.
 */
function exitVisualMode(cm: CodeMirror, moveHead?: boolean) {
  const vim = cm.state.vim as VimState;
  if (moveHead !== false) {
    cm.setCursor(clipCursorToContent(cm, vim.sel.head));
  }
  updateLastSelection(cm, vim);
  vim.visualMode = false;
  vim.visualLine = false;
  vim.visualBlock = false;
  if (!vim.insertMode) signal(cm, "vim-mode-change", { mode: "normal" });
}

// Remove any trailing newlines from the selection. For
// example, with the caret at the start of the last word on the line,
// 'dw' should word, but not the newline, while 'w' should advance the
// caret to the first character of the next line.
function clipToLine(cm: CodeMirror, curStart: Pos, curEnd: Pos) {
  const selection = cm.getRange(curStart, curEnd);
  // Only clip if the selection ends with trailing newline + whitespace
  if (/\n\s*$/.test(selection)) {
    const lines = selection.split("\n");
    // We know this is all whitespace.
    lines.pop();

    // Cases:
    // 1. Last word is an empty line - do not clip the trailing '\n'
    // 2. Last word is not an empty line - clip the trailing '\n'
    let line;
    // Find the line containing the last word, and clip all whitespace up
    // to it.
    for (
      line = lines.pop();
      lines.length > 0 && line && isWhiteSpaceString(line);
      line = lines.pop()
    ) {
      curEnd.line--;
      curEnd.ch = 0;
    }
    // If the last word is not an empty line, clip an additional newline
    if (line) {
      curEnd.line--;
      curEnd.ch = lineLength(cm, curEnd.line);
    } else {
      curEnd.ch = 0;
    }
  }
}

// Expand the selection to line ends.
function expandSelectionToLine(_cm: CodeMirror, curStart: Pos, curEnd: Pos) {
  curStart.ch = 0;
  curEnd.ch = 0;
  curEnd.line++;
}

function findFirstNonWhiteSpaceCharacter(text: string) {
  if (!text) {
    return 0;
  }
  const firstNonWS = text.search(/\S/);
  return firstNonWS == -1 ? text.length : firstNonWS;
}

function expandWordUnderCursor(
  cm: CodeMirror,
  inclusive: boolean,
  _forward: boolean,
  bigWord: boolean,
  noSymbol?: boolean
): [Pos, Pos] {
  const cur = getHead(cm);
  const line = cm.getLine(cur.line);
  let idx = cur.ch;

  // Seek to first word or non-whitespace character, depending on if
  // noSymbol is true.
  let test = noSymbol ? wordCharTest[0] : bigWordCharTest[0];
  while (!test(line.charAt(idx))) {
    idx++;
    if (idx >= line.length) {
      return null;
    }
  }

  if (bigWord) {
    test = bigWordCharTest[0];
  } else {
    test = wordCharTest[0];
    if (!test(line.charAt(idx))) {
      test = wordCharTest[1];
    }
  }

  let end = idx;
  let start = idx;
  while (test(line.charAt(end)) && end < line.length) {
    end++;
  }
  while (test(line.charAt(start)) && start >= 0) {
    start--;
  }
  start++;

  if (inclusive) {
    // If present, include all whitespace after word.
    // Otherwise, include all whitespace before word, except indentation.
    const wordEnd = end;
    while (/\s/.test(line.charAt(end)) && end < line.length) {
      end++;
    }
    if (wordEnd == end) {
      const wordStart = start;
      while (/\s/.test(line.charAt(start - 1)) && start > 0) {
        start--;
      }
      if (!start) {
        start = wordStart;
      }
    }
  }
  return [makePos(cur.line, start), makePos(cur.line, end)];
}

/**
 * Depends on the following:
 *
 * - editor mode should be htmlmixedmode / xml
 * - mode/xml/xml.js should be loaded
 * - addon/fold/xml-fold.js should be loaded
 *
 * If any of the above requirements are not true, this function noops.
 *
 * This is _NOT_ a 100% accurate implementation of vim tag text objects.
 * The following caveats apply (based off cursory testing, I'm sure there
 * are other discrepancies):
 *
 * - Does not work inside comments:
 *   ```
 *   <!-- <div>broken</div> -->
 *   ```
 * - Does not work when tags have different cases:
 *   ```
 *   <div>broken</DIV>
 *   ```
 * - Does not work when cursor is inside a broken tag:
 *   ```
 *   <div><brok><en></div>
 *   ```
 */
function expandTagUnderCursor(
  cm: CodeMirror,
  head: Pos,
  inclusive: boolean
): [Pos, Pos] {
  return [head, head];
}

function recordJumpPosition(cm: CodeMirror, oldCur: Pos, newCur: Pos) {
  if (!cursorEqual(oldCur, newCur)) {
    vimGlobalState.jumpList.add(cm, oldCur, newCur);
  }
}

function recordLastCharacterSearch(increment: number, args: MotionArgs) {
  vimGlobalState.lastCharacterSearch.increment = increment;
  vimGlobalState.lastCharacterSearch.forward = args.forward;
  vimGlobalState.lastCharacterSearch.selectedCharacter = args.selectedCharacter;
}

type SymbolMode = "bracket" | "section" | "comment" | "method" | "preprocess";

const symbolToMode: Record<string, SymbolMode> = {
  "(": "bracket",
  ")": "bracket",
  "{": "bracket",
  "}": "bracket",
  "[": "section",
  "]": "section",
  "*": "comment",
  "/": "comment",
  m: "method",
  M: "method",
  "#": "preprocess",
};

interface FindSymbolState {
  lineText: string;
  nextCh: string;
  lastCh: string;
  index: number;
  symb: string;
  reverseSymb: string;
  forward: boolean;
  depth: number;
  curMoveThrough: boolean;
}

interface SymbolModeHandler {
  init: (state: FindSymbolState) => void;
  isComplete: (state: FindSymbolState) => boolean;
}

const findSymbolModes: Record<SymbolMode, SymbolModeHandler> = {
  bracket: {
    init: function (state) {},
    isComplete: function (state) {
      if (state.nextCh === state.symb) {
        state.depth++;
        if (state.depth >= 1) return true;
      } else if (state.nextCh === state.reverseSymb) {
        state.depth--;
      }
      return false;
    },
  },
  section: {
    init: function (state) {
      state.curMoveThrough = true;
      state.symb = (state.forward ? "]" : "[") === state.symb ? "{" : "}";
    },
    isComplete: function (state) {
      return state.index === 0 && state.nextCh === state.symb;
    },
  },
  comment: {
    init: () => {},
    isComplete: function (state) {
      const found = state.lastCh === "*" && state.nextCh === "/";
      state.lastCh = state.nextCh;
      return found;
    },
  },
  // TODO: The original Vim implementation only operates on level 1 and 2.
  // The current implementation doesn't check for code block level and
  // therefore it operates on any levels.
  method: {
    init: function (state) {
      state.symb = state.symb === "m" ? "{" : "}";
      state.reverseSymb = state.symb === "{" ? "}" : "{";
    },
    isComplete: function (state) {
      if (state.nextCh === state.symb) return true;
      return false;
    },
  },
  preprocess: {
    init: function (state) {
      state.index = 0;
    },
    isComplete: function (state) {
      if (state.nextCh === "#") {
        const token = state.lineText.match(/^#(\w+)/)[1];
        if (token === "endif") {
          if (state.forward && state.depth === 0) {
            return true;
          }
          state.depth++;
        } else if (token === "if") {
          if (!state.forward && state.depth === 0) {
            return true;
          }
          state.depth--;
        }
        if (token === "else" && state.depth === 0) return true;
      }
      return false;
    },
  },
};

const ForwardSymbolPairs: Record<string, string> = { ")": "(", "}": "{" };
const ReverseSymbolPairs: Record<string, string> = { "(": ")", "{": "}" };

function findSymbol(
  cm: CodeMirror,
  repeat: number,
  forward: boolean,
  symb: string
) {
  const cur = copyCursor(cm.getCursor());
  const increment = forward ? 1 : -1;
  const endLine = forward ? cm.lineCount() : -1;
  const curCh = cur.ch;
  let line = cur.line;
  const lineText = cm.getLine(line);
  const state: FindSymbolState = {
    lineText: lineText,
    nextCh: lineText.charAt(curCh),
    lastCh: "",
    index: curCh,
    symb: symb,
    reverseSymb: (forward ? ForwardSymbolPairs : ReverseSymbolPairs)[symb],
    forward: forward,
    depth: 0,
    curMoveThrough: false,
  };
  const mode = symbolToMode[symb];
  if (!mode) return cur;
  const modeHandler = findSymbolModes[mode];
  modeHandler.init(state);
  while (line !== endLine && repeat) {
    state.index += increment;
    state.nextCh = state.lineText.charAt(state.index);
    if (!state.nextCh) {
      line += increment;
      state.lineText = cm.getLine(line) || "";
      if (increment > 0) {
        state.index = 0;
      } else {
        const lineLen = state.lineText.length;
        state.index = lineLen > 0 ? lineLen - 1 : 0;
      }
      state.nextCh = state.lineText.charAt(state.index);
    }
    if (modeHandler.isComplete(state)) {
      cur.line = line;
      cur.ch = state.index;
      repeat--;
    }
  }
  if (state.nextCh || state.curMoveThrough) {
    return makePos(line, state.index);
  }
  return cur;
}

/*
 * Returns the boundaries of the next word. If the cursor in the middle of
 * the word, then returns the boundaries of the current word, starting at
 * the cursor. If the cursor is at the start/end of a word, and we are going
 * forward/backward, respectively, find the boundaries of the next word.
 *
 * @param {CodeMirror} cm CodeMirror object.
 * @param {Cursor} cur The cursor position.
 * @param {boolean} forward True to search forward. False to search
 *     backward.
 * @param {boolean} bigWord True if punctuation count as part of the word.
 *     False if only [a-zA-Z0-9] characters count as part of the word.
 * @param {boolean} emptyLineIsWord True if empty lines should be treated
 *     as words.
 * @return {Object{from:number, to:number, line: number}} The boundaries of
 *     the word, or null if there are no more words.
 */
function findWord(
  cm: CodeMirror,
  cur: Pos,
  forward: boolean,
  bigWord: boolean,
  emptyLineIsWord: boolean
) {
  let lineNum = cur.line;
  let pos = cur.ch;
  let line = cm.getLine(lineNum);
  const dir = forward ? 1 : -1;
  const charTests = bigWord ? bigWordCharTest : wordCharTest;

  if (emptyLineIsWord && line == "") {
    lineNum += dir;
    line = cm.getLine(lineNum);
    if (!isLine(cm, lineNum)) {
      return null;
    }
    pos = forward ? 0 : line.length;
  }

  while (true) {
    if (emptyLineIsWord && line == "") {
      return { from: 0, to: 0, line: lineNum };
    }
    const stop = dir > 0 ? line.length : -1;
    let wordStart = stop;
    let wordEnd = stop;
    // Find bounds of next word.
    while (pos != stop) {
      let foundWord = false;
      for (let i = 0; i < charTests.length && !foundWord; ++i) {
        if (charTests[i](line.charAt(pos))) {
          wordStart = pos;
          // Advance to end of word.
          while (pos != stop && charTests[i](line.charAt(pos))) {
            pos += dir;
          }
          wordEnd = pos;
          foundWord = wordStart != wordEnd;
          if (
            wordStart == cur.ch &&
            lineNum == cur.line &&
            wordEnd == wordStart + dir
          ) {
            // We started at the end of a word. Find the next one.
            continue;
          } else {
            return {
              from: Math.min(wordStart, wordEnd + 1),
              to: Math.max(wordStart, wordEnd),
              line: lineNum,
            };
          }
        }
      }
      if (!foundWord) {
        pos += dir;
      }
    }
    // Advance to next/prev line.
    lineNum += dir;
    if (!isLine(cm, lineNum)) {
      return null;
    }
    line = cm.getLine(lineNum);
    pos = dir > 0 ? 0 : line.length;
  }
}

/**
 * @param {CodeMirror} cm CodeMirror object.
 * @param {Pos} cur The position to start from.
 * @param {int} repeat Number of words to move past.
 * @param {boolean} forward True to search forward. False to search
 *     backward.
 * @param {boolean} wordEnd True to move to end of word. False to move to
 *     beginning of word.
 * @param {boolean} bigWord True if punctuation count as part of the word.
 *     False if only alphabet characters count as part of the word.
 * @return {Cursor} The position the cursor should move to.
 */
function moveToWord(
  cm: CodeMirror,
  cur: Pos,
  repeat: number,
  forward: boolean,
  wordEnd: boolean,
  bigWord: boolean
): Pos {
  const curStart = copyCursor(cur);
  const words: { line: number; from: number; to: number }[] = [];
  if ((forward && !wordEnd) || (!forward && wordEnd)) {
    repeat++;
  }
  // For 'e', empty lines are not considered words, go figure.
  const emptyLineIsWord = !(forward && wordEnd);
  for (let i = 0; i < repeat; i++) {
    const word = findWord(cm, cur, forward, bigWord, emptyLineIsWord);
    if (!word) {
      const eodCh = lineLength(cm, cm.lastLine());
      words.push(
        forward
          ? { line: cm.lastLine(), from: eodCh, to: eodCh }
          : { line: 0, from: 0, to: 0 }
      );
      break;
    }
    words.push(word);
    cur = makePos(word.line, forward ? word.to - 1 : word.from);
  }
  const shortCircuit = words.length != repeat;
  const firstWord = words[0];
  let lastWord = words.pop();
  if (forward && !wordEnd) {
    // w
    if (
      !shortCircuit &&
      (firstWord.from != curStart.ch || firstWord.line != curStart.line)
    ) {
      // We did not start in the middle of a word. Discard the extra word at the end.
      lastWord = words.pop();
    }
    return makePos(lastWord.line, lastWord.from);
  } else if (forward && wordEnd) {
    return makePos(lastWord.line, lastWord.to - 1);
  } else if (!forward && wordEnd) {
    // ge
    if (
      !shortCircuit &&
      (firstWord.to != curStart.ch || firstWord.line != curStart.line)
    ) {
      // We did not start in the middle of a word. Discard the extra word at the end.
      lastWord = words.pop();
    }
    return makePos(lastWord.line, lastWord.to);
  } else {
    // b
    return makePos(lastWord.line, lastWord.from);
  }
}

function moveToEol(
  cm: CodeMirror,
  head: Pos,
  motionArgs: MotionArgs,
  vim: VimState,
  keepHPos: boolean
) {
  const cur = head;
  const retval = makePos(cur.line + motionArgs.repeat - 1, Infinity);
  const end = cm.clipPos(retval);
  end.ch--;
  if (!keepHPos) {
    vim.lastHPos = Infinity;
    vim.lastHSPos = cm.charCoords(end, "div").left;
  }
  return retval;
}

function moveToCharacter(
  cm: CodeMirror,
  repeat: number,
  forward: boolean,
  character: string
) {
  const cur = cm.getCursor();
  let start = cur.ch;
  let idx;
  for (let i = 0; i < repeat; i++) {
    const line = cm.getLine(cur.line);
    idx = charIdxInLine(start, line, character, forward, true);
    if (idx == -1) {
      return null;
    }
    start = idx;
  }
  return makePos(cm.getCursor().line, idx);
}

function moveToColumn(cm: CodeMirror, repeat: number) {
  // repeat is always >= 1, so repeat - 1 always corresponds
  // to the column we want to go to.
  const line = cm.getCursor().line;
  return clipCursorToContent(cm, makePos(line, repeat - 1));
}

function updateMark(cm: CodeMirror, vim: VimState, markName: string, pos: Pos) {
  if (!inArray(markName, validMarks)) {
    return;
  }
  if (vim.marks[markName]) {
    vim.marks[markName].clear();
  }
  vim.marks[markName] = cm.setBookmark(pos);
}

function charIdxInLine(
  start: number,
  line: string,
  character: string,
  forward: boolean,
  includeChar: boolean
) {
  // Search for char in line.
  // motion_options: {forward, includeChar}
  // If includeChar = true, include it too.
  // If forward = true, search forward, else search backwards.
  // If char is not found on this line, do nothing
  let idx;
  if (forward) {
    idx = line.indexOf(character, start + 1);
    if (idx != -1 && !includeChar) {
      idx -= 1;
    }
  } else {
    idx = line.lastIndexOf(character, start - 1);
    if (idx != -1 && !includeChar) {
      idx += 1;
    }
  }
  return idx;
}

function findParagraph(
  cm: CodeMirror,
  head: Pos,
  repeat: number,
  dir: 1 | 0 | -1,
  inclusive?: boolean
): Pos | [Pos, Pos] {
  let line = head.line;
  let min = cm.firstLine();
  let max = cm.lastLine();
  let i = line;
  const isEmpty = (i: number) => {
    return !cm.getLine(i);
  };
  const isBoundary = (i: number, dir: 1 | -1, any?: boolean) => {
    if (any) {
      return isEmpty(i) != isEmpty(i + dir);
    }
    return !isEmpty(i) && isEmpty(i + dir);
  };
  if (dir) {
    while (min <= i && i <= max && repeat > 0) {
      if (isBoundary(i, dir)) {
        repeat--;
      }
      i += dir;
    }
    return makePos(i, 0);
  }

  const vim = cm.state.vim;
  if (vim.visualLine && isBoundary(line, 1, true)) {
    const anchor = vim.sel.anchor;
    if (isBoundary(anchor.line, -1, true)) {
      if (!inclusive || anchor.line != line) {
        line += 1;
      }
    }
  }
  let startState = isEmpty(line);
  for (i = line; i <= max && repeat; i++) {
    if (isBoundary(i, 1, true)) {
      if (!inclusive || isEmpty(i) != startState) {
        repeat--;
      }
    }
  }
  const end = makePos(1, 0);
  // select boundary before paragraph for the last one
  if (i > max && !startState) {
    startState = true;
  } else {
    inclusive = false;
  }
  for (i = line; i > min; i--) {
    if (!inclusive || isEmpty(i) == startState || i == line) {
      if (isBoundary(i, -1, true)) {
        break;
      }
    }
  }
  const start = makePos(i, 0);
  return [start, end];
}

interface Index {
  line: string;
  ln: number;
  pos: number;
  dir: -1 | 1;
}

function findSentence(
  cm: CodeMirror,
  cur: Pos,
  repeat: number,
  dir: -1 | 1
): Pos {
  /*
        Takes an index object
        {
          line: the line string,
          ln: line number,
          pos: index in line,
          dir: direction of traversal (-1 or 1)
        }
        and modifies the line, ln, and pos members to represent the
        next valid position or sets them to null if there are
        no more valid positions.
       */
  const nextChar = (cm: CodeMirror, idx: Index) => {
    if (idx.pos + idx.dir < 0 || idx.pos + idx.dir >= idx.line.length) {
      idx.ln += idx.dir;
      if (!isLine(cm, idx.ln)) {
        idx.line = null;
        idx.ln = null;
        idx.pos = null;
        return;
      }
      idx.line = cm.getLine(idx.ln);
      idx.pos = idx.dir > 0 ? 0 : idx.line.length - 1;
    } else {
      idx.pos += idx.dir;
    }
  };

  /*
        Performs one iteration of traversal in forward direction
        Returns an index object of the new location
       */
  const forward = (cm: CodeMirror, ln: number, pos: number, dir: -1 | 1) => {
    let line = cm.getLine(ln);
    let stop = line === "";

    const curr: Index = {
      line: line,
      ln: ln,
      pos: pos,
      dir: dir,
    };

    const last_valid: Pick<Index, "ln" | "pos"> = {
      ln: curr.ln,
      pos: curr.pos,
    };

    const skip_empty_lines = curr.line === "";

    // Move one step to skip character we start on
    nextChar(cm, curr);

    while (curr.line !== null) {
      last_valid.ln = curr.ln;
      last_valid.pos = curr.pos;

      if (curr.line === "" && !skip_empty_lines) {
        return { ln: curr.ln, pos: curr.pos };
      } else if (
        stop &&
        curr.line !== "" &&
        !isWhiteSpaceString(curr.line[curr.pos])
      ) {
        return { ln: curr.ln, pos: curr.pos };
      } else if (
        isEndOfSentenceSymbol(curr.line[curr.pos]) &&
        !stop &&
        (curr.pos === curr.line.length - 1 ||
          isWhiteSpaceString(curr.line[curr.pos + 1]))
      ) {
        stop = true;
      }

      nextChar(cm, curr);
    }

    /*
          Set the position to the last non whitespace character on the last
          valid line in the case that we reach the end of the document.
        */
    line = cm.getLine(last_valid.ln);
    last_valid.pos = 0;
    for (let i = line.length - 1; i >= 0; --i) {
      if (!isWhiteSpaceString(line[i])) {
        last_valid.pos = i;
        break;
      }
    }

    return last_valid;
  };

  /*
        Performs one iteration of traversal in reverse direction
        Returns an index object of the new location
       */
  const reverse = (cm: CodeMirror, ln: number, pos: number, dir: -1 | 1) => {
    let line = cm.getLine(ln);

    const curr: Index = {
      line: line,
      ln: ln,
      pos: pos,
      dir: dir,
    };

    let last_valid: Pick<Index, "ln" | "pos"> = {
      ln: curr.ln,
      pos: null,
    };

    let skip_empty_lines = curr.line === "";

    // Move one step to skip character we start on
    nextChar(cm, curr);

    while (curr.line !== null) {
      if (curr.line === "" && !skip_empty_lines) {
        if (last_valid.pos !== null) {
          return last_valid;
        } else {
          return { ln: curr.ln, pos: curr.pos };
        }
      } else if (
        isEndOfSentenceSymbol(curr.line[curr.pos]) &&
        last_valid.pos !== null &&
        !(curr.ln === last_valid.ln && curr.pos + 1 === last_valid.pos)
      ) {
        return last_valid;
      } else if (curr.line !== "" && !isWhiteSpaceString(curr.line[curr.pos])) {
        skip_empty_lines = false;
        last_valid = { ln: curr.ln, pos: curr.pos };
      }

      nextChar(cm, curr);
    }

    /*
          Set the position to the first non whitespace character on the last
          valid line in the case that we reach the beginning of the document.
        */
    line = cm.getLine(last_valid.ln);
    last_valid.pos = 0;
    for (let i = 0; i < line.length; ++i) {
      if (!isWhiteSpaceString(line[i])) {
        last_valid.pos = i;
        break;
      }
    }
    return last_valid;
  };

  let curr_index: Pick<Index, "ln" | "pos"> = {
    ln: cur.line,
    pos: cur.ch,
  };

  while (repeat > 0) {
    if (dir < 0) {
      curr_index = reverse(cm, curr_index.ln, curr_index.pos, dir);
    } else {
      curr_index = forward(cm, curr_index.ln, curr_index.pos, dir);
    }
    repeat--;
  }

  return makePos(curr_index.ln, curr_index.pos);
}

// TODO: perhaps this finagling of start and end positions belongs
// in codemirror/replaceRange?
function selectCompanionObject(
  cm: CodeMirror,
  head: Pos,
  symb: string,
  inclusive: boolean
): [Pos, Pos] {
  const cur = head;

  const bracketRegexpMatcher: Record<string, RegExp> = {
    "(": /[()]/,
    ")": /[()]/,
    "[": /[[\]]/,
    "]": /[[\]]/,
    "{": /[{}]/,
    "}": /[{}]/,
    "<": /[<>]/,
    ">": /[<>]/,
  };
  const bracketRegexp = bracketRegexpMatcher[symb];
  const openSymMatcher: Record<string, string> = {
    "(": "(",
    ")": "(",
    "[": "[",
    "]": "[",
    "{": "{",
    "}": "{",
    "<": "<",
    ">": "<",
  };
  const openSym = openSymMatcher[symb];
  const curChar = cm.getLine(cur.line).charAt(cur.ch);
  // Due to the behavior of scanForBracket, we need to add an offset if the
  // cursor is on a matching open bracket.
  const offset = curChar === openSym ? 1 : 0;

  const startRes = cm.scanForBracket(
    makePos(cur.line, cur.ch + offset),
    -1,
    undefined,
    { bracketRegex: bracketRegexp }
  );
  const endRes = cm.scanForBracket(
    makePos(cur.line, cur.ch + offset),
    1,
    undefined,
    {
      bracketRegex: bracketRegexp,
    }
  );

  if (!startRes || !endRes) {
    return [cur, cur];
  }

  let start = startRes.pos;
  let end = endRes.pos;

  if ((start.line == end.line && start.ch > end.ch) || start.line > end.line) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  if (inclusive) {
    end.ch += 1;
  } else {
    start.ch += 1;
  }

  return [start, end];
}

// Takes in a symbol and a cursor and tries to simulate text objects that
// have identical opening and closing symbols
// TODO support across multiple lines
function findBeginningAndEnd(
  cm: CodeMirror,
  head: Pos,
  symb: string,
  inclusive: boolean
): [Pos, Pos] {
  const cur = copyCursor(head);
  const line = cm.getLine(cur.line);
  const chars = line.split("");
  const firstIndex = chars.indexOf(symb);

  let end: number;
  // the decision tree is to always look backwards for the beginning first,
  // but if the cursor is in front of the first instance of the symb,
  // then move the cursor forward
  if (cur.ch < firstIndex) {
    cur.ch = firstIndex;
    // Why is this line even here???
    // cm.setCursor(cur.line, firstIndex+1);
  }
  // otherwise if the cursor is currently on the closing symbol
  else if (firstIndex < cur.ch && chars[cur.ch] == symb) {
    end = cur.ch; // assign end to the current cursor
    --cur.ch; // make sure to look backwards
  }

  let start: number;

  // if we're currently on the symbol, we've got a start
  if (chars[cur.ch] == symb && !end) {
    start = cur.ch + 1; // assign start to ahead of the cursor
  } else {
    // go backwards to find the start
    for (let i = cur.ch; i > -1 && !start; i--) {
      if (chars[i] == symb) {
        start = i + 1;
      }
    }
  }

  // look forwards for the end symbol
  if (start && !end) {
    for (let i = start; i < chars.length && !end; i++) {
      if (chars[i] == symb) {
        end = i;
      }
    }
  }

  // nothing found
  if (!start || !end) {
    return [cur, cur];
  }

  // include the symbols
  if (inclusive) {
    --start;
    ++end;
  }

  return [makePos(cur.line, start), makePos(cur.line, end)];
}

// Search functions
defineOption("pcre", true, "boolean");

class SearchOverlay {
  query: RegExp;
  matchSol: boolean;

  constructor(query: RegExp) {
    this.query = query;
    this.matchSol = query.source.charAt(0) == "^";
  }

  token(stream: StringStream) {
    if (this.matchSol && !stream.sol()) {
      stream.skipToEnd();
      return;
    }
    const match = stream.match(this.query, false);
    if (match) {
      if (match[0].length == 0) {
        // Matched empty string, skip to next.
        stream.next();
        return "searching";
      }
      if (!stream.sol()) {
        // Backtrack 1 to match \b
        stream.backUp(1);
        if (!this.query.exec(stream.next() + match[0])) {
          stream.next();
          return null;
        }
      }
      stream.match(this.query);
      return "searching";
    }
    while (!stream.eol()) {
      stream.next();
      if (stream.match(this.query, false)) break;
    }
  }
}

class SearchState {
  searchOverlay: SearchOverlay;
  annotate: any;

  getQuery(): RegExp | undefined {
    return vimGlobalState.query;
  }
  setQuery(query: RegExp) {
    vimGlobalState.query = query;
  }
  getOverlay() {
    return this.searchOverlay;
  }
  setOverlay(overlay: SearchOverlay) {
    this.searchOverlay = overlay;
  }
  isReversed() {
    return vimGlobalState.isReversed;
  }
  setReversed(reversed: boolean) {
    vimGlobalState.isReversed = reversed;
  }
  getScrollbarAnnotate() {
    return this.annotate;
  }
  setScrollbarAnnotate(annotate: any) {
    this.annotate = annotate;
  }
}

function getSearchState(cm: CodeMirror) {
  const vim = cm.state.vim as VimState;
  return vim.searchState_ || (vim.searchState_ = new SearchState());
}
function splitBySlash(argString: string) {
  return splitBySeparator(argString, "/");
}

function findUnescapedSlashes(argString: string) {
  return findUnescapedSeparators(argString, "/");
}

function splitBySeparator(argString: string, separator: string) {
  const slashes = findUnescapedSeparators(argString, separator) || [];
  if (!slashes.length) return [];
  // in case of strings like foo/bar
  if (slashes[0] !== 0) return;

  return slashes.map((s, i) =>
    i < slashes.length - 1 ? argString.substring(s + 1, slashes[i + 1]) : ""
  );
}

function findUnescapedSeparators(str: string, separator?: string) {
  if (!separator) separator = "/";

  let escapeNextChar = false;
  const slashes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charAt(i);
    if (!escapeNextChar && c == separator) {
      slashes.push(i);
    }
    escapeNextChar = !escapeNextChar && c == "\\";
  }
  return slashes;
}

// Translates a search string from ex (vim) syntax into javascript form.
function translateRegex(str: string) {
  // When these match, add a '\' if unescaped or remove one if escaped.
  const specials = "|(){";
  // Remove, but never add, a '\' for these.
  const unescape = "}";
  let escapeNextChar = false;
  const out: string[] = [];
  for (let i = -1; i < str.length; i++) {
    const c = str.charAt(i) || "";
    const n = str.charAt(i + 1) || "";
    let specialComesNext = n && specials.indexOf(n) != -1;
    if (escapeNextChar) {
      if (c !== "\\" || !specialComesNext) {
        out.push(c);
      }
      escapeNextChar = false;
    } else {
      if (c === "\\") {
        escapeNextChar = true;
        // Treat the unescape list as special for removing, but not adding '\'.
        if (n && unescape.indexOf(n) != -1) {
          specialComesNext = true;
        }
        // Not passing this test means removing a '\'.
        if (!specialComesNext || n === "\\") {
          out.push(c);
        }
      } else {
        out.push(c);
        if (specialComesNext && n !== "\\") {
          out.push("\\");
        }
      }
    }
  }
  return out.join("");
}

// Translates the replace part of a search and replace from ex (vim) syntax into
// javascript form.  Similar to translateRegex, but additionally fixes back references
// (translates '\[0..9]' to '$[0..9]') and follows different rules for escaping '$'.
const charUnescapes: Record<string, string> = {
  "\\n": "\n",
  "\\r": "\r",
  "\\t": "\t",
};
function translateRegexReplace(str: string) {
  let escapeNextChar = false;
  const out: string[] = [];
  for (let i = -1; i < str.length; i++) {
    const c = str.charAt(i) || "";
    const n = str.charAt(i + 1) || "";
    if (charUnescapes[c + n]) {
      out.push(charUnescapes[c + n]);
      i++;
    } else if (escapeNextChar) {
      // At any point in the loop, escapeNextChar is true if the previous
      // character was a '\' and was not escaped.
      out.push(c);
      escapeNextChar = false;
    } else {
      if (c === "\\") {
        escapeNextChar = true;
        if (isNumber(n) || n === "$") {
          out.push("$");
        } else if (n !== "/" && n !== "\\") {
          out.push("\\");
        }
      } else {
        if (c === "$") {
          out.push("$");
        }
        out.push(c);
        if (n === "/") {
          out.push("\\");
        }
      }
    }
  }
  return out.join("");
}

// Unescape \ and / in the replace part, for PCRE mode.
const unescapes: Record<string, string> = {
  "\\/": "/",
  "\\\\": "\\",
  "\\n": "\n",
  "\\r": "\r",
  "\\t": "\t",
  "\\&": "&",
};
function unescapeRegexReplace(str: string) {
  const stream = new StringStream(str);
  const output: string[] = [];
  while (!stream.eol()) {
    // Search for \.
    while (stream.peek() && stream.peek() != "\\") {
      output.push(stream.next());
    }
    let matched = false;
    for (const matcher in unescapes) {
      if (stream.match(matcher, true)) {
        matched = true;
        output.push(unescapes[matcher]);
        break;
      }
    }
    if (!matched) {
      // Don't change anything
      output.push(stream.next());
    }
  }
  return output.join("");
}

/**
 * Extract the regular expression from the query and return a Regexp object.
 * Returns null if the query is blank.
 * If ignoreCase is passed in, the Regexp object will have the 'i' flag set.
 * If smartCase is passed in, and the query contains upper case letters,
 *   then ignoreCase is overridden, and the 'i' flag will not be set.
 * If the query contains the /i in the flag part of the regular expression,
 *   then both ignoreCase and smartCase are ignored, and 'i' will be passed
 *   through to the Regex object.
 */
function parseQuery(
  query: string | RegExp,
  ignoreCase: boolean,
  smartCase: boolean
) {
  // First update the last search register
  const lastSearchRegister = vimGlobalState.registerController.getRegister("/");
  lastSearchRegister.setText(typeof query === "string" ? query : query.source);
  // Check if the query is already a regex.
  if (query instanceof RegExp) {
    return query;
  }
  // First try to extract regex + flags from the input. If no flags found,
  // extract just the regex. IE does not accept flags directly defined in
  // the regex string in the form /regex/flags
  const slashes = findUnescapedSlashes(query);
  let regexPart: string;
  let forceIgnoreCase: boolean;
  if (!slashes.length) {
    // Query looks like 'regexp'
    regexPart = query;
  } else {
    // Query looks like 'regexp/...'
    regexPart = query.substring(0, slashes[0]);
    const flagsPart = query.substring(slashes[0]);
    forceIgnoreCase = flagsPart.includes("i");
  }
  if (!regexPart) {
    return null;
  }
  if (!getOption("pcre")) {
    regexPart = translateRegex(regexPart);
  }
  if (smartCase) {
    ignoreCase = /^[^A-Z]*$/.test(regexPart);
  }
  return new RegExp(regexPart, ignoreCase || forceIgnoreCase ? "im" : "m");
}

function showConfirm(cm: CodeMirror, template: string) {
  cm.openNotification(template);
}

interface PromptOptions extends SecInfoOptions {
  prefix: string;
  desc?: string;
  onClose: (value?: string) => void;
}

function showPrompt(cm: CodeMirror, options: PromptOptions) {
  cm.openPrompt(options.prefix, options.desc || "", {
    onKeyDown: options.onKeyDown,
    onKeyUp: options.onKeyUp,
    onClose: options.onClose,
    bottom: true,
    selectValueOnOpen: false,
    value: options.value,
  });
}

function regexEqual(r1: RegExp | string, r2: RegExp | string) {
  if (r1 instanceof RegExp && r2 instanceof RegExp) {
    return (
      r1.global === r2.global &&
      r1.multiline === r2.multiline &&
      r1.ignoreCase === r2.ignoreCase &&
      r1.source === r2.source
    );
  }
  return false;
}
// Returns true if the query is valid.
function updateSearchQuery(
  cm: CodeMirror,
  rawQuery: string,
  ignoreCase?: boolean,
  smartCase?: boolean
) {
  if (!rawQuery) {
    return;
  }
  const state = getSearchState(cm);
  const query = parseQuery(rawQuery, !!ignoreCase, !!smartCase);
  if (!query) {
    return;
  }
  highlightSearchMatches(cm, query);
  if (regexEqual(query, state.getQuery())) {
    return query;
  }
  state.setQuery(query);
  return query;
}

function searchOverlay(query: RegExp) {
  return new SearchOverlay(query);
}

let highlightTimeout: ReturnType<typeof setTimeout>;

function highlightSearchMatches(cm: CodeMirror, query: RegExp) {
  clearTimeout(highlightTimeout);
  highlightTimeout = setTimeout(() => {
    if (!cm.state.vim) return;
    const searchState = getSearchState(cm);
    let overlay = searchState.getOverlay();
    if (!overlay || query != overlay.query) {
      if (overlay) {
        cm.removeOverlay();
      }
      overlay = searchOverlay(query);
      cm.addOverlay(overlay.query);
      searchState.setOverlay(overlay);
    }
  }, 50);
}
function findNext(
  cm: CodeMirror,
  prev: boolean,
  query: RegExp,
  repeat?: number
) {
  if (repeat === undefined) {
    repeat = 1;
  }
  const pos = cm.getCursor();
  let cursor = cm.getSearchCursor(query, pos);
  for (let i = 0; i < repeat; i++) {
    let found = cursor.find(prev);
    if (i == 0 && found && cursorEqual(cursor.from(), pos)) {
      const lastEndPos = prev ? cursor.from() : cursor.to();
      found = cursor.find(prev);
      if (found && cursorEqual(cursor.from(), lastEndPos)) {
        if (cm.getLine(lastEndPos.line).length == lastEndPos.ch) {
          found = cursor.find(prev);
        }
      }
    }
    if (!found) {
      // SearchCursor may have returned null because it hit EOF, wrap
      // around and try again.
      cursor = cm.getSearchCursor(
        query,
        makePos(prev ? cm.lastLine() : cm.firstLine(), 0)
      );
      if (!cursor.find(prev)) {
        return;
      }
    }
  }
  return cursor.from();
}
/**
 * Pretty much the same as `findNext`, except for the following differences:
 *
 * 1. Before starting the search, move to the previous search. This way if our cursor is
 * already inside a match, we should return the current match.
 * 2. Rather than only returning the cursor's from, we return the cursor's from and to as a tuple.
 */
function findNextFromAndToInclusive(
  cm: CodeMirror,
  prev: boolean,
  query: RegExp,
  repeat: number,
  vim: VimState
): [Pos, Pos] {
  if (repeat === undefined) {
    repeat = 1;
  }
  const pos = cm.getCursor();
  let cursor = cm.getSearchCursor(query, pos);

  // Go back one result to ensure that if the cursor is currently a match, we keep it.
  let found = cursor.find(!prev);

  // If we haven't moved, go back one more (similar to if i==0 logic in findNext).
  if (!vim.visualMode && found && cursorEqual(cursor.from(), pos)) {
    cursor.find(!prev);
  }

  for (let i = 0; i < repeat; i++) {
    found = cursor.find(prev);
    if (!found) {
      // SearchCursor may have returned null because it hit EOF, wrap
      // around and try again.
      cursor = cm.getSearchCursor(
        query,
        makePos(prev ? cm.lastLine() : cm.firstLine(), 0)
      );
      if (!cursor.find(prev)) {
        return;
      }
    }
  }
  return [cursor.from(), cursor.to()];
}

function clearSearchHighlight(cm: CodeMirror) {
  const state = getSearchState(cm);
  cm.removeOverlay();
  state.setOverlay(null);
  if (state.getScrollbarAnnotate()) {
    state.getScrollbarAnnotate().clear();
    state.setScrollbarAnnotate(null);
  }
}
/**
 * Check if pos is in the specified range, INCLUSIVE.
 * Range can be specified with 1 or 2 arguments.
 * If the first range argument is an array, treat it as an array of line
 * numbers. Match pos against any of the lines.
 * If the first range argument is a number,
 *   if there is only 1 range argument, check if pos has the same line
 *       number
 *   if there are 2 range arguments, then check if pos is in between the two
 *       range arguments.
 */
function isInRange(pos: Pos | number, start?: number | number[], end?: number) {
  if (isPos(pos)) {
    // Assume it is a cursor position. Get the line number.
    pos = pos.line;
  }
  if (start instanceof Array) {
    return inArray(pos, start);
  } else {
    if (typeof end === "number") {
      return pos >= start && pos <= end;
    } else {
      return pos == start;
    }
  }
}

function getUserVisibleLines(cm: CodeMirror) {
  const scrollInfo = cm.getScrollInfo();
  const occludeToleranceTop = 6;
  const occludeToleranceBottom = 10;
  const from: Pos = { ch: 0, line: occludeToleranceTop + scrollInfo.top };
  const bottomY =
    scrollInfo.clientHeight - occludeToleranceBottom + scrollInfo.top;
  const to: Pos = { ch: 0, line: bottomY };
  return { top: from.line, bottom: to.line };
}

function getMarkPos(cm: CodeMirror, vim: VimState, markName: string) {
  if (markName == "'" || markName == "`") {
    return vimGlobalState.jumpList.find(cm, -1) || makePos(0, 0);
  } else if (markName == ".") {
    return getLastEditPos(cm);
  }

  const mark = vim.marks[markName];
  return mark && mark.find();
}

function getLastEditPos(cm: CodeMirror): Pos {
  return null;
}

class ExCommandDispatcher {
  commandMap_: Record<string, ExCommand> = {};

  constructor() {
    this.buildCommandMap_();
  }

  processCommand(
    cm: CodeMirror,
    input: string,
    opt_params?: ExCommandOptionalParameters
  ) {
    cm.curOp.isVimOp = true;
    this._processCommand(cm, input, opt_params);
  }

  private _processCommand(
    cm: CodeMirror,
    input: string,
    opt_params?: ExCommandOptionalParameters
  ) {
    const vim = cm.state.vim as VimState;
    const commandHistoryRegister =
      vimGlobalState.registerController.getRegister(":");
    const previousCommand = commandHistoryRegister.toString();
    if (vim.visualMode) {
      exitVisualMode(cm);
    }
    const inputStream = new StringStream(input);
    // update ": with the latest command whether valid or invalid
    commandHistoryRegister.setText(input);
    const params = opt_params || {};
    params.input = input;
    try {
      this.parseInput_(cm, inputStream, params);
    } catch (e) {
      showConfirm(cm, e.toString());
      throw e;
    }
    let command: ExCommand;
    let commandName: string;
    if (!params.commandName) {
      // If only a line range is defined, move to the line.
      if (params.line !== undefined) {
        commandName = "move";
      }
    } else {
      command = this.matchCommand_(params.commandName);
      if (command) {
        commandName = command.name;
        if (command.excludeFromCommandHistory) {
          commandHistoryRegister.setText(previousCommand);
        }
        this.parseCommandArgs_(inputStream, params, command);
        if (command.type == "exToKey") {
          // Handle Ex to Key mapping.
          for (let i = 0; i < command.toKeys.length; i++) {
            vimApi.handleKey(cm, command.toKeys[i], "mapping");
          }
          return;
        } else if (command.type == "exToEx") {
          // Handle Ex to Ex mapping.
          this.processCommand(cm, command.toInput);
          return;
        }
      }
    }
    if (!commandName) {
      showConfirm(cm, `Not an editor command ":${input}"`);
      return;
    }
    try {
      exCommands[commandName](cm, { input: "", ...params });
      // Possibly asynchronous commands (e.g. substitute, which might have a
      // user confirmation), are responsible for calling the callback when
      // done. All others have it taken care of for them here.
      if ((!command || !command.possiblyAsync) && params.callback) {
        params.callback();
      }
    } catch (e) {
      showConfirm(cm, e.toString());
      throw e;
    }
  }

  private parseInput_(
    cm: CodeMirror,
    inputStream: StringStream,
    result: ExCommandOptionalParameters
  ) {
    inputStream.eatWhile(":");
    // Parse range.
    if (inputStream.eat("%")) {
      result.line = cm.firstLine();
      result.lineEnd = cm.lastLine();
    } else {
      result.line = this.parseLineSpec_(cm, inputStream);
      if (result.line !== undefined && inputStream.eat(",")) {
        result.lineEnd = this.parseLineSpec_(cm, inputStream);
      }
    }

    // Parse command name.
    const commandMatch = inputStream.match(/^(\w+|!!|@@|[!#&*<=>@~])/);
    if (commandMatch) {
      result.commandName = commandMatch[1];
    } else {
      result.commandName = inputStream.match(/.*/)[0];
    }

    return result;
  }

  private parseLineSpec_(cm: CodeMirror, inputStream: StringStream) {
    const numberMatch = inputStream.match(/^(\d+)/);
    if (numberMatch) {
      // Absolute line number plus offset (N+M or N-M) is probably a typo,
      // not something the user actually wanted. (NB: vim does allow this.)
      return parseInt(numberMatch[1], 10) - 1;
    }
    switch (inputStream.next()) {
      case ".":
        return this.parseLineSpecOffset_(inputStream, cm.getCursor().line);
      case "$":
        return this.parseLineSpecOffset_(inputStream, cm.lastLine());
      case "'":
        const markName = inputStream.next();
        const markPos = getMarkPos(cm, cm.state.vim, markName);
        if (!markPos) throw new Error("Mark not set");
        return this.parseLineSpecOffset_(inputStream, markPos.line);
      case "-":
      case "+":
        inputStream.backUp(1);
        // Offset is relative to current line if not otherwise specified.
        return this.parseLineSpecOffset_(inputStream, cm.getCursor().line);
      default:
        inputStream.backUp(1);
        return undefined;
    }
  }

  private parseLineSpecOffset_(inputStream: StringStream, line: number) {
    const offsetMatch = inputStream.match(/^([+-])?(\d+)/);
    if (offsetMatch) {
      const offset = parseInt(offsetMatch[2], 10);
      if (offsetMatch[1] == "-") {
        line -= offset;
      } else {
        line += offset;
      }
    }
    return line;
  }

  private parseCommandArgs_(
    inputStream: StringStream,
    params: ExCommandOptionalParameters,
    command: ExCommand
  ) {
    if (inputStream.eol()) {
      return;
    }
    params.argString = inputStream.match(/.*/)[0];
    // Parse command-line arguments
    const delim = /\s+/;
    const args = trim(params.argString).split(delim);
    if (args.length && args[0]) {
      params.args = args;
    }
  }

  private matchCommand_(commandName: string) {
    // Return the command in the command map that matches the shortest
    // prefix of the passed in command name. The match is guaranteed to be
    // unambiguous if the defaultExCommandMap's shortNames are set up
    // correctly. (see @code{defaultExCommandMap}).
    for (let i = commandName.length; i > 0; i--) {
      const prefix = commandName.substring(0, i);
      if (this.commandMap_[prefix]) {
        const command = this.commandMap_[prefix];
        if (command.name.indexOf(commandName) === 0) {
          return command;
        }
      }
    }
    return null;
  }

  private buildCommandMap_() {
    this.commandMap_ = {};
    for (let i = 0; i < defaultExCommandMap.length; i++) {
      const command = defaultExCommandMap[i];
      const key = command.shortName || command.name;
      this.commandMap_[key] = command;
    }
  }

  map(lhs: string, rhs: string, ctx?: Context) {
    if (lhs != ":" && lhs.charAt(0) == ":") {
      if (ctx) {
        throw Error("Mode not supported for ex mappings");
      }
      const commandName = lhs.substring(1);
      if (rhs != ":" && rhs.charAt(0) == ":") {
        // Ex to Ex mapping
        this.commandMap_[commandName] = {
          name: commandName,
          type: "exToEx",
          toInput: rhs.substring(1),
          user: true,
        };
      } else {
        // Ex to key mapping
        this.commandMap_[commandName] = {
          name: commandName,
          type: "exToKey",
          toKeys: rhs,
          user: true,
        };
      }
    } else {
      if (rhs != ":" && rhs.charAt(0) == ":") {
        // Key to Ex mapping.
        const mapping: KeyMapping = {
          keys: lhs,
          type: "keyToEx",
          exArgs: { input: rhs.substring(1) },
        };
        if (ctx) {
          mapping.context = ctx;
        }
        defaultKeymap.unshift(mapping);
      } else {
        // Key to key mapping
        const mapping: KeyMapping = {
          keys: lhs,
          type: "keyToKey",
          toKeys: rhs,
        };
        if (ctx) {
          mapping.context = ctx;
        }
        defaultKeymap.unshift(mapping);
      }
    }
  }

  unmap(lhs: string, ctx?: Context) {
    if (lhs != ":" && lhs.charAt(0) == ":") {
      // Ex to Ex or Ex to key mapping
      if (ctx) {
        throw Error("Mode not supported for ex mappings");
      }
      const commandName = lhs.substring(1);
      if (this.commandMap_[commandName] && this.commandMap_[commandName].user) {
        delete this.commandMap_[commandName];
        return true;
      }
    } else {
      // Key to Ex or key to key mapping
      const keys = lhs;
      for (let i = 0; i < defaultKeymap.length; i++) {
        if (keys == defaultKeymap[i].keys && defaultKeymap[i].context === ctx) {
          defaultKeymap.splice(i, 1);
          return true;
        }
      }
    }
  }
}

interface ExCommandOptionalParameters {
  callback?: () => void;
  input?: string;
  commandName?: string;
  line?: number;
  lineEnd?: number;
  argString?: string;
  args?: string[];
}

interface ExCommandParams extends ExCommandOptionalParameters {
  input: string;
  setCfg?: {
    scope?: "local" | "global";
  };
}

type ExCommandFunc = (
  cm: CodeMirror,
  params: ExCommandParams,
  ctx?: Context
) => void;

const exCommands: Record<string, ExCommandFunc> = {
  colorscheme: function (cm, params) {
    if (!params.args || params.args.length < 1) {
      showConfirm(cm, cm.getOption("theme"));
      return;
    }
    cm.setOption("theme", params.args[0]);
  },
  map: function (cm, params, ctx) {
    const mapArgs = params.args;
    if (!mapArgs || mapArgs.length < 2) {
      if (cm) {
        showConfirm(cm, "Invalid mapping: " + params.input);
      }
      return;
    }
    exCommandDispatcher.map(mapArgs[0], mapArgs[1], ctx);
  },
  imap: function (cm, params) {
    this.map(cm, params, "insert");
  },
  nmap: function (cm, params) {
    this.map(cm, params, "normal");
  },
  vmap: function (cm, params) {
    this.map(cm, params, "visual");
  },
  unmap: function (cm, params, ctx) {
    const mapArgs = params.args;
    if (
      !mapArgs ||
      mapArgs.length < 1 ||
      !exCommandDispatcher.unmap(mapArgs[0], ctx)
    ) {
      if (cm) {
        showConfirm(cm, "No such mapping: " + params.input);
      }
    }
  },
  move: function (cm, params) {
    commandDispatcher.processCommand(cm, cm.state.vim, {
      keys: "",
      type: "motion",
      motion: "moveToLineOrEdgeOfDocument",
      motionArgs: { forward: false, explicitRepeat: true, linewise: true },
      repeatOverride: params.line + 1,
    });
  },
  set: function (cm, params) {
    const setArgs = params.args;
    // Options passed through to the setOption/getOption calls. May be passed in by the
    // local/global versions of the set command
    const setCfg = params.setCfg || {};
    if (!setArgs || setArgs.length < 1) {
      if (cm) {
        showConfirm(cm, "Invalid mapping: " + params.input);
      }
      return;
    }
    const expr = setArgs[0].split("=");
    let optionName = expr[0];
    let value: string | boolean = expr[1];
    let forceGet = false;

    if (optionName.charAt(optionName.length - 1) == "?") {
      // If post-fixed with ?, then the set is actually a get.
      if (value) {
        throw Error("Trailing characters: " + params.argString);
      }
      optionName = optionName.substring(0, optionName.length - 1);
      forceGet = true;
    }
    if (value === undefined && optionName.substring(0, 2) == "no") {
      // To set boolean options to false, the option name is prefixed with
      // 'no'.
      optionName = optionName.substring(2);
      value = false;
    }

    const optionIsBoolean =
      options.has(optionName) && options.get(optionName).type == "boolean";
    if (optionIsBoolean && value == undefined) {
      // Calling set with a boolean option sets it to true.
      value = true;
    }
    // If no value is provided, then we assume this is a get.
    if ((!optionIsBoolean && value === undefined) || forceGet) {
      const oldValue = getOption(optionName, cm, setCfg);
      if (oldValue instanceof Error) {
        showConfirm(cm, oldValue.message);
      } else if (oldValue === true || oldValue === false) {
        showConfirm(cm, " " + (oldValue ? "" : "no") + optionName);
      } else {
        showConfirm(cm, "  " + optionName + "=" + oldValue);
      }
    } else {
      const setOptionReturn = setOption(optionName, value, cm, setCfg);
      if (setOptionReturn instanceof Error) {
        showConfirm(cm, setOptionReturn.message);
      }
    }
  },
  setlocal: function (cm, params) {
    // setCfg is passed through to setOption
    params.setCfg = { scope: "local" };
    this.set(cm, params);
  },
  setglobal: function (cm, params) {
    // setCfg is passed through to setOption
    params.setCfg = { scope: "global" };
    this.set(cm, params);
  },
  registers: function (cm, params) {
    const regArgs = params.args;
    const registers = vimGlobalState.registerController.registers;
    const regInfo = ["----------Registers----------", ""];
    if (!regArgs) {
      for (const registerName in registers) {
        const text = registers[registerName].toString();
        if (text.length) {
          regInfo.push(`"${registerName}"     ${text}`);
        }
      }
    } else {
      const reglist = regArgs.join("");
      for (let i = 0; i < reglist.length; i++) {
        const registerName = reglist.charAt(i);
        if (!vimGlobalState.registerController.isValidRegister(registerName)) {
          continue;
        }
        const register = registers[registerName] || new Register();
        regInfo.push(`"#{registerName}"     ${register.toString()}`);
      }
    }
    showConfirm(cm, regInfo.join("\n"));
  },
  sort: function (cm, params) {
    let reverse: boolean;
    let ignoreCase: boolean;
    let unique: boolean;
    let number: "decimal" | "hex" | "octal";
    let pattern: RegExp;
    const parseArgs = () => {
      if (params.argString) {
        const args = new StringStream(params.argString);
        if (args.eat("!")) {
          reverse = true;
        }
        if (args.eol()) {
          return;
        }
        if (!args.eatSpace()) {
          return "Invalid arguments";
        }
        const opts = args.match(/([dinuox]+)?\s*(\/.+\/)?\s*/, false);
        if (!opts && !args.eol()) {
          return "Invalid arguments";
        }
        if (opts[1]) {
          ignoreCase = opts[1].indexOf("i") != -1;
          unique = opts[1].indexOf("u") != -1;
          const decimal =
            opts[1].indexOf("d") != -1 || opts[1].indexOf("n") != -1 ? 1 : 0;
          const hex = opts[1].indexOf("x") != -1 ? 1 : 0;
          const octal = opts[1].indexOf("o") != -1 ? 1 : 0;
          if (decimal + hex + octal > 1) {
            return "Invalid arguments";
          }
          number = decimal
            ? "decimal"
            : hex
            ? "hex"
            : octal
            ? "octal"
            : undefined;
        }
        if (opts[2]) {
          pattern = new RegExp(
            opts[2].substring(1, opts[2].length - 1),
            ignoreCase ? "i" : ""
          );
        }
      }
    };
    const err = parseArgs();
    if (err) {
      showConfirm(cm, err + ": " + params.argString);
      return;
    }
    const lineStart = params.line || cm.firstLine();
    const lineEnd = params.lineEnd || params.line || cm.lastLine();
    if (lineStart == lineEnd) {
      return;
    }
    const curStart = makePos(lineStart, 0);
    const curEnd = makePos(lineEnd, lineLength(cm, lineEnd));
    const text = cm.getRange(curStart, curEnd).split("\n");
    const numberRegex = pattern
      ? pattern
      : number == "decimal"
      ? /(-?)([\d]+)/
      : number == "hex"
      ? /(-?)(?:0x)?([0-9a-f]+)/i
      : number == "octal"
      ? /([0-7]+)/
      : null;
    const radix =
      number == "decimal"
        ? 10
        : number == "hex"
        ? 16
        : number == "octal"
        ? 8
        : null;
    const numPart: (RegExpMatchArray | string)[] = [];
    const textPart: string[] = [];
    if (number || pattern) {
      for (let i = 0; i < text.length; i++) {
        const matchPart = pattern ? text[i].match(pattern) : null;
        if (matchPart && matchPart[0] != "") {
          numPart.push(matchPart);
        } else if (!pattern && numberRegex.exec(text[i])) {
          numPart.push(text[i]);
        } else {
          textPart.push(text[i]);
        }
      }
    } else {
      textPart.push(...text);
    }
    const compareFn = (a: string, b: string) => {
      if (reverse) {
        const tmp = a;
        a = b;
        b = tmp;
      }
      if (ignoreCase) {
        a = a.toLowerCase();
        b = b.toLowerCase();
      }
      const anum = number && numberRegex.exec(a);
      const bnum = number && numberRegex.exec(b);
      if (!anum) {
        return a < b ? -1 : 1;
      }
      return (
        parseInt((anum[1] + anum[2]).toLowerCase(), radix) -
        parseInt((bnum[1] + bnum[2]).toLowerCase(), radix)
      );
    };
    const comparePatternFn = (a: string, b: string) => {
      if (reverse) {
        const tmp = a;
        a = b;
        b = tmp;
      }
      if (ignoreCase) {
        return a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1;
      } else {
        return a[0] < b[0] ? -1 : 1;
      }
    };
    numPart.sort(pattern ? comparePatternFn : compareFn);
    if (pattern) {
      for (let i = 0; i < numPart.length; i++) {
        const np = numPart[i];
        if (typeof np !== "string") {
          numPart[i] = np.input;
        }
      }
    } else if (!number) {
      textPart.sort(compareFn);
    }
    text.splice(0, text.length);
    if (!reverse) {
      text.push(...textPart);
      text.push(
        ...numPart.map((el) => (typeof el === "string" ? el : el.toString()))
      );
    } else {
      text.push(
        ...numPart.map((el) => (typeof el === "string" ? el : el.toString()))
      );
      text.push(...textPart);
    }
    if (unique) {
      // Remove duplicate lines
      let lastLine = "";
      for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] == lastLine) {
          text.splice(i, 1);
        } else {
          lastLine = text[i];
        }
      }
    }
    cm.replaceRange(text.join("\n"), curStart, curEnd);
  },
  vglobal: function (cm, params) {
    // global inspects params.commandName
    this.global(cm, params);
  },
  global: function (cm, params) {
    // a global command is of the form
    // :[range]g/pattern/[cmd]
    // argString holds the string /pattern/[cmd]
    const argString = params.argString;
    if (!argString) {
      showConfirm(cm, "Regular Expression missing from global");
      return;
    }
    const inverted = params.commandName[0] === "v";
    // range is specified here
    const lineStart = params.line !== undefined ? params.line : cm.firstLine();
    const lineEnd = params.lineEnd || params.line || cm.lastLine();
    // get the tokens from argString
    const tokens = splitBySlash(argString);
    let regexPart = argString;
    let cmd: string;
    if (tokens.length) {
      regexPart = tokens[0];
      cmd = tokens.slice(1, tokens.length).join("/");
    }
    if (regexPart) {
      // If regex part is empty, then use the previous query. Otherwise
      // use the regex part as the new query.
      try {
        updateSearchQuery(
          cm,
          regexPart,
          true /** ignoreCase */,
          true /** smartCase */
        );
      } catch (e) {
        showConfirm(cm, "Invalid regex: " + regexPart);
        return;
      }
    }
    // now that we have the regexPart, search for regex matches in the
    // specified range of lines
    const query = getSearchState(cm).getQuery();
    const matchedLines: { line: number; text: string }[] = [];
    for (let i = lineStart; i <= lineEnd; i++) {
      const line = cm.getLine(i);
      const matched = query.test(line);
      if (matched !== inverted) {
        matchedLines.push({ line: i, text: line });
      }
    }
    // if there is no [cmd], just display the list of matched lines
    if (!cmd) {
      showConfirm(cm, matchedLines.map((el) => el.text).join("\n"));
      return;
    }
    let index = 0;
    const nextCommand = () => {
      if (index < matchedLines.length) {
        const line = matchedLines[index++];
        const command = `${line.line + 1}${cmd}`;
        exCommandDispatcher.processCommand(cm, command, {
          callback: nextCommand,
        });
      }
    };
    nextCommand();
  },
  substitute: function (cm, params) {
    if (!cm.getSearchCursor) {
      throw new Error(
        "Search feature not available. Requires searchcursor.js or " +
          "any other getSearchCursor implementation."
      );
    }
    const argString = params.argString;
    const tokens = argString ? splitBySeparator(argString, argString[0]) : [];
    let regexPart: string;
    let replacePart = "";
    let trailing: string[];
    let count: number;
    let confirm = false; // Whether to confirm each replace.
    let global = false; // True to replace all instances on a line, false to replace only 1.
    if (tokens.length) {
      regexPart = tokens[0];
      if (getOption("pcre") && regexPart !== "") {
        regexPart = new RegExp(regexPart).source; //normalize not escaped characters
      }
      replacePart = tokens[1];
      if (replacePart !== undefined) {
        if (getOption("pcre")) {
          replacePart = unescapeRegexReplace(
            replacePart.replace(/([^\\])&/g, "$1$$&")
          );
        } else {
          replacePart = translateRegexReplace(replacePart);
        }
        vimGlobalState.lastSubstituteReplacePart = replacePart;
      }
      trailing = tokens[2] ? tokens[2].split(" ") : [];
    } else {
      // either the argString is empty or its of the form ' hello/world'
      // actually splitBySlash returns a list of tokens
      // only if the string starts with a '/'
      if (argString && argString.length) {
        showConfirm(
          cm,
          "Substitutions should be of the form " + ":s/pattern/replace/"
        );
        return;
      }
    }
    // After the 3rd slash, we can have flags followed by a space followed
    // by count.
    if (trailing) {
      const flagsPart = trailing[0];
      count = parseInt(trailing[1]);
      if (flagsPart) {
        if (flagsPart.includes("c")) {
          confirm = true;
        }
        if (flagsPart.includes("g")) {
          global = true;
        }
        if (getOption("pcre")) {
          regexPart = regexPart + "/" + flagsPart;
        } else {
          regexPart = regexPart.replace(/\//g, "\\/") + "/" + flagsPart;
        }
      }
    }
    if (regexPart) {
      // If regex part is empty, then use the previous query. Otherwise use
      // the regex part as the new query.
      try {
        updateSearchQuery(
          cm,
          regexPart,
          true /** ignoreCase */,
          true /** smartCase */
        );
      } catch (e) {
        showConfirm(cm, "Invalid regex: " + regexPart);
        return;
      }
    }
    replacePart = replacePart || vimGlobalState.lastSubstituteReplacePart;
    if (replacePart === undefined) {
      showConfirm(cm, "No previous substitute regular expression");
      return;
    }
    const state = getSearchState(cm);
    const query = state.getQuery();
    let lineStart =
      params.line !== undefined ? params.line : cm.getCursor().line;
    let lineEnd = params.lineEnd || lineStart;
    if (lineStart == cm.firstLine() && lineEnd == cm.lastLine()) {
      lineEnd = Infinity;
    }
    if (count) {
      lineStart = lineEnd;
      lineEnd = lineStart + count - 1;
    }
    const startPos = clipCursorToContent(cm, makePos(lineStart, 0));
    const cursor = cm.getSearchCursor(query, startPos);
    cm.pushUndoStop();
    doReplace(
      cm,
      confirm,
      global,
      lineStart,
      lineEnd,
      cursor,
      query,
      replacePart,
      params.callback
    );
  },
  redo: CodeMirror.commands.redo,
  undo: CodeMirror.commands.undo,
  edit: function (cm) {
    if (CodeMirror.commands.open) {
      // If an open command is defined, call it.
      CodeMirror.commands.open(cm);
    }
  },
  write: function (cm) {
    if (CodeMirror.commands.save) {
      // If a save command is defined, call it.
      CodeMirror.commands.save(cm);
    }
  },
  nohlsearch: function (cm) {
    clearSearchHighlight(cm);
  },
  yank: function (cm) {
    const cur = copyCursor(cm.getCursor());
    const line = cur.line;
    const lineText = cm.getLine(line);
    vimGlobalState.registerController.pushText(
      "0",
      "yank",
      lineText,
      true,
      true
    );
  },
  delmarks: function (cm, params) {
    if (!params.argString || !trim(params.argString)) {
      showConfirm(cm, "Argument required");
      return;
    }

    const state = cm.state.vim as VimState;
    const stream = new StringStream(trim(params.argString));
    while (!stream.eol()) {
      stream.eatSpace();

      // Record the streams position at the beginning of the loop for use
      // in error messages.
      let count = stream.pos;

      if (!stream.match(/[a-zA-Z]/, false)) {
        showConfirm(
          cm,
          "Invalid argument: " + params.argString.substring(count)
        );
        return;
      }

      const sym = stream.next();
      // Check if this symbol is part of a range
      if (stream.match("-", true)) {
        // This symbol is part of a range.

        // The range must terminate at an alphabetic character.
        if (!stream.match(/[a-zA-Z]/, false)) {
          showConfirm(
            cm,
            "Invalid argument: " + params.argString.substring(count)
          );
          return;
        }

        const startMark = sym;
        const finishMark = stream.next();
        // The range must terminate at an alphabetic character which
        // shares the same case as the start of the range.
        if (
          (isLowerCase(startMark) && isLowerCase(finishMark)) ||
          (isUpperCase(startMark) && isUpperCase(finishMark))
        ) {
          const start = startMark.charCodeAt(0);
          const finish = finishMark.charCodeAt(0);
          if (start >= finish) {
            showConfirm(
              cm,
              "Invalid argument: " + params.argString.substring(count)
            );
            return;
          }

          // Because marks are always ASCII values, and we have
          // determined that they are the same case, we can use
          // their char codes to iterate through the defined range.
          for (let j = 0; j <= finish - start; j++) {
            const mark = String.fromCharCode(start + j);
            delete state.marks[mark];
          }
        } else {
          showConfirm(cm, "Invalid argument: " + startMark + "-");
          return;
        }
      } else {
        // This symbol is a valid mark, and is not part of a range.
        delete state.marks[sym];
      }
    }
  },
};

const exCommandDispatcher = new ExCommandDispatcher();

/**
 * @param {CodeMirror} cm CodeMirror instance we are in.
 * @param {boolean} confirm Whether to confirm each replace.
 * @param {Cursor} lineStart Line to start replacing from.
 * @param {Cursor} lineEnd Line to stop replacing at.
 * @param {RegExp} query Query for performing matches with.
 * @param {string} replaceWith Text to replace matches with. May contain $1,
 *     $2, etc for replacing captured groups using JavaScript replace.
 * @param {function()} callback A callback for when the replace is done.
 */
function doReplace(
  cm: CodeMirror,
  confirm: boolean,
  global: boolean,
  lineStart: number,
  lineEnd: number,
  searchCursor: ReturnType<InstanceType<typeof CodeMirror>["getSearchCursor"]>,
  query: RegExp,
  replaceWith: string,
  callback: () => void
) {
  const vim = cm.state.vim as VimState;
  // Set up all the functions.
  vim.exMode = true;

  let done = false;
  let lastPos: Pos;
  let modifiedLineNumber: number;
  let joined: boolean;
  const replaceAll = () => {
    while (!done) {
      replace();
      next();
    }
    stop();
  };
  const replace = () => {
    const text = cm.getRange(searchCursor.from(), searchCursor.to());
    const newText = text.replace(query, replaceWith);
    const unmodifiedLineNumber = searchCursor.to().line;
    searchCursor.replace(newText);
    modifiedLineNumber = searchCursor.to().line;
    lineEnd += modifiedLineNumber - unmodifiedLineNumber;
    joined = modifiedLineNumber < unmodifiedLineNumber;
  };
  const findNextValidMatch = () => {
    const lastMatchTo = lastPos && copyCursor(searchCursor.to());
    let match = searchCursor.findNext();
    if (
      match &&
      !match[0] &&
      lastMatchTo &&
      cursorEqual(searchCursor.from(), lastMatchTo)
    ) {
      match = searchCursor.findNext();
    }
    return match;
  };
  const next = () => {
    // The below only loops to skip over multiple occurrences on the same
    // line when 'global' is not true.
    while (
      findNextValidMatch() &&
      isInRange(searchCursor.from(), lineStart, lineEnd)
    ) {
      if (
        !global &&
        searchCursor.from().line == modifiedLineNumber &&
        !joined
      ) {
        continue;
      }
      cm.scrollIntoView(searchCursor.from(), 30);
      cm.setSelection(searchCursor.from(), searchCursor.to());
      lastPos = searchCursor.from();
      done = false;
      return;
    }
    done = true;
  };
  const stop = (close?: () => void) => {
    if (close) {
      close();
    }
    cm.focus();
    if (lastPos) {
      cm.setCursor(lastPos);
      const vim = cm.state.vim as VimState;
      vim.exMode = false;
      vim.lastHPos = vim.lastHSPos = lastPos.ch;
    }
    if (callback) {
      callback();
    }
  };
  const onPromptKeyDown = (
    e: KeyboardEvent,
    _value: any,
    close: () => void
  ) => {
    // Swallow all keys.
    CodeMirror.e_stop(e);
    const keyName = CodeMirror.keyName(e);
    switch (keyName) {
      case "Y":
        replace();
        next();
        break;
      case "N":
        next();
        break;
      case "A":
        // replaceAll contains a call to close of its own. We don't want it
        // to fire too early or multiple times.
        const savedCallback = callback;
        callback = undefined;
        replaceAll();
        callback = savedCallback;
        break;
      case "L":
        replace();
      // fall through and exit.
      case "Q":
      case "Esc":
      case "Ctrl-C":
      case "Ctrl-[":
        stop(close);
        break;
    }
    if (done) {
      stop(close);
    }
    return true;
  };

  // Actually do replace.
  next();
  if (done) {
    showConfirm(cm, "No matches for " + query.source);
    return;
  }
  if (!confirm) {
    replaceAll();
    if (callback) {
      callback();
    }
    return;
  }
  showPrompt(cm, {
    prefix: `replace with **${replaceWith}** (y/n/a/q/l)`,
    onKeyDown: onPromptKeyDown,
    desc: "",
    onClose: () => {},
  });
}

function exitInsertMode(cm: CodeMirror) {
  const vim = cm.state.vim as VimState;
  const macroModeState = vimGlobalState.macroModeState;
  const insertModeChangeRegister =
    vimGlobalState.registerController.getRegister(".");
  const isPlaying = macroModeState.isPlaying;
  const lastChange = macroModeState.lastInsertModeChanges;
  if (!isPlaying) {
    cm.off("change", onChange);
  }
  if (!isPlaying && vim.insertModeRepeat > 1) {
    // Perform insert mode repeat for commands like 3,a and 3,o.
    repeatLastEdit(
      cm,
      vim,
      vim.insertModeRepeat - 1,
      true /** repeatForInsert */
    );
    vim.lastEditInputState.repeatOverride = vim.insertModeRepeat;
  }
  delete vim.insertModeRepeat;
  vim.insertMode = false;
  cm.setCursor(cm.getCursor().line, cm.getCursor().ch - 1);
  cm.setOption("keyMap", "vim");
  cm.setOption("disableInput", true);
  cm.toggleOverwrite(false); // exit replace mode if we were in it.
  // update the ". register before exiting insert mode
  insertModeChangeRegister.setText(lastChange.changes.join(""));
  signal(cm, "vim-mode-change", { mode: "normal" });
  if (macroModeState.isRecording) {
    logInsertModeChange(macroModeState);
  }
  cm.enterVimMode();
}

function _mapCommand(command: KeyMapping) {
  defaultKeymap.unshift(command);
}

function mapCommand(
  keys: string,
  type: MappableCommandType,
  name: string,
  args: MappableArgType,
  extra: any
) {
  const command: KeyMapping = { keys: keys, type: type };
  switch (type) {
    case "motion":
      command.motion = name;
      command.motionArgs = args as MotionArgs;
      break;
    case "action":
      command.action = name;
      command.actionArgs = args as ActionArgs;
      break;
    case "operator":
      command.operator = name;
      command.operatorArgs = args as OperatorArgs;
      break;
    case "operatorMotion":
      command.operatorMotion = name;
      command.operatorMotionArgs = args as OperatorMotionArgs;
      break;
    case "search":
      command.search = name;
      command.searchArgs = args as SearchArgs;
      break;
    case "ex":
      command.ex = name;
      command.exArgs = args as ExArgs;
      break;
  }
  for (const key of Object.keys(extra)) {
    (command as any)[key] = extra[key];
  }
  _mapCommand(command);
}

// The timeout in milliseconds for the two-character ESC keymap should be
// adjusted according to your typing speed to prevent false positives.
defineOption("insertModeEscKeysTimeout", 200, "number");

function executeMacroRegister(
  cm: CodeMirror,
  vim: VimState,
  macroModeState: MacroModeState,
  registerName: string
) {
  const register = vimGlobalState.registerController.getRegister(registerName);
  if (registerName == ":") {
    // Read-only register containing last Ex command.
    if (register.keyBuffer[0]) {
      exCommandDispatcher.processCommand(cm, register.keyBuffer[0]);
    }
    macroModeState.isPlaying = false;
    return;
  }
  const keyBuffer = register.keyBuffer;
  let imc = 0;
  macroModeState.isPlaying = true;
  macroModeState.replaySearchQueries = register.searchQueries.slice(0);
  for (let i = 0; i < keyBuffer.length; i++) {
    let text = keyBuffer[i];
    let match: RegExpExecArray;
    let key: string;
    while (text) {
      // Pull off one command key, which is either a single character
      // or a special sequence wrapped in '<' and '>', e.g. '<Space>'.
      match = /<\w+-.+?>|<\w+>|./.exec(text);
      key = match[0];
      text = text.substring(match.index + key.length);
      vimApi.handleKey(cm, key, "macro");
      if (vim.insertMode) {
        const changes = register.insertModeChanges[imc++].changes;
        vimGlobalState.macroModeState.lastInsertModeChanges.changes = changes;
        repeatInsertModeChanges(cm, changes, 1);
        exitInsertMode(cm);
      }
    }
  }
  macroModeState.isPlaying = false;
}

function logKey(macroModeState: MacroModeState, key: string) {
  if (macroModeState.isPlaying) {
    return;
  }
  const registerName = macroModeState.latestRegister;
  const register = vimGlobalState.registerController.getRegister(registerName);
  if (register) {
    register.pushText(key);
  }
}

function logInsertModeChange(macroModeState: MacroModeState) {
  if (macroModeState.isPlaying) {
    return;
  }
  const registerName = macroModeState.latestRegister;
  const register = vimGlobalState.registerController.getRegister(registerName);
  if (register && register.pushInsertModeChanges) {
    register.pushInsertModeChanges(macroModeState.lastInsertModeChanges);
  }
}

function logSearchQuery(macroModeState: MacroModeState, query: string) {
  if (macroModeState.isPlaying) {
    return;
  }
  const registerName = macroModeState.latestRegister;
  const register = vimGlobalState.registerController.getRegister(registerName);
  if (register && register.pushSearchQuery) {
    register.pushSearchQuery(query);
  }
}

/**
 * Listens for changes made in insert mode.
 * Should only be active in insert mode.
 */
function onChange(cm: CodeMirror, changeObj: Change) {
  const macroModeState = vimGlobalState.macroModeState;
  const lastChange = macroModeState.lastInsertModeChanges;
  if (!macroModeState.isPlaying) {
    while (changeObj) {
      lastChange.expectCursorActivityForChange = true;
      if (lastChange.ignoreCount > 1) {
        lastChange.ignoreCount--;
      } else if (
        changeObj.origin == "+input" ||
        changeObj.origin == "paste" ||
        changeObj.origin === undefined /* only in testing */
      ) {
        const selectionCount = cm.listSelections().length;
        if (selectionCount > 1) lastChange.ignoreCount = selectionCount;
        const text = changeObj.text.join("\n");
        if (lastChange.maybeReset) {
          lastChange.changes = [];
          lastChange.maybeReset = false;
        }
        if (text) {
          if (cm.state.overwrite && !/\n/.test(text)) {
            lastChange.changes.push(text);
          } else {
            lastChange.changes.push(text);
          }
        }
      }
      // Change objects may be chained with next.
      changeObj = changeObj.next;
    }
  }
}

/**
 * Listens for any kind of cursor activity on CodeMirror.
 */
function onCursorActivity(cm: CodeMirror) {
  const vim = cm.state.vim as VimState;
  if (vim.insertMode) {
    // Tracking cursor activity in insert mode (for macro support).
    const macroModeState = vimGlobalState.macroModeState;
    if (macroModeState.isPlaying) {
      return;
    }
    const lastChange = macroModeState.lastInsertModeChanges;
    if (lastChange.expectCursorActivityForChange) {
      lastChange.expectCursorActivityForChange = false;
    } else {
      // Cursor moved outside the context of an edit. Reset the change.
      lastChange.maybeReset = true;
    }
  } else if (!cm.curOp.isVimOp) {
    handleExternalSelection(cm, vim);
  }
}
function handleExternalSelection(cm: CodeMirror, vim: VimState) {
  let anchor = cm.getCursor("anchor");
  let head = cm.getCursor("head");
  // Enter or exit visual mode to match mouse selection.
  if (vim.visualMode && !cm.somethingSelected()) {
    exitVisualMode(cm, false);
  } else if (!vim.visualMode && !vim.insertMode && cm.somethingSelected()) {
    vim.visualMode = true;
    vim.visualLine = false;
    signal(cm, "vim-mode-change", { mode: "visual" });
  }
  if (vim.visualMode) {
    // Bind CodeMirror selection model to vim selection model.
    // Mouse selections are considered visual characterwise.
    const headOffset = !cursorIsBefore(head, anchor) ? -1 : 0;
    const anchorOffset = cursorIsBefore(head, anchor) ? -1 : 0;
    head = offsetCursor(head, 0, headOffset);
    anchor = offsetCursor(anchor, 0, anchorOffset);
    vim.sel = new CmSelection(anchor, head);
    updateMark(cm, vim, "<", cursorMin(head, anchor));
    updateMark(cm, vim, ">", cursorMax(head, anchor));
  } else if (!vim.insertMode) {
    // Reset lastHPos if selection was modified by something outside of vim mode e.g. by mouse.
    vim.lastHPos = cm.getCursor().ch;
  }
}

/** Wrapper for special keys pressed in insert mode */
class InsertModeKey {
  readonly keyName: string;
  constructor(keyName: string) {
    this.keyName = keyName;
  }
}

/**
 * Repeats the last edit, which includes exactly 1 command and at most 1
 * insert. Operator and motion commands are read from lastEditInputState,
 * while action commands are read from lastEditActionCommand.
 *
 * If repeatForInsert is true, then the function was called by
 * exitInsertMode to repeat the insert mode changes the user just made. The
 * corresponding enterInsertMode call was made with a count.
 */
function repeatLastEdit(
  cm: CodeMirror,
  vim: VimState,
  repeat: number,
  repeatForInsert: boolean
) {
  const macroModeState = vimGlobalState.macroModeState;
  macroModeState.isPlaying = true;
  const isAction = !!vim.lastEditActionCommand;
  const cachedInputState = vim.inputState;
  const repeatCommand = () => {
    if (isAction) {
      commandDispatcher.processAction(cm, vim, vim.lastEditActionCommand);
    } else {
      commandDispatcher.evalInput(cm, vim);
    }
  };
  const repeatInsert = (repeat: number) => {
    if (macroModeState.lastInsertModeChanges.changes.length > 0) {
      // For some reason, repeat cw in desktop VIM does not repeat
      // insert mode changes. Will conform to that behavior.
      repeat = !vim.lastEditActionCommand ? 1 : repeat;
      const changeObject = macroModeState.lastInsertModeChanges;
      repeatInsertModeChanges(cm, changeObject.changes, repeat);
    }
  };
  vim.inputState = vim.lastEditInputState;
  if (isAction && vim.lastEditActionCommand.interlaceInsertRepeat) {
    // o and O repeat have to be interlaced with insert repeats so that the
    // insertions appear on separate lines instead of the last line.
    for (let i = 0; i < repeat; i++) {
      repeatCommand();
      repeatInsert(1);
    }
  } else {
    if (!repeatForInsert) {
      // Hack to get the cursor to end up at the right place. If I is
      // repeated in insert mode repeat, cursor will be 1 insert
      // change set left of where it should be.
      repeatCommand();
    }
    repeatInsert(repeat);
  }
  vim.inputState = cachedInputState;
  if (vim.insertMode && !repeatForInsert) {
    // Don't exit insert mode twice. If repeatForInsert is set, then we
    // were called by an exitInsertMode call lower on the stack.
    exitInsertMode(cm);
  }
  macroModeState.isPlaying = false;
}

function repeatInsertModeChanges(
  cm: CodeMirror,
  changes: (string | InsertModeKey)[],
  repeat: number
) {
  const keyHandler = (binding: string | ((cm: CodeMirror) => void)) => {
    if (typeof binding == "string") {
      CodeMirror.commands[binding](cm);
    } else {
      binding(cm);
    }
    return true;
  };
  const head = cm.getCursor("head");
  const visualBlock =
    vimGlobalState.macroModeState.lastInsertModeChanges.visualBlock;
  if (visualBlock) {
    // Set up block selection again for repeating the changes.
    selectForInsert(cm, head, visualBlock + 1);
    repeat = cm.listSelections().length;
    cm.setCursor(head);
  }
  for (let i = 0; i < repeat; i++) {
    if (visualBlock) {
      cm.setCursor(offsetCursor(head, i, 0));
    }
    for (let j = 0; j < changes.length; j++) {
      const change = changes[j];
      if (change instanceof InsertModeKey) {
        CodeMirror.lookupKey(change.keyName, "vim-insert", keyHandler);
      } else if (typeof change == "string") {
        cm.replaceSelections([change]);
      }
    }
  }
  if (visualBlock) {
    cm.setCursor(offsetCursor(head, 0, 1));
  }
}

export const initVimAdapter = () => {
  CodeMirror.keyMap.vim = {
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey,
  };

  CodeMirror.keyMap["vim-insert"] = {
    // TODO: override navigation keys so that Esc will cancel automatic
    // indentation from o, O, i_<CR>
    fallthrough: ["default"],
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey,
  };

  CodeMirror.keyMap["vim-replace"] = {
    keys: { Backspace: "goCharLeft" },
    fallthrough: ["vim-insert"],
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey,
  };
};

const vimApi = new VimApi();
