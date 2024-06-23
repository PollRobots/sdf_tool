import React from "react";
import { WebGPUCanvas } from "./web-gpu-canvas";
import shader from "./shader.wgsl";
import { kSolarizedDark, kSolarizedLight } from "./monaco/solarized";
import { EditorThemeProvider } from "./theme-provider";
import { Theme } from "./monaco/theme";

const DslEditor = React.lazy(async () => {
  await ((window as any).getMonaco as () => Promise<void>)();
  return import("./dsl-editor");
});

const kEditorThemes = new Map([
  ["dark", kSolarizedDark],
  ["light", kSolarizedLight],
]);

const getBrowserColorScheme = () =>
  window.matchMedia("(prefers-color-scheme: dark").matches ? "dark" : "light";

const createStyleSheet = (): CSSStyleSheet => {
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [sheet];
  return sheet;
};

const updateStyleSheet = (sheet: CSSStyleSheet, theme: Theme) => {
  const styles: string[] = [];
  styles.push(`
    body {
        background-color: ${theme.background};
        color: ${theme.foreground};
    }
    `);
  styles.push(`
        select {
            background-color: ${theme.background};
            color: ${theme.foreground};
            border-color: ${theme.base00};
        }
        `);
  styles.push(`
    button {
        background-color: ${theme.background};
        color: ${theme.foreground};
        border: 1px solid ${theme.base00};
        cursor: pointer;
        padding: 4px 1em 4px 1em;
        border-radius: 0.25em;
    }
    button:active {
        background-color: ${theme.boldBackground};
    }
    button:active:hover {
        padding: 5px 1em 3px 1em;
        box-shadow: 0 1px 2px inset ${theme.foreground};
    }
    button:disabled {
        cursor: default;
        background-color: ${theme.background};
        opacity: 0.7;
    }
`);
  styles.push(`
    input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        cursor: pointer;
    }
    input.vertical[type="range"] {
        writing-mode: vertical-rl;
        direction: rtl;
    }
    input[type="range"]:focus {
        outline: none;
    }
    input[type="range"]::-webkit-slider-runnable-track {
        background: ${theme.base00};
        height: 0.25rem;
        border-radius: 0.125rem;
    }
    input.vertical[type="range"]::-webkit-slider-runnable-track {
        height: unset;
        width: 0.25rem;
    }
    input[type="range"]::-moz-range-track {
        background: ${theme.base00};
        height: 0.375rem;
        width: 0.375rem;
        border-radius: 0.125rem;
    }
    input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        background-color: ${theme.blue};
        border-radius: 0.375rem;
        border: 1px solid ${theme.base00};
        height: 0.75rem;
        width: 0.75rem;
        margin-top: calc((0.375rem - (0.75rem + 2px))/2);
    }
    input.vertical[type="range"]::-webkit-slider-thumb {
        margin-right: calc((0.375rem - (0.75rem + 2px))/2);
    }
    input[type="range"]:focus::-webkit-slider-thumb {
        outline: 2px solid ${theme.boldForeground};
        outline-offset: 0.125rem;
    }
`);
  sheet
    .replace(styles.join("\n"))
    .then((sheet) => {
      document.adoptedStyleSheets = [sheet];
    })
    .catch((err) => {
      console.error(`Error replacing stylesheet: ${err}`);
    });
};

export const App: React.FC = () => {
  const [theme, setTheme] = React.useState(getBrowserColorScheme());
  const styleSheet = React.useRef(createStyleSheet());
  const width = Math.round(window.visualViewport.width / 2);
  const height = Math.round((width * 9) / 16);
  const [generated, setGenerated] = React.useState("");

  const currTheme = kEditorThemes.get(theme) || kSolarizedDark;

  if (styleSheet.current) {
    updateStyleSheet(styleSheet.current, currTheme);
  }

  return (
    <div
      style={{
        backgroundColor: currTheme.background,
        color: currTheme.foreground,
      }}
    >
      <h1 style={{ color: currTheme.boldForeground }}>SDF Tool</h1>
      Theme:
      <select value={theme} onChange={(e) => setTheme(e.target.value)}>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
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
          <EditorThemeProvider value={currTheme}>
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
