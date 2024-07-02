import React from "react";
import monaco from "monaco-editor";

import { IconButton } from "./icon-button";
import { EditorThemeContext, ThemeContext } from "./theme-provider";
import {
  Cut,
  Copy,
  Paste,
  Undo,
  Redo,
  Open,
  Save,
  Switch,
} from "./icons/icons";
import { kLanguageId } from "../monaco/language";
import { openFilePicker, saveFilePicker } from "../util";
import { Editor } from "./editor";
import { DslParseError, read } from "../read";
import { evaluate } from "../evaluate";
import { Env } from "../env";
import { addBuiltins } from "../builtins";
import { DslGeneratorError, Expression } from "../dsl";
import { generate, makeContext } from "../generate";
import { Uniform } from "./uniform";
import { HintProvider } from "../monaco/hint-provider";
import { HoverProvider } from "../monaco/hover-provider";
import { CodeLensProvider } from "../monaco/code-lens-provider";
import { PersistedSettings, SettingsEditor } from "./persisted-settings";
import {
  IStatusBar,
  ModeChangeEvent,
  SecInfoOptions,
} from "../monaco/vim-mode/statusbar";
import { initVimMode } from "../monaco/vim-mode/vim-mode";
import CMAdapter from "../monaco/vim-mode/cm_adapter";
import { IRegister, vimApi } from "../monaco/vim-mode/keymap_vim";

interface DslEditorProps {
  line: string;
  style?: React.CSSProperties;
  uniforms: Map<string, Uniform>;
  settings: PersistedSettings;
  onGenerating: (line: string) => void;
  onTogglePositions: () => void;
  onCaptureUniforms: () => string[];
  onSettingsChange: (updated: PersistedSettings) => void;
}

const checkForForcedTheme = (name: string): string => {
  if (window.matchMedia("(forced-colors: active)").matches) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "hc-dark"
      : "hc-light";
  }
  return name;
};

const getErrors = (expr: Expression): Expression[] => {
  const errors: Expression[] = [];
  const pending = [expr];

  while (pending.length > 0) {
    const curr = pending.pop();
    switch (curr.type) {
      case "error":
        errors.push(curr);
        break;
      case "list":
        pending.push(...(curr.value as Expression[]));
        break;
      case "placeholder":
        pending.push(curr.value as Expression);
        break;
    }
  }

  return errors;
};

class ClipboardRegister implements IRegister {
  linewise: boolean = false;
  blockwise: boolean = false;
  private buffer: string[] = [];

  constructor() {}

  setText(text: string, linewise?: boolean, blockwise?: boolean): void {
    this.linewise = !!linewise;
    this.blockwise = !!blockwise;
    this.buffer = [text];
    navigator.clipboard.writeText(text);
  }
  pushText(text: string, linewise?: boolean): void {
    if (linewise) {
      if (!this.linewise) {
        this.buffer.push("\n");
      }
      this.linewise = linewise;
    }
    this.buffer.push(text);
    navigator.clipboard.writeText(this.buffer.join(""));
  }

  clear(): void {
    this.buffer = [];
    this.linewise = false;
    this.blockwise = false;
  }

  toString() {
    return this.buffer.join("");
  }

  poke() {
    navigator.clipboard.readText().then((text) => {
      if (text.includes("\n")) {
        const lines = text.split("\n");
        const blockwise = lines.every(
          (line) => line.length === lines[0].length
        );
        this.setText(text, !blockwise && text.endsWith("\n"), blockwise);
      } else {
        this.setText(text);
      }
    });
  }
}

