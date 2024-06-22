import React from "react";
import monaco from "monaco-editor";

import { IconButton } from "./icon-button";
import { EditorThemeContext, ThemeContext } from "./theme-provider";
import { Cut, Copy, Paste, Undo, Redo, Open, Save } from "./icons/icons";
import { kLanguageId } from "./monaco/language";
import { openFilePicker, saveFilePicker } from "./util";
import { Editor } from "./editor";
import { time } from "console";
import { read } from "./read";
import { print } from "./print";
import { evaluate } from "./evaluate";
import { Env } from "./env";
import { addBuiltins } from "./builtins";

interface DslEditorProps {
  fontSize: number;
  line: string;
  onDoneEditing: (line: string) => void;
}

const DslEditor: React.FC<DslEditorProps> = (props) => {
  const timeoutHandle = React.useRef<ReturnType<typeof setTimeout>>(null);
  const [canPaste, setCanPaste] = React.useState(true);
  const [currentVersion, setCurrentVersion] = React.useState(0);
  const [initialVersion, setInitialVersion] = React.useState(0);
  const [highVersion, setHighVersion] = React.useState(0);
  const [editor, setEditor] =
    React.useState<monaco.editor.IStandaloneCodeEditor>(null);

  const onEditorMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    // editor.updateOptions({ minimap: { enabled: false } });
    const KeyMod: typeof monaco.KeyMod = (window as any).monaco.KeyMod;
    const KeyCode: typeof monaco.KeyCode = (window as any).monaco.KeyCode;
    editor.addAction({
      id: "end-editing-scheme",
      label: "End Editing",
      keybindings: [
        KeyMod.CtrlCmd | KeyCode.KeyE,
        KeyMod.chord(
          KeyMod.CtrlCmd | KeyCode.KeyK,
          KeyMod.CtrlCmd | KeyCode.KeyD
        ),
      ],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.5,
      run: (ed: monaco.editor.IStandaloneCodeEditor) => {
        props.onDoneEditing(ed.getValue());
      },
    });
    editor.updateOptions({ fontSize: props.fontSize });
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
    setEditor(editor);
  };

  const parseCheck = () => {
    if (timeoutHandle.current) {
      timeoutHandle.current = null;
    }

    if (!editor) {
      return;
    }
    const raw = editor.getValue();
    if (raw.trim() === "") {
      return;
    }
    try {
      const parsed = read(raw);
      console.log("Parsed: ", parsed);
      const env = new Env();
      addBuiltins(env);
      const res = parsed
        .map((expr) => evaluate(expr, env))
        .filter((expr) => expr.type !== "null")
        .map((expr) => print(expr));
      console.log("Evaluated:", res);
    } catch (err) {
      console.error("Error parsing: ", err);
    }
  };

  React.useEffect(() => {
    if (timeoutHandle.current) {
      clearTimeout(timeoutHandle.current);
      timeoutHandle.current = null;
    }
    timeoutHandle.current = setTimeout(() => parseCheck(), 1000);
    return () => {
      if (timeoutHandle.current) {
        clearTimeout(timeoutHandle.current);
      }
    };
  }, [currentVersion]);

  return (
    <ThemeContext.Consumer>
      {(theme) => (
        <EditorThemeContext.Consumer>
          {(maybeTheme) => {
            const editorTheme = maybeTheme || theme;
            return (
              <div
                style={{
                  color: editorTheme.foreground,
                  background: editorTheme.background,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    background: editorTheme.boldBackground,
                    padding: "0.25em",
                    gridTemplateColumns: "auto auto 1fr auto",
                  }}
                >
                  <span
                    style={{
                      margin: "auto 1em",
                      fontWeight: 500,
                    }}
                  >
                    Edit sdf script
                  </span>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "3fr 3fr 3fr 1fr 3fr 3fr 1fr 3fr 3fr",
                      columnGap: "0.25em",
                      alignSelf: "center",
                    }}
                  >
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
                  <button
                    style={{
                      fontSize: "inherit",
                      minWidth: "6em",
                      minHeight: "2em",
                      margin: "0.25em",
                      background: editorTheme.blue,
                      border: `1px solid ${theme.base00}`,
                      borderRadius: "0.25em",
                      color: editorTheme.foreground,
                    }}
                    title={
                      "Finish editing\nShortcuts:\n  · Ctrl+K Ctrl+D\n  · Ctrl+E"
                    }
                    onClick={() =>
                      props.onDoneEditing(
                        editor ? editor.getValue() : props.line
                      )
                    }
                  >
                    Run
                  </button>
                </div>
                <Editor
                  style={{
                    height: "90vh",
                    minWidth: "50vw",
                    maxWidth: "calc(95vw - 8rem)",
                  }}
                  theme={editorTheme.name}
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
