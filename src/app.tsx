import React from "react";
import { WebGPUCanvas } from "./components/web-gpu-canvas";
import shader from "./shader.wgsl";
import { kSolarizedDark } from "./monaco/solarized";
import { ThemeProvider, kDefinedThemes } from "./components/theme-provider";
import { updateStyleSheet } from "./components/style-sheet";
import {
  Uniform,
  UniformEditor,
  UniformRgbColor,
  getDefaultUniform,
  isUniform,
  kDefaultUniform,
} from "./components/uniform";
import { isVectorName, Vector } from "./dsl";
import monacoTypes from "monaco-editor";
import { loadSettings } from "./components/persisted-settings";
import { ErrorBoundary } from "./components/error-boundary";
import {
  Documentation,
  getInitialTopic,
  isHistoryState,
} from "./components/documentation";
import {
  extractViewParameters,
  generateShader,
  isGenerationError,
  isGenerationSuccess,
  makeShader,
  readDefaultUniformValues,
} from "./make-wgsl";
import { kLanguageId } from "./monaco/language";

declare global {
  interface Window {
    monaco: typeof monacoTypes;
    getMonaco: () => Promise<void>;
  }
}

const DslEditor = React.lazy(async () => {
  await window.getMonaco();
  return import("./components/dsl-editor");
});

