import monaco from "monaco-editor";
import { IStatusBar, StatusBar } from "./statusbar";
import EditorAdapter from "./adapter";
import { IRegister, initVimAdapter, vimApi } from "./keymap_vim";

export const makeDomStatusBar = (
  parent: HTMLElement,
  setFocus?: () => void
): IStatusBar => {
  return new StatusBar(parent, setFocus);
};

interface SetOptionConfig {
  append?: boolean;
  remove?: boolean;
  adapterOption?: boolean;
}

export class VimMode implements EventTarget {
  private editor_: monaco.editor.IStandaloneCodeEditor;
  private statusBar_?: IStatusBar;
  private adapter_: EditorAdapter;
  private keyBuffer_: string = "";
  private attached_: boolean = false;
  private listeners_: Map<string, EventListenerOrEventListenerObject[]> =
    new Map();

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    statusBar?: IStatusBar
  ) {
    this.editor_ = editor;
    this.statusBar_ = statusBar;

    initVimAdapter();
    this.adapter_ = new EditorAdapter(editor);

    this.initListeners();
  }

  private initListeners() {
    this.adapter_.on("vim-set-clipboard-register", () => {
      this.dispatchEvent(new Event("clipboard"));
    });

    if (this.statusBar_) {
      this.adapter_.on("vim-mode-change", (mode) => {
        this.statusBar_.setMode(mode);
      });

      this.adapter_.on("vim-keypress", (key) => {
        if (key === ":") {
          this.keyBuffer_ = "";
        } else {
          this.keyBuffer_ += key;
        }
        this.statusBar_.setKeyBuffer(this.keyBuffer_);
      });

      this.adapter_.on("vim-command-done", () => {
        this.keyBuffer_ = "";
        this.statusBar_.setKeyBuffer(this.keyBuffer_);
      });

      this.adapter_.on("dispose", () => {
        this.statusBar_.toggleVisibility(false);
        this.statusBar_.closeInput();
        this.statusBar_.clear();
      });

      this.adapter_.setStatusBar(this.statusBar_);
    }

    EditorAdapter.commands["open"] = () =>
      this.dispatchEvent(new Event("open-file"));
    EditorAdapter.commands["save"] = () =>
      this.dispatchEvent(new Event("save-file"));
  }

  get attached(): boolean {
    return this.attached_;
  }

  addEventListener(
    type: "clipboard" | "open-file" | "save-file",
    callback: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    const typeListeners = this.listeners_.get(type);
    if (!typeListeners) {
      if (type === "clipboard") {
      }
      this.listeners_.set(type, [callback]);
    } else {
      typeListeners.push(callback);
    }
  }

  dispatchEvent(event: Event): boolean {
    const typeListeners = this.listeners_.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        const callback = Reflect.has(listener, "handleEvent")
          ? (listener as EventListenerObject).handleEvent
          : (listener as EventListener);
        callback(event);
        if (event.cancelable && event.defaultPrevented) {
          break;
        }
      }
    }
    return !(event.cancelable && event.defaultPrevented);
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void {
    const typeListeners = this.listeners_.get(type);
    if (!typeListeners) {
      const index = typeListeners.lastIndexOf(callback);
      if (index >= 0) {
        typeListeners.splice(index, 1);
      }
      if (typeListeners.length == 0) {
        this.listeners_.delete(type);
      }
    }
  }

  enable() {
    if (!this.attached_) {
      this.adapter_.attach();
      this.attached_ = true;
    }
  }

  disable() {
    if (this.attached_) {
      this.adapter_.detach();
      this.attached_ = false;
    }
  }

  setClipboardRegister(register: IRegister) {
    vimApi.defineRegister("*", register);
    vimApi.defineRegister("+", register);
  }

  setOption(
    name: string,
    value: string | number | boolean,
    config?: SetOptionConfig
  ) {
    if (config && config.adapterOption) {
      this.adapter_.setOption(name, value);
    } else {
      vimApi.setOption(name, value, this.adapter_, config);
    }
  }
}
