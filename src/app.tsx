import React from "react";
import { WebGPUCanvas } from "./web-gpu-canvas";
import shader from "./shader.wgsl";
import { kSolarizedDark, kSolarizedLight } from "./monaco/solarized";
import { EditorThemeProvider } from "./theme-provider";

const DslEditor = React.lazy(async () => {
  await ((window as any).getMonaco as () => Promise<void>)();
  return import("./dsl-editor");
});

const kEditorThemes = new Map([
  ["dark", kSolarizedDark],
  ["light", kSolarizedLight],
]);

export const App: React.FC = () => {
  const [theme, setTheme] = React.useState("dark");
  const width = Math.round(window.visualViewport.width / 2);
  const height = Math.round((width * 9) / 16);
  return (
    <div>
      <h1>SDF Tool</h1>
      Theme:
      <select value={theme} onChange={(e) => setTheme(e.target.value)}>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1em" }}>
        <WebGPUCanvas
          style={{ width: `45vw`, height: `${Math.round((50 * 9) / 16)}vw` }}
          width={width}
          height={height}
          shader={shader}
          vertexShader="vertex_main"
          fragmentShader="frag_main"
        />
        <React.Suspense fallback={"loading..."}>
          <EditorThemeProvider
            value={kEditorThemes.get(theme) || kSolarizedDark}
          >
            <DslEditor
              fontSize={16}
              line=""
              onDoneEditing={(s: string) => console.log(s)}
            />
          </EditorThemeProvider>
        </React.Suspense>
      </div>
    </div>
  );
};