const DslEditor: React.FC<DslEditorProps> = (props) => {
  const timeoutHandle = React.useRef<ReturnType<typeof setTimeout>>(null);
  const hintTimeoutHandle = React.useRef<ReturnType<typeof setTimeout>>(null);
  const hintProvider = React.useRef(new HintProvider());
  const codeLenseProvider = React.useRef<CodeLensProvider>(null);
  const hoverProvider = React.useRef(null);
  const [canPaste, setCanPaste] = React.useState(true);
  const [currentVersion, setCurrentVersion] = React.useState(0);
  const [initialVersion, setInitialVersion] = React.useState(0);
  const [highVersion, setHighVersion] = React.useState(0);
  const monacoInstance =
    React.useRef<monaco.editor.IStandaloneCodeEditor>(null);
  const [statusBar, setStatusBar] = React.useState<IStatusBar>(null);
  const forcedColors = window.matchMedia("(forced-colors: active)").matches;
  const vimAdapter = React.useRef<CMAdapter>(null);

  React.useEffect(() => {
    if (monacoInstance.current) {
      monacoInstance.current.updateOptions({
        fontSize: (props.settings.fontSize * 96) / 72,
      });
    }
  }, [props.settings.fontSize]);

  const onEditorMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editor.updateOptions({
      fontSize: (props.settings.fontSize * 96) / 72,
      fontFamily: "Fira Code Variable",
      fontLigatures: true,
      lineNumbers: "relative",
      minimap: { enabled: false },
    });
    editor.focus();
    const model = editor.getModel();
    if (model) {
      const ver = model.getAlternativeVersionId();
      setInitialVersion(ver);
      setCurrentVersion(ver);
      setHighVersion(ver);
    }
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) {
        return;
      }
      const ver = model.getAlternativeVersionId();
      setCurrentVersion(ver);
      setHighVersion(Math.max(ver, highVersion));
    });

    hoverProvider.current = new HoverProvider(editor);
    window.monaco.languages.registerHoverProvider(
      kLanguageId,
      hoverProvider.current
    );
    window.monaco.languages.registerInlayHintsProvider(
      kLanguageId,
      hintProvider.current
    );
    codeLenseProvider.current = new CodeLensProvider(editor);
    window.monaco.languages.registerCodeLensProvider(
      kLanguageId,
      codeLenseProvider.current
    );
    monacoInstance.current = editor;
  };

  const onStatusBarMounted = (statusBar: IStatusBar) => {
    setStatusBar(statusBar);
  };

  React.useEffect(() => {
    const editor = monacoInstance.current;
    if (editor && statusBar) {
      statusBar.toggleVisibility(props.settings.vimMode);

      if (!vimAdapter.current) {
        if (props.settings.vimMode) {
          const adapter = initVimMode(editor, statusBar);
          adapter.attach();
          CMAdapter.commands["open"] = () =>
            openFilePicker()
              .then((text) => {
                editor.setValue(text);
              })
              .catch((err) => {})
              .finally(() => editor.focus());
          CMAdapter.commands["save"] = () =>
            saveFilePicker(editor.getValue())
              .catch((err) => {})
              .finally(() => editor.focus());

          vimAdapter.current = adapter;
          // Our DSL is scheme-like, so it makes sense to add the '-' character
          // to the iskeyword option, this makes w and * work with identifiers.
          // This is equivalent to :set iskeyword+=-
          vimApi.setOption("iskeyword", "-", adapter, { append: true });
          const clipboard = new ClipboardRegister();
          vimApi.defineRegister("*", clipboard);
          vimApi.defineRegister("+", clipboard);
          adapter.on("vim-set-clipboard-register", () => clipboard.poke());
        }
      } else if (props.settings.vimMode) {
        vimAdapter.current.attach();
      } else {
        vimAdapter.current.detach();
      }
    }
  }, [monacoInstance.current, statusBar, props.settings.vimMode]);

  React.useEffect(() => {
    if (codeLenseProvider.current) {
      codeLenseProvider.current.updateValueGetter(props.onCaptureUniforms);
    }
  }, [codeLenseProvider.current, props.onCaptureUniforms]);

  const parseCheck = () => {
    if (timeoutHandle.current) {
      timeoutHandle.current = null;
    }
    const editor = monacoInstance.current;
    if (!editor) {
      return;
    }
    const raw = editor.getValue().trim();
    if (raw === "") {
      return;
    }
    const model = editor.getModel();
    const severity = window.monaco.MarkerSeverity.Error;

    try {
      const exprs = read(raw);
      const env = new Env();
      addBuiltins(env);

      const markers: monaco.editor.IMarkerData[] = [];
      const evaluated = exprs
        .map((expr) => {
          const res = evaluate(expr, env);
          getErrors(res).forEach((error) => {
            const start = model.getPositionAt(error.offset);
            const end = model.getPositionAt(error.offset + error.length);
            markers.push({
              message: error.value as string,
              severity: severity,
              startLineNumber: start.lineNumber,
              endLineNumber: end.lineNumber,
              startColumn: start.column,
              endColumn: end.column,
            });
          });
          return res;
        })
        .filter((expr) => expr.type !== "null");
      if (markers.length === 0) {
        const ctx = makeContext({});
        evaluated.map((expr) => {
          try {
            generate(expr, env, ctx);
          } catch (err) {
            if (err instanceof DslGeneratorError) {
              const start = model.getPositionAt(err.offset);
              const end = model.getPositionAt(err.offset + err.length);
              markers.push({
                message: err.message,
                severity: severity,
                startLineNumber: start.lineNumber,
                endLineNumber: end.lineNumber,
                startColumn: start.column,
                endColumn: end.column,
              });
            }
          }
        });
      }
      window.monaco.editor.setModelMarkers(editor.getModel(), "owner", markers);
      if (markers.length === 0) {
        props.onGenerating(raw);
      }
    } catch (err) {
      if (err instanceof DslParseError) {
        const start = model.getPositionAt(err.offset);
        const end = model.getPositionAt(err.offset + err.length);
        window.monaco.editor.setModelMarkers(model, "owner", [
          {
            message: err.message,
            severity: severity,
            startLineNumber: start.lineNumber,
            endLineNumber: end.lineNumber,
            startColumn: start.column,
            endColumn: end.column,
          },
        ]);
      }
    }
  };

  const updateHints = () => {
    hintTimeoutHandle.current = null;
    const editor = monacoInstance.current;
    if (!editor || !hintProvider.current) {
      return;
    }
    const raw = editor.getValue().trim();
    if (raw === "") {
      hintProvider.current.updateParsed([]);
      return;
    }

    try {
      const env = new Env();
      addBuiltins(env);
      const parsed = read(raw);
      const evaled = parsed.map((el) => evaluate(el, env));
      hintProvider.current.updateParsed(evaled);
    } catch (err) {}
  };

  React.useEffect(() => {
    if (hintProvider.current) {
      hintProvider.current.updateUniforms(props.uniforms);
    }
  }, [props.uniforms]);

  React.useEffect(() => {
    if (timeoutHandle.current) {
      clearTimeout(timeoutHandle.current);
      timeoutHandle.current = null;
    }
    if (hintTimeoutHandle.current) {
      clearTimeout(hintTimeoutHandle.current);
      hintTimeoutHandle.current = null;
    }
    timeoutHandle.current = setTimeout(() => parseCheck(), 1000);
    hintTimeoutHandle.current = setTimeout(() => updateHints(), 250);
    return () => {
      if (timeoutHandle.current) {
        clearTimeout(timeoutHandle.current);
      }
      if (hintTimeoutHandle.current) {
        clearTimeout(hintTimeoutHandle.current);
      }
    };
  }, [currentVersion]);

  return (
    <ThemeContext.Consumer>
      {(theme) => (
        <EditorThemeContext.Consumer>
          {(maybeTheme) => {
            const editorTheme = maybeTheme || theme;
            const themeName = checkForForcedTheme(editorTheme.name);
            return (
              <div
                style={{
                  color: editorTheme.foreground,
                  background: editorTheme.background,
                  ...(props.style || {}),
                  border: `solid 1px ${editorTheme.base00}`,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    background: editorTheme.boldBackground,
                    padding: "0.25em",
                    gridTemplateColumns: "auto 1fr auto",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "1fr 3fr 1fr 3fr 3fr 3fr 1fr 3fr 3fr 1fr 3fr 3fr",
                      columnGap: "0.25em",
                      alignSelf: "center",
                    }}
                  >
                    <div />
                    <IconButton
                      title="Toggle Positions"
                      size={props.settings.fontSize * 2}
                      onClick={() => props.onTogglePositions()}
                    >
                      <Switch />
                    </IconButton>
                    <div />
                    <IconButton
                      size={props.settings.fontSize * 2}
                      title="Cut"
                      onClick={() => {
                        const editor = monacoInstance.current;
                        if (!editor) {
                          return;
                        }
                        editor.focus();
                        const selection = editor.getSelection();
                        if (!selection || selection.isEmpty()) {
                          navigator.clipboard.writeText("");
                          return;
                        }
                        const data = editor
                          .getModel()
                          ?.getValueInRange(selection);
                        navigator.clipboard.writeText(data || "");
                        editor.executeEdits("clipboard", [
                          {
                            range: selection,
                            text: "",
                            forceMoveMarkers: true,
                          },
                        ]);
                      }}
                    >
                      <Cut />
                    </IconButton>
                    <IconButton
                      size={props.settings.fontSize * 2}
                      title="Copy"
                      onClick={() => {
                        const editor = monacoInstance.current;
                        if (!editor) {
                          return;
                        }
                        editor.focus();
                        const selection = editor.getSelection();
                        if (!selection || selection.isEmpty()) {
                          navigator.clipboard.writeText("");
                          return;
                        }
                        const data = editor
                          .getModel()
                          ?.getValueInRange(selection);
                        navigator.clipboard.writeText(data || "");
                      }}
                    >
                      <Copy />
                    </IconButton>
                    <IconButton
                      size={props.settings.fontSize * 2}
                      title="Paste"
                      disabled={!canPaste}
                      onClick={() => {
                        const editor = monacoInstance.current;
                        if (!editor) {
                          return;
                        }
                        editor.focus();
                        navigator.clipboard.readText().then((v) => {
                          const selection = editor.getSelection();
                          if (!selection) {
                            return;
                          }
                          editor.executeEdits("clipboard", [
                            {
                              range: selection,
                              text: v,
                              forceMoveMarkers: true,
                            },
                          ]);
                        });
                      }}
                    >
                      <Paste />
                    </IconButton>
                    <div />
                    <IconButton
                      disabled={currentVersion <= initialVersion}
                      size={props.settings.fontSize * 2}
                      title="Undo"
                      onClick={() => {
                        const editor = monacoInstance.current;
                        if (!editor) {
                          return;
                        }
                        editor.trigger("toolbar", "undo", null);
                      }}
                    >
                      <Undo />
                    </IconButton>
                    <IconButton
                      disabled={currentVersion >= highVersion}
                      size={props.settings.fontSize * 2}
                      title="Redo"
                      onClick={() => {
                        const editor = monacoInstance.current;
                        if (!editor) {
                          return;
                        }
                        editor.trigger("toolbar", "redo", null);
                      }}
                    >
                      <Redo />
                    </IconButton>
                    <div />
                    <IconButton
                      size={props.settings.fontSize * 2}
                      title="Open"
                      onClick={() => {
                        const editor = monacoInstance.current;
                        if (!editor) {
                          return;
                        }
                        openFilePicker()
                          .then((text) => {
                            editor.focus();
                            editor.setValue(text);
                          })
                          .catch((err) => {
                            editor.focus();
                          });
                      }}
                    >
                      <Open />
                    </IconButton>
                    <IconButton
                      size={props.settings.fontSize * 2}
                      title="Save"
                      onClick={async () => {
                        const editor = monacoInstance.current;
                        if (!editor) {
                          return;
                        }

                        const content = editor.getValue();
                        saveFilePicker(content)
                          .catch((err) => {
                            console.error(err);
                          })
                          .finally(() => editor.focus());
                      }}
                    >
                      <Save />
                    </IconButton>
                  </div>
                  <div />
                  {forcedColors ? null : (
                    <SettingsEditor
                      {...props.settings}
                      onChange={(value) => props.onSettingsChange(value)}
                    />
                  )}
                </div>
                <Editor
                  style={{
                    height: "93vh",
                    maxWidth: "calc(95vw - 8rem)",
                  }}
                  theme={themeName}
                  defaultLanguage={kLanguageId}
                  defaultValue={props.line}
                  onMount={(mounted: monaco.editor.IStandaloneCodeEditor) =>
                    onEditorMount(mounted)
                  }
                />
                <StatusBar
                  onMount={(statusBar) => onStatusBarMounted(statusBar)}
                  focusEditor={() => monacoInstance.current.focus()}
                />
              </div>
            );
          }}
        </EditorThemeContext.Consumer>
      )}
    </ThemeContext.Consumer>
  );
};

