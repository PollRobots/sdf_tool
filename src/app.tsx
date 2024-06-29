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
import wgslColors from "./sdf/colors.wgsl";
import wgslNoise from "./sdf/noise.wgsl";
import {
  Uniform,
  UniformEditor,
  getDefaultUniform,
  kDefaultUniform,
} from "./uniform";
import wgslPlaceholder from "./sdf/placeholder.wgsl";
import { isVectorName } from "./dsl";
import monaco from "monaco-editor";
import { SettingsEditor, loadSettings } from "./persisted-settings";

declare global {
  interface Window {
    monaco: typeof monaco;
    getMonaco: () => Promise<void>;
  }
}

const DslEditor = React.lazy(async () => {
  await window.getMonaco();
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

const makeShader = (template: string, generated: string, valueCount: number) =>
  template
    .replace(
      "//UNIFORM-VALUES//",
      valueCount == 0
        ? ""
        : `values: array<vec4<f32>, ${((valueCount + 15) & ~0xf) / 4}>,`
    )
    .replace(
      "//MAP-FUNCTION//",
      generated || [wgslColors, "", wgslPlaceholder].join("\n")
    );

export const App: React.FC = () => {
  const [settings, setSettings] = React.useState(loadSettings());
  const width = Math.round(window.visualViewport.width / 2);
  const height = Math.round((width * 9) / 16);
  const [generated, setGenerated] = React.useState("");
  const [errors, setErrors] = React.useState("");
  const [uniforms, setUniforms] = React.useState<string[]>([]);
  const [offsets, setOffsets] = React.useState<number[]>([]);
  const [values, setValues] = React.useState<Map<string, Uniform>>(new Map());
  const [editorTop, setEditorTop] = React.useState(true);

  const currTheme = kEditorThemes.get(settings.themeName) || kSolarizedDark;
  const forcedColors = window.matchMedia("(forced-colors: active)").matches;

  if (!forcedColors) {
    updateStyleSheet(currTheme);
  }

  const setUniformValue = (name: string, value: Uniform) => {
    const updated = new Map(values.entries());
    updated.set(name, value);
    setValues(updated);
  };

  const readDefaultUniformValues = (input: string) => {
    const start = input.indexOf("#|start-interactive-values");
    const end = input.indexOf("end-interactive-values|#");
    if (start < 0 || end < 0) {
      return;
    }

    const updated = new Map(values.entries());
    const lines = input.substring(start, end).split("\n");
    lines.forEach((line) => {
      const m = line.match(/^\s*([^\s]+)\s*=\s*([^\s]+)\s*(\[([^\]]+)])?/);
      if (!m) {
        return;
      }
      const name = m[1];
      if (updated.has(name)) {
        return;
      }
      const value = Number(m[2]);
      if (isNaN(value)) {
        return;
      }

      if (m[3]) {
        const parts = m[4].split(":").map(Number);
        if (parts.every((el) => !isNaN(el))) {
          updated.set(name, {
            value: value,
            min: parts[0],
            max: parts[1],
            step: parts[2],
            logarithmic: false,
          });
          return;
        }
      }

      updated.set(name, getDefaultUniform(name, value));
    });
    setValues(updated);
  };

  const generateWgsl = (raw: string) => {
    const lines: string[] = [];
    const log: string[] = [];
    try {
      readDefaultUniformValues(raw);
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
      wgsl.push(wgslNoise, "");
      wgsl.push(wgslColors, "");

      const [wgslPrefix, wgslSuffix] = wgslTemplate.split("//MAP-CODE//");

      wgsl.push(wgslPrefix);
      wgsl.push("  var res: f32 = 1e5;");

      generated.forEach((el, i) => {
        switch (el.type) {
          case "float":
          case "sdf":
            wgsl.push(`  res = ${el.code};`);
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

      wgsl.push("  res *= 0.6;");
      wgsl.push("  return vec4<f32>(col, res);");
      wgsl.push(wgslSuffix);

      ctx.applyUniforms(wgsl);

      setUniforms(ctx.uniforms);
      setOffsets(ctx.offsets);
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

  const captureUniforms = () =>
    uniforms
      .filter((name) => values.has(name))
      .map((name) => {
        const value = values.get(name);
        return `  ${name} = ${value.value} [${value.min}:${value.max}:${value.step}]`;
      });

  return (
    <div
      style={{
        backgroundColor: currTheme.background,
        color: currTheme.foreground,
        fontSize: `${settings.fontSize}pt`,
      }}
    >
      <div style={{ display: "grid" }}>
        <h1 style={{ color: currTheme.boldForeground, gridArea: "1/1/2/2" }}>
          SDF Tool
        </h1>
        {forcedColors ? null : (
          <SettingsEditor
            {...settings}
            onChange={(updated) => {
              setSettings(updated);
            }}
          />
        )}
      </div>
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
        />
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
          <EditorThemeProvider value={forcedColors ? false : currTheme}>
            <DslEditor
              style={{ gridArea: editorTop ? "1/2/3/3" : "2/1/3/2" }}
              fontSize={settings.fontSize}
              line=""
              uniforms={values}
              onGenerating={(s: string) => generateWgsl(s)}
              onTogglePositions={() => setEditorTop(!editorTop)}
              onCaptureUniforms={() => captureUniforms()}
            />
          </EditorThemeProvider>
        </React.Suspense>
        <div
          style={{
            gridArea: editorTop ? "2/1/3/2" : "1/2/3/3",
            overflowY: "auto",
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
                .map((els) => (
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
                ))}
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