export const App: React.FC = () => {
  const editorRef =
    React.useRef<monacoTypes.editor.IStandaloneCodeEditor>(null);
  const dirtyRef = React.useRef(false);
  const [settings, setSettings] = React.useState(loadSettings());
  const width = Math.round(window.visualViewport.width / 2);
  const height = Math.round((width * 9) / 16);
  const [generated, setGenerated] = React.useState("");
  const [errors, setErrors] = React.useState("");
  const [uniforms, setUniforms] = React.useState<string[]>([]);
  const [offsets, setOffsets] = React.useState<number[]>([]);
  const [values, setValues] = React.useState<Map<string, Uniform>>(new Map());
  const [editorTop, setEditorTop] = React.useState(true);
  const [docs, setDocs] = React.useState(location.hash.length > 0);
  const [topic, setTopic] = React.useState(getInitialTopic());
  const [view, setView] = React.useState<Vector>({ x: 15, y: 0, z: 0 });

  const currTheme = kDefinedThemes.get(settings.themeName) || kSolarizedDark;
  const forcedColors = window.matchMedia("(forced-colors: active)").matches;

  if (!forcedColors) {
    updateStyleSheet(currTheme);
  }

  const setUniformValue = (name: string, value: Uniform) => {
    const updated = new Map(values.entries());
    updated.set(name, value);
    setValues(updated);
  };

  const setUniformValues = (update: Record<string, Uniform>) => {
    const updated = new Map(values.entries());
    for (const name of Object.keys(update)) {
      const v = update[name];
      if (isUniform(v)) {
        updated.set(name, v);
      }
    }
    setValues(updated);
  };

  const generateWgsl = (raw: string) => {
    const defaultValues = readDefaultUniformValues(raw, values);
    // filter out view parameters
    const viewChange = extractViewParameters(defaultValues);
    if (viewChange) {
      setView({ ...view, ...viewChange });
    }
    setValues(defaultValues);
    const res = generateShader(raw);
    if (isGenerationSuccess(res)) {
      setUniforms(res.uniformNames);
      setOffsets(res.uniformOffsets);
      setGenerated(res.generated);
      setErrors("");
      setDocs(false);
    } else if (isGenerationError(res)) {
      setGenerated("");
      setErrors(res.errors);
    }
  };

  const captureUniforms = () =>
    uniforms
      .filter((name) => values.has(name))
      .map((name) => {
        const value = values.get(name);
        return `  ${name} = ${value.value} [${value.min}:${value.max}:${value.step}]`;
      });

  const addFragment = (fragment: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }
    model.applyEdits([
      {
        range: editor.getSelection(),
        text: fragment,
        forceMoveMarkers: true,
      },
    ]);

    setDocs(false);
  };

  const colorize = (fragment: string) => {
    if (!window.monaco) {
      return Promise.resolve(fragment);
    }
    return window.monaco.editor.colorize(fragment, kLanguageId, {});
  };

  React.useEffect(() => {
    const listener = (evt: PopStateEvent) => {
      if (isHistoryState(evt.state)) {
        setDocs(true);
        setTopic(evt.state.topic);
      } else {
        setDocs(false);
      }
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, ["once"]);

  React.useEffect(() => {
    const listener = (evt: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        evt.preventDefault();
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, ["once"]);

  return (
    <ThemeProvider value={currTheme}>
      <div
        style={{
          backgroundColor: currTheme.background,
          color: currTheme.foreground,
          fontSize: `${settings.fontSize}pt`,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: "1em",
            gridTemplateColumns: "calc(50vw - 1.5em) calc(50vw - 1.5em)",
            gridTemplateRows: "auto 1fr",
          }}
        >
          <WebGPUCanvas
            style={{
              width: `calc(48vw - 4em)`,
              height: `calc(9 * (48vw - 4em) / 16)`,
              gridArea: "1/1/2/2",
              border: `solid 1px ${currTheme.base00}`,
            }}
            width={width}
            height={height}
            view={view}
            shader={makeShader(
              shader,
              generated,
              offsets.length == 0
                ? 0
                : offsets.reduce((a, e) => Math.max(a, e)) + 4
            )}
            vertexShader="vertex_main"
            fragmentShader="frag_main"
            uniformValues={uniforms
              .map((el) => values.get(el) || kDefaultUniform)
              .map((el) => el.value)}
            uniformOffsets={offsets}
            onShaderError={(shaderError) => setErrors(shaderError)}
            onViewChange={(u) => setView(u)}
          />
          <div
            style={{
              gridArea: "1/1/2/2",
              pointerEvents: "none",
              fontSize: "2em",
              margin: "1rem",
              opacity: 0.8,
              fontWeight: "bolder",
              color: currTheme.base00,
            }}
          >
            SDF Tool
          </div>
          <ErrorBoundary
            style={{
              gridArea: editorTop ? "1/2/3/3" : "2/1/3/2",
              height: "fit-content",
            }}
          >
            <React.Suspense
              fallback={
                <div
                  style={{
                    gridArea: editorTop ? "1/2/3/3" : "2/1/3/2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "fit-content",
                    gap: "1em",
                  }}
                >
                  <div>Loading Editor</div>
                  <div className="loader" style={{ fontSize: "150%" }} />
                </div>
              }
            >
              <DslEditor
                editorRef={editorRef}
                dirtyRef={dirtyRef}
                style={{ gridArea: editorTop ? "1/2/3/3" : "2/1/3/2" }}
                line=""
                uniforms={values}
                settings={settings}
                onGenerating={(s: string) => generateWgsl(s)}
                onTogglePositions={() => setEditorTop(!editorTop)}
                onCaptureUniforms={() => captureUniforms()}
                onSettingsChange={(v) => setSettings(v)}
                onShowDocs={() => setDocs(!docs)}
              />
            </React.Suspense>
          </ErrorBoundary>
          <div
            style={{
              gridArea: editorTop ? "2/1/3/2" : "1/2/3/3",
              overflowY: "auto",
              display: docs ? "none" : undefined,
            }}
          >
            {uniforms.length == 0 ? null : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5em 2em",
                  padding: "0.5em 0",
                  alignItems: "center",
                }}
              >
                {uniforms
                  .filter((el) => isVectorName(el))
                  .reduce((accum, el) => {
                    if (accum.length == 0) {
                      return [[el]];
                    }
                    const last = accum[accum.length - 1];
                    const prefix = last[0].substring(0, last[0].length - 2);
                    if (el.startsWith(prefix)) {
                      last.push(el);
                    } else {
                      accum.push([el]);
                    }
                    return accum;
                  }, [] as string[][])
                  .map((els) => {
                    if (els.length === 3 && els[0].startsWith("rgb-")) {
                      return (
                        <UniformRgbColor
                          key={els.join("-")}
                          names={els}
                          values={els.map(
                            (el) => values.get(el) || getDefaultUniform(el)
                          )}
                          onChange={(update) => setUniformValues(update)}
                        />
                      );
                    }
                    return (
                      <div
                        key={els.join("-")}
                        style={{
                          borderLeft: `solid 1px ${currTheme.base00}`,
                          borderRadius: "0.5em",
                          paddingLeft: "0.5em",
                          flexGrow: 1,
                        }}
                      >
                        {" "}
                        {els.map((el) => (
                          <UniformEditor
                            key={el}
                            name={el}
                            grouped
                            {...(values.get(el) || getDefaultUniform(el))}
                            onChange={(v) => setUniformValue(el, v)}
                          />
                        ))}
                      </div>
                    );
                  })}
                {uniforms
                  .filter((el) => !isVectorName(el))
                  .map((el) => {
                    return (
                      <UniformEditor
                        key={el}
                        name={el}
                        {...(values.get(el) || getDefaultUniform(el))}
                        onChange={(v) => setUniformValue(el, v)}
                      />
                    );
                  })}
              </div>
            )}
            <code
              style={{
                fontFamily: '"Fira Code Variable", monospace',
                fontVariantLigatures: "discretionary-ligatures",
              }}
            >
              <pre style={{ whiteSpace: "pre-wrap" }}>{generated}</pre>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  color: currTheme.red,
                }}
              >
                {errors}
              </pre>
            </code>
          </div>
          <Documentation
            style={{
              gridArea: editorTop ? "1/1/3/2" : "1/2/3/4",
              background: currTheme.boldBackground,
              zIndex: 200,
              maxHeight: "98vh",
              color: currTheme.boldForeground,
              display: docs ? null : "none",
            }}
            topic={topic}
            onSetTopic={(t) => setTopic(t)}
            onClose={() => {
              setDocs(false);
              history.replaceState({}, "", location.pathname);
            }}
            onAddToEditor={(frag) => addFragment(frag)}
            colorize={(frag) => colorize(frag)}
          />
        </div>
      </div>
    </ThemeProvider>
  );
};
