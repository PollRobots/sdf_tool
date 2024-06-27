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
import { kLanguageId } from "./monaco/language";
import { openFilePicker, saveFilePicker } from "./util";
import { Editor } from "./editor";
import { DslParseError, read } from "./read";
import { evaluate } from "./evaluate";
import { Env } from "./env";
import { addBuiltins } from "./builtins";
import { DslGeneratorError, Expression } from "./dsl";
import { generate, makeContext } from "./generate";
import { Uniform } from "./uniform";
import { HintProvider } from "./hint-provider";
import { HoverProvider } from "./hover-provider";

interface DslEditorProps {
  fontSize: number;
  line: string;
  style?: React.CSSProperties;
  uniforms: Map<string, Uniform>;
  onGenerating: (line: string) => void;
  onTogglePositions: () => void;
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

const DslEditor: React.FC<DslEditorProps> = (props) => {
  const timeoutHandle = React.useRef<ReturnType<typeof setTimeout>>(null);
  const hintTimeoutHandle = React.useRef<ReturnType<typeof setTimeout>>(null);
  const hintProvider = React.useRef(new HintProvider());
  const hoverProvider = React.useRef(null);
  const [canPaste, setCanPaste] = React.useState(true);
  const [currentVersion, setCurrentVersion] = React.useState(0);
  const [initialVersion, setInitialVersion] = React.useState(0);
  const [highVersion, setHighVersion] = React.useState(0);
  const [editor, setEditor] =
    React.useState<monaco.editor.IStandaloneCodeEditor>(null);

  React.useEffect(() => {
    if (editor) {
      editor.updateOptions({
        fontSize: props.fontSize,
      });
    }
  }, [props.fontSize]);

  const onEditorMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editor.updateOptions({
      fontSize: props.fontSize,
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
    const m = (window as any).monaco as typeof monaco;

    hoverProvider.current = new HoverProvider(editor);
    m.languages.registerHoverProvider(kLanguageId, hoverProvider.current);
    m.languages.registerInlayHintsProvider(kLanguageId, hintProvider.current);
    setEditor(editor);
  };

  const parseCheck = () => {
    if (timeoutHandle.current) {
      timeoutHandle.current = null;
    }

    if (!editor) {
      return;
    }
    const raw = editor.getValue().trim();
    if (raw === "") {
      return;
    }
    const setModelMarkers: typeof monaco.editor.setModelMarkers = (
      window as any
    ).monaco.editor.setModelMarkers;
    const ErrorSeverity: typeof monaco.MarkerSeverity.Error = (window as any)
      .monaco.MarkerSeverity.Error;
    const model = editor.getModel();

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
              severity: ErrorSeverity,
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
                severity: ErrorSeverity,
                startLineNumber: start.lineNumber,
                endLineNumber: end.lineNumber,
                startColumn: start.column,
                endColumn: end.column,
              });
            }
          }
        });
      }
      setModelMarkers(editor.getModel(), "owner", markers);
      if (markers.length === 0) {
        props.onGenerating(raw);
      }
    } catch (err) {
      if (err instanceof DslParseError) {
        const start = model.getPositionAt(err.offset);
        const end = model.getPositionAt(err.offset + err.length);
        setModelMarkers(model, "owner", [
          {
            message: err.message,
            severity: ErrorSeverity,
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
                      size={props.fontSize * 2}
                      onClick={() => props.onTogglePositions()}
                    >
                      <Switch />
                    </IconButton>
                    <div />
                    <IconButton
                      size={props.fontSize * 2}
                      title="Cut"
                      onClick={() => {
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
                      size={props.fontSize * 2}
                      title="Copy"
                      onClick={() => {
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
                      size={props.fontSize * 2}
                      title="Paste"
                      disabled={!canPaste}
                      onClick={() => {
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
                      size={props.fontSize * 2}
                      title="Undo"
                      onClick={() => {
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
                      size={props.fontSize * 2}
                      title="Redo"
                      onClick={() => {
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
                      size={props.fontSize * 2}
                      title="Open"
                      onClick={() => {
                        if (!editor) {
                          return;
                        }
                        openFilePicker()
                          .then((text) => {
                            editor.focus();
                            const selection = editor.getSelection();
                            if (!selection) {
                              editor.setValue(text);
                              return;
                            } else {
                              editor.executeEdits("file-open", [
                                {
                                  range: selection,
                                  text: text,
                                  forceMoveMarkers: true,
                                },
                              ]);
                            }
                          })
                          .catch((err) => {
                            console.error(err);
                            editor.focus();
                          });
                      }}
                    >
                      <Open />
                    </IconButton>
                    <IconButton
                      size={props.fontSize * 2}
                      title="Save"
                      onClick={async () => {
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
                </div>
                <Editor
                  style={{
                    height: "90vh",
                    maxWidth: "calc(95vw - 8rem)",
                  }}
                  theme={themeName}
                  defaultLanguage={kLanguageId}
                  defaultValue={props.line}
                  onMount={(mounted: monaco.editor.IStandaloneCodeEditor) =>
                    onEditorMount(mounted)
                  }
                />
              </div>
            );
          }}
        </EditorThemeContext.Consumer>
      )}
    </ThemeContext.Consumer>
  );
};

export default DslEditor;