interface StatusBarProps {
  onMount: (statusBar: IStatusBar) => void;
  focusEditor: () => void;
}

const StatusBar: React.FC<StatusBarProps> = (props) => {
  const [visible, setVisibility] = React.useState(false);
  const [modeText, setModeText] = React.useState("");
  const [notification, setNotification] = React.useState("");
  const [keyInfo, setKeyInfo] = React.useState("");
  const [secondary, setSecondary] =
    React.useState<StatusBarSecondaryProps>(null);

  const toggleVisibility = (visible: boolean) => setVisibility(visible);
  const showNotification = (message: string) => setNotification(message);
  const setMode = (ev: ModeChangeEvent) => {
    switch (ev.mode) {
      case "visual":
        switch (ev.subMode) {
          case "linewise":
            setModeText("--VISUAL LINE--");
            break;
          case "blockwise":
            setModeText("--VISUAL BLOCK--");
            break;
          default:
            setModeText("--VISUAL--");
        }
        break;
      case "normal":
        setModeText("");
        break;
      default:
        setModeText(`--${ev.mode.toUpperCase()}--`);
    }
  };
  const setKeyBuffer = (key: string) => {
    setKeyInfo(key);
  };
  const setSecStatic = (message: string) => {
    setSecondary({
      mode: "static",
      staticMessage: message,
      prefix: "",
      desc: "",
      options: {},
      close: closeInput,
    });
    return closeInput;
  };
  const setSecPrompt = (
    prefix: string,
    desc: string,
    options: SecInfoOptions
  ) => {
    setSecondary({
      mode: "input",
      staticMessage: "",
      prefix: prefix,
      desc: desc,
      options: options,
      close: closeInput,
    });
    return closeInput;
  };
  const closeInput = () => {
    setSecondary(null);
    props.focusEditor();
  };
  const clear = () => {};

  React.useEffect(() => {
    props.onMount({
      toggleVisibility: toggleVisibility,
      showNotification: showNotification,
      setMode: setMode,
      setKeyBuffer: setKeyBuffer,
      setSecStatic: setSecStatic,
      setSecPrompt: setSecPrompt,
      closeInput: closeInput,
      clear: clear,
    });
  }, []);

  React.useEffect(() => {
    if (notification !== "") {
      setTimeout(() => setNotification(""), 5000);
    }
  }, [notification]);

  return (
    <div
      style={{
        display: visible ? "grid" : "none",
        fontFamily: '"Fira Code Variable",  monospace',
        borderTop: "1px solid #888",
        padding: "0.1em",
        gap: "1em",
        minHeight: "1.15em",
        gridTemplateColumns: "auto 1fr auto auto",
      }}
    >
      <div style={{ textAlign: "center" }}>{modeText}</div>
      {secondary ? <StatusBarSecondary {...secondary} /> : <div />}
      <div>{notification}</div>
      <div>{keyInfo}</div>
    </div>
  );
};

