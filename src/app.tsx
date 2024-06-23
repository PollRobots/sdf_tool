import React from "react";
import { WebGPUCanvas } from "./web-gpu-canvas";
import shader from "./shader.wgsl";
import { kSolarizedDark, kSolarizedLight } from "./monaco/solarized";
import { EditorThemeProvider } from "./theme-provider";
import {
  kSolarizedContrastDark,
  kSolarizedContrastLight,
} from "./monaco/solarized-contrast";
import { kTerminalDark, kTerminalLight } from "./monaco/terminal";
import { updateStyleSheet } from "./style-sheet";

const DslEditor = React.lazy(async () => {
  await ((window as any).getMonaco as () => Promise<void>)();
  return import("./dsl-editor");
});

const kEditorThemes = new Map([
  ["dark", kSolarizedDark],
  ["light", kSolarizedLight],
  ["term-dark", kTerminalDark],
  ["term-light", kTerminalLight],
  ["hico-dark", kSolarizedContrastDark],
  ["hico-light", kSolarizedContrastLight],
]);

const kThemeNames = new Map([
  ["dark", "Solarized Dark"],
  ["light", "Solarized Light"],
  ["term-dark", "Basic Dark"],
  ["term-light", "Basic Light"],
  ["hico-dark", " Contrast Dark"],
  ["hico-light", "Contrast Light"],
]);

const getBrowserColorScheme = () =>
  window.matchMedia("(prefers-color-scheme: dark").matches ? "dark" : "light";

export const App: React.FC = () => {
  const [theme, setTheme] = React.useState(getBrowserColorScheme());
  const width = Math.round(window.visualViewport.width / 2);
  const height = Math.round((width * 9) / 16);
  const [generated, setGenerated] = React.useState("");

  const currTheme = kEditorThemes.get(theme) || kSolarizedDark;
  const forcedColors = window.matchMedia("(forced-colors: active)").matches;

  if (!forcedColors) {
    updateStyleSheet(currTheme);
  }

  return (
    <div
      style={{
        backgroundColor: currTheme.background,
        color: currTheme.foreground,
      }}
    >
      <h1 style={{ color: currTheme.boldForeground }}>SDF Tool</h1>
      {forcedColors ? null : (
        <>
          Theme:
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            {Array.from(kThemeNames.entries()).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </>
      )}
      <div
        style={{
          display: "grid",
          gap: "1em",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "auto 1fr",
        }}
      >
        <WebGPUCanvas
          style={{
            width: `45vw`,
            height: `${Math.round((50 * 9) / 16)}vw`,
            gridArea: "1/1/2/2",
          }}
          width={width}
          height={height}
          shader={shader}
          vertexShader="vertex_main"
          fragmentShader="frag_main"
        />
        <React.Suspense fallback={"loading..."}>
          <EditorThemeProvider value={forcedColors ? false : currTheme}>
            <DslEditor
              style={{ gridArea: "1/2/3/3" }}
              fontSize={16}
              line=""
              onGenerating={(s: string) => {
                setGenerated(s);
              }}
              onDoneEditing={(s: string) => console.log(s)}
            />
          </EditorThemeProvider>
        </React.Suspense>
        <div style={{ gridArea: "2/1/3/2", overflowY: "auto" }}>
          <code>
            <pre style={{ whiteSpace: "pre-wrap" }}>{generated}</pre>
          </code>
        </div>
      </div>
    </div>
  );
};
