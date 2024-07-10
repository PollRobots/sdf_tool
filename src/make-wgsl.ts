import { Uniform, getDefaultUniform } from "./components/uniform";
import { read } from "./read";
import { printExpr } from "./print";
import { addBuiltins } from "./builtins";
import { Env } from "./env";
import { evaluate } from "./evaluate";
import { makeContext, generate, indent } from "./generate";
import { getShapeFn } from "./shapes";

import wgslColors from "./sdf/colors.wgsl";
import wgslNoise from "./sdf/noise.wgsl";
import wgslPlaceholder from "./sdf/placeholder.wgsl";
import wgslTemplate from "./sdf/map.wgsl";
import wgslUtil from "./sdf/util.wgsl";
import { Vector } from "./dsl";

interface GeneratedShader {
  error: boolean;
}

interface GeneratedShaderSuccess extends GeneratedShader {
  error: false;
  generated: string;
  uniformNames: string[];
  uniformOffsets: number[];
}

interface GeneratedShaderError extends GeneratedShader {
  error: true;
  errors: string;
}

export const isGenerationError = (
  value: GeneratedShader
): value is GeneratedShaderError => {
  return value.error;
};

export const isGenerationSuccess = (
  value: GeneratedShader
): value is GeneratedShaderSuccess => {
  return !value.error;
};

export const generateShader = (raw: string): GeneratedShader => {
  const lines: string[] = [];
  const log: string[] = [];
  try {
    const parsed = read(raw);

    lines.push("Parsed:");
    lines.push(...parsed.map((el) => printExpr(el)));

    const rootEnv = new Env(undefined, false);
    addBuiltins(rootEnv);
    const env = new Env(rootEnv, true);
    const res = parsed
      .map((expr) => evaluate(expr, env))
      .filter((expr) => expr.type !== "null");

    lines.push("", "Evaluated:");
    lines.push(...res.map((el) => printExpr(el)));

    const ctx = makeContext({
      log: (...args) => log.push(args.map((el) => el.toString()).join(" ")),
    });
    const generated = res.map((expr) => generate(expr, env, ctx));

    const wgsl: string[] = [];

    for (const dep of ctx.dependencies.keys()) {
      wgsl.push(getShapeFn(dep), "");
    }
    wgsl.push(wgslUtil, "");
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

    // wgsl.push("  res *= 0.6;");
    wgsl.push("  return vec4<f32>(col, res);");
    wgsl.push(wgslSuffix);

    for (const lambda of ctx.generatedLambdas) {
      wgsl.push("");
      wgsl.push(lambda.code);
    }

    ctx.applyUniforms(wgsl);

    return {
      error: false,
      uniformNames: ctx.uniforms,
      uniformOffsets: ctx.offsets,
      generated: wgsl.join("\n"),
    } as GeneratedShaderSuccess;
  } catch (err) {
    if (log.length > 0) {
      lines.unshift(`Generator log:`, ...log, "");
    }
    lines.unshift(`Error parsing: ${err}`, "");

    return {
      error: true,
      errors: lines.join("\n"),
    } as GeneratedShaderError;
  }
};

export const findUniformValues = (code: string): [number, number] => {
  const start = code.match(/\s*#\|\s*start-interactive-values\b\s*/);
  const end = code.match(/\s*\bend-interactive-values\s*\|#\s*/);

  if (!start || !end) {
    return [-1, -1];
  }
  return [start.index, end.index + end[0].length];
};

export const readDefaultUniformValues = (
  input: string,
  values: Map<string, Uniform>
) => {
  const [start, end] = findUniformValues(input);
  if (start < 0 || end < 0) {
    return values;
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
  return updated;
};

export const extractViewParameters = (
  defaultValues: Map<string, Uniform>
): Partial<Vector> | undefined => {
  // filter out view parameters
  if (
    defaultValues.has("view.x") ||
    defaultValues.has("view.y") ||
    defaultValues.has("view.z")
  ) {
    const view: Partial<Vector> = {};
    for (const axis of ["x", "y", "z"]) {
      const axisKey = `view.${axis}`;
      const axisValue = defaultValues.get(axisKey);
      if (axisValue) {
        defaultValues.delete(axisKey);
        (view as any)[axis] = axisValue.value;
      }
    }
    return view;
  }
};

export const makeShader = (
  template: string,
  generated: string,
  valueCount: number
) =>
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