interface StatusBarSecondaryProps {
  mode: "static" | "input";
  staticMessage: string;
  prefix: string;
  desc: string;
  options: SecInfoOptions;
  close: () => void;
}

const StatusBarSecondary: React.FC<StatusBarSecondaryProps> = (props) => {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (inputRef.current) {
      if (props.options.selectValueOnOpen) {
        inputRef.current.select();
      }
      inputRef.current.focus();
    }
  }, [inputRef.current]);

  return props.mode == "static" ? (
    <div>{props.staticMessage}</div>
  ) : (
    <div
      style={{
        display: "grid",
        gap: "0.5em",
        fontFamily: '"Fira Code Variable",  monospace',
        gridTemplateColumns: "auto 1fr auto",
      }}
    >
      <div>{props.prefix}</div>
      <input
        style={{
          border: "none",
          background: "none",
          outline: "none",
          marginLeft: "-0.5em",
          paddingLeft: 0,
        }}
        ref={inputRef}
        type="text"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        onKeyUp={(evt) => {
          if (props.options.onKeyUp) {
            props.options.onKeyUp(
              evt.nativeEvent,
              inputRef.current.value,
              props.close
            );
          }
        }}
        onBlur={() => {
          if (props.options.closeOnBlur) {
            props.close();
          }
        }}
        onKeyDown={(evt) => {
          if (props.options.onKeyDown) {
            if (
              props.options.onKeyDown(
                evt.nativeEvent,
                inputRef.current.value,
                props.close
              )
            ) {
              return;
            }
          }

          if (
            evt.key === "Escape" ||
            (props.options.closeOnEnter !== false && evt.key === "Enter")
          ) {
            inputRef.current.blur();
            evt.stopPropagation();
            props.close();
          }

          if (evt.key === "Enter" && props.options.onClose) {
            evt.stopPropagation();
            evt.preventDefault();
            props.options.onClose(inputRef.current.value);
          }
        }}
      />
      <div style={{ color: "#888" }}>{props.desc}</div>
    </div>
  );
};

export default DslEditor;
