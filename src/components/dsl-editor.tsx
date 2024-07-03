import React from "react";
import monaco from "monaco-editor";

import { IconButton } from "./icon-button";
import { ThemeContext, kDefinedThemes } from "./theme-provider";
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
import { IStatusBar, IRegister, VimMode } from "vim-monaco";
import { StatusBar } from "./status-bar";

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
  const lastFileName = React.useRef("");
  const [currentVersion, setCurrentVersion] = React.useState(0);
  const [initialVersion, setInitialVersion] = React.useState(0);
  const [highVersion, setHighVersion] = React.useState(0);
  const monacoInstance =
    React.useRef<monaco.editor.IStandaloneCodeEditor>(null);
  const [statusBar, setStatusBar] = React.useState<IStatusBar>(null);
  const forcedColors = window.matchMedia("(forced-colors: active)").matches;
  const vimAdapter = React.useRef<VimMode>(null);

  React.useEffect(() => {
    if (monacoInstance.current) {
      monacoInstance.current.updateOptions({
        fontSize: (props.settings.fontSize * 96) / 72,
      });
    }
  }, [props.settings.fontSize]);

  React.useEffect(() => {
    if (vimAdapter.current && vimAdapter.current.attached) {
      vimAdapter.current.setOption(
        "theme",
        kDefinedThemes.get(props.settings.themeName).name,
        {
          adapterOption: true,
        }
      );
    }
  }, [props.settings.themeName]);

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

  const saveFile = (filename?: string) => {
    const editor = monacoInstance.current;
    if (!editor) {
      return;
    }
    filename = filename || lastFileName.current;

    saveFilePicker(editor.getValue(), filename)
      .then((filename) => {
        lastFileName.current = filename;
      })
      .catch((err) => {})
      .finally(() => editor.focus());
  };
  const openFile = () => {
    const editor = monacoInstance.current;
    if (!editor) {
      return;
    }
    openFilePicker()
      .then((file) => {
        lastFileName.current = file.name;
        return file.text();
      })
      .then((text) => editor.setValue(text))
      .catch((err) => {})
      .finally(() => editor.focus());
  };

  React.useEffect(() => {
    const editor = monacoInstance.current;
    if (editor && statusBar) {
      statusBar.toggleVisibility(props.settings.vimMode);

      if (!vimAdapter.current) {
        if (props.settings.vimMode) {
          const vimMode = new VimMode(editor, statusBar);
          vimMode.enable();
          vimMode.addEventListener("open-file", () => openFile());
          vimMode.addEventListener("save-file", (evt) =>
            saveFile(evt.filename)
          );

          // Our DSL is scheme-like, so it makes sense to add the '-' character
          // to the iskeyword option, this makes w and * work with identifiers.
          vimMode.executeCommand("set iskeyword+=-");
          const clipboard = new ClipboardRegister();
          vimMode.setClipboardRegister(clipboard);
          vimMode.addEventListener("clipboard", () => clipboard.poke());

          vimAdapter.current = vimMode;
        }
      } else if (props.settings.vimMode) {
        vimAdapter.current.enable();
        vimAdapter.current.setOption(
          "theme",
          kDefinedThemes.get(props.settings.themeName).name,
          {
            adapterOption: true,
          }
        );
      } else {
        vimAdapter.current.disable();
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
      {(theme) => {
        const themeName = checkForForcedTheme(theme.name);
        return (
          <div
            style={{
              color: theme.foreground,
              background: theme.background,
              ...(props.style || {}),
              border: `solid 1px ${theme.base00}`,
            }}
          >
            <div
              style={{
                display: "grid",
                background: theme.boldBackground,
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
                    const data = editor.getModel()?.getValueInRange(selection);
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
                    const data = editor.getModel()?.getValueInRange(selection);
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
                  onClick={() => openFile()}
                >
                  <Open />
                </IconButton>
                <IconButton
                  size={props.settings.fontSize * 2}
                  title="Save"
                  onClick={() => saveFile("")}
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
              filename={lastFileName.current}
              onMount={(statusBar) => onStatusBarMounted(statusBar)}
              focusEditor={() => monacoInstance.current.focus()}
            />
          </div>
        );
      }}
    </ThemeContext.Consumer>
  );
};

export default DslEditor;
