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
import { read } from "./read";
import { print } from "./print";
import { Env } from "./env";
import { addBuiltins } from "./builtins";
import { evaluate } from "./evaluate";
import { generate, indent, makeContext } from "./generate";
import { getShapeFn } from "./shapes";
import wgslTemplate from "./sdf/map.wgsl";
import {
  Uniform,
  UniformEditor,
  getDefaultUniform,
  kDefaultUniform,
} from "./uniform";
import wgslPlaceholder from "./sdf/placeholder.wgsl";

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

const makeShader = (template: string, generated: string, valueCount: number) =>
  template
    .replace(
      "//UNIFORM-VALUES//",
      valueCount == 0
        ? ""
        : `values: array<vec4<f32>, ${((valueCount + 15) & ~0xf) / 4}>,`
    )
    .replace("//MAP-FUNCTION//", generated || wgslPlaceholder);

export const App: React.FC = () => {
  const [theme, setTheme] = React.useState(getBrowserColorScheme());
  const width = Math.round(window.visualViewport.width / 2);
  const height = Math.round((width * 9) / 16);
  const [generated, setGenerated] = React.useState("");
  const [errors, setErrors] = React.useState("");
  const [uniforms, setUniforms] = React.useState<string[]>([]);
  const [values, setValues] = React.useState<Map<string, Uniform>>(new Map());

  const currTheme = kEditorThemes.get(theme) || kSolarizedDark;
  const forcedColors = window.matchMedia("(forced-colors: active)").matches;

  if (!forcedColors) {
    updateStyleSheet(currTheme);
  }

  const setUniformValue = (name: string, value: Uniform) => {
    const updated = new Map(values.entries());
    updated.set(name, value);
    setValues(updated);
  };

  const uniformValues = (): number[] =>
    uniforms
      .map((el) => values.get(el) || kDefaultUniform)
      .map((el) => el.value);

  const generateWgsl = (raw: string) => {
    const lines: string[] = [];
    const log: string[] = [];
    try {
      const parsed = read(raw);

      lines.push("Parsed:");
      lines.push(...parsed.map((el) => print(el)));

      const env = new Env();
      addBuiltins(env);
      const res = parsed
        .map((expr) => evaluate(expr, env))
        .filter((expr) => expr.type !== "null");

      lines.push("", "Evaluated:");
      lines.push(...res.map((el) => print(el)));

      const ctx = makeContext({
        log: (...args) => log.push(args.map((el) => el.toString()).join(" ")),
      });
      const generated = res.map((expr) => generate(expr, env, ctx));

      const wgsl: string[] = [];

      for (const dep of ctx.dependencies.keys()) {
        wgsl.push(getShapeFn(dep), "");
      }

      const [wgslPrefix, wgslSuffix] = wgslTemplate.split("//MAP-CODE//");

      wgsl.push(wgslPrefix);
      if (generated.length > 0 && generated[0].type !== "float") {
        wgsl.push("  var res: f32 = 0;");
      }
      generated.forEach((el, i) => {
        switch (el.type) {
          case "sdf":
            if (i == generated.length - 1) {
              wgsl.push(`  return ${el.code};`);
            } else if (i == 0) {
              wgsl.push(`  var res = ${el.code};`);
            } else {
              wgsl.push(`  res = ${el.code};`);
            }
            break;
          case "void":
            wgsl.push(...indent(el.code));
            break;
          default:
            throw new Error(`Cannot use...
${el.code}
    ...in map function.`);
        }
      });
      if (generated[generated.length - 1].type !== "sdf") {
        wgsl.push("  return res;");
      }
      wgsl.push(wgslSuffix);

      setUniforms(ctx.uniforms);
      setGenerated(wgsl.join("\n"));
      setErrors("");
    } catch (err) {
      if (log.length > 0) {
        lines.unshift(`Generator log:`, ...log, "");
      }
      lines.unshift(`Error parsing: ${err}`, "");
      setGenerated("");
      setErrors(lines.join("\n"));
    }
  };

  return (
    <div
      style={{
        backgroundColor: currTheme.background,
        color: currTheme.foreground,
      }}
    >
      <div style={{ display: "grid" }}>
        <h1 style={{ color: currTheme.boldForeground, gridArea: "1/1/2/2" }}>
          SDF Tool
        </h1>
        {forcedColors ? null : (
          <div style={{ gridArea: "1/1/2/2", justifySelf: "end" }}>
            Theme:{" "}
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              {Array.from(kThemeNames.entries()).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
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
          shader={makeShader(shader, generated, uniforms.length)}
          vertexShader="vertex_main"
          fragmentShader="frag_main"
          uniformValues={uniformValues()}
        />
        <React.Suspense fallback={"loading..."}>
          <EditorThemeProvider value={forcedColors ? false : currTheme}>
            <DslEditor
              style={{ gridArea: "1/2/3/3" }}
              fontSize={16}
              line=""
              onGenerating={(s: string) => generateWgsl(s)}
              onDoneEditing={(s: string) => console.log(s)}
            />
          </EditorThemeProvider>
        </React.Suspense>
        <div style={{ gridArea: "2/1/3/2", overflowY: "auto" }}>
          {uniforms.length == 0 ? null : (
            <div
              style={{
                display: "grid",
                gap: "0.5em",
                padding: "0.5em 0",
                alignItems: "center",
                maxWidth: "40em",
              }}
            >
              {uniforms.map((el) => (
                <UniformEditor
                  key={el}
                  name={el}
                  {...(values.get(el) || getDefaultUniform(el))}
                  onChange={(v) => setUniformValue(el, v)}
                />
              ))}
            </div>
          )}
          <code>
            <pre style={{ whiteSpace: "pre-wrap" }}>{generated}</pre>
            <pre style={{ whiteSpace: "pre-wrap", color: currTheme.red }}>
              {errors}
            </pre>
          </code>
        </div>
      </div>
    </div>
  );
};
