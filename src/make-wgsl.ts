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
          wgsl.push(...indent(postProcess(el.code)));
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

const postProcess = (code: string): string => {
  const lines = code.split("\n");
  return postProcessImpl(lines, "");
};

const postProcessImpl = (lines: string[], indent: string): string => {
  const children = bracketize(lines);

  const varNames = new Set<string>();
  const newLines: string[] = [];
  while (true) {
    // find all functions
    const functions = new Map<string, number>();
    children
      .filter((line) => typeof line === "string")
      .forEach((line) => {
        for (const m of (line as string).matchAll(/\b\w+\([^())]+\)/g)) {
          functions.set(m[0], (functions.get(m[0]) || 0) + 1);
        }
      });
    // replace all functions with more than 1 callsit
    let changes = 0;
    for (const [fragment, count] of functions.entries()) {
      if (count > 1 || fragment.startsWith("sdf")) {
        continue;
      }
      const fnName = fragment.substring(0, fragment.indexOf("("));
      const varName = `tmp_${fnName}_${varNames.size + 1}`;
      varNames.add(varName);
      newLines.push(`${indent}let ${varName} = ${fragment};`);
      for (let i = 0; i != children.length; i++) {
        const curr = children[i];
        if (Array.isArray(curr)) {
          continue;
        }
        if (curr.includes(fragment)) {
          children[i] = curr.replaceAll(fragment, varName);
        }
      }
      changes++;
    }
    // find all parenthetical sub-expressions
    const subExpressions = new Map<string, number>();
    children.forEach((line) => {
      if (typeof line !== "string") {
        return;
      }
      const starts: number[] = [];
      for (let i = 0; i != line.length; i++) {
        const ch = line.charAt(i);
        if (ch === "(") {
          starts.push(i);
        } else if (ch === ")" && starts.length > 0) {
          let start = starts.pop()!;
          // check previous character until either '(' or ' ' is found
          for (let j = start - 1; j >= 0; j--) {
            const pre = line.charAt(j);
            if (pre == "(" || pre == " ") {
              start = j + 1;
              break;
            }
          }
          // a subexpression is only a candidate if it is preceded by '(' or ' '
          //const pre = line.charAt(Math.max(start - 1, 0));
          //if (pre === "(" || pre === " ") {
          const sub = line.substring(start, i + 1);
          subExpressions.set(sub, (subExpressions.get(sub) || 0) + 1);
          //}
        }
      }
    });
    // replace all subexpressions with more than one callsite, shortest to
    // longest, including replacing within remaining sub expressions.
    const sortedSubs = Array.from(subExpressions.keys())
      .filter((k) => subExpressions.get(k) > 1)
      .sort((a, b) => {
        if (a.length == b.length) {
          const diff = subExpressions.get(b) - subExpressions.get(a);
          return diff == 0 ? a.localeCompare(b) : diff;
        }
        return a.length - b.length;
      });
    while (sortedSubs.length > 0) {
      const curr = sortedSubs.shift()!;
      if (!curr.match(/\w\(/) && !curr.includes("tmp_")) {
        // only consider sub expressions that call functions
        continue;
      }
      if (curr.startsWith("sdf")) {
        continue;
      }
      const isCall = !curr.startsWith("(");
      const varName = isCall
        ? `tmp_${
            curr.startsWith("vec3")
              ? "vec"
              : curr.substring(0, curr.indexOf("("))
          }_${varNames.size + 1}`
        : `tmp_exp_${varNames.size + 1}`;
      varNames.add(varName);
      newLines.push(
        `${indent}let ${varName} = ${
          isCall ? curr : curr.substring(1, curr.length - 1)
        };`
      );

      for (let i = 0; i != children.length; i++) {
        const line = children[i];
        if (typeof line !== "string") {
          continue;
        }
        if (line.includes(curr)) {
          children[i] = line.replaceAll(curr, varName);
        }
      }

      for (let i = 0; i != sortedSubs.length; i++) {
        if (sortedSubs[i].includes(curr)) {
          sortedSubs[i] = sortedSubs[i].replaceAll(curr, varName);
        }
      }
      changes++;
    }

    if (changes == 0) {
      break;
    }
  }
  children.splice(0, 0, ...newLines);

  const output = children.map((el) =>
    Array.isArray(el) ? postProcessImpl(el, indent + "  ") : el
  );
  return output.join("\n");
};

const bracketize = (lines: string[]) => {
  const children: (string | string[])[] = [];

  let bracket = 0;
  let accum: string[] = [];
  for (const line of lines) {
    const b = line.match(/^\s*([{}])\s*$/);
    if (b) {
      if (b[1] == "{") {
        if (bracket == 0) {
          children.push(line);
        } else {
          accum.push(line);
        }
        bracket++;
      } else {
        bracket--;
        if (bracket == 0) {
          children.push(accum);
          children.push(line);
          accum = [];
        } else if (bracket < 0) {
          throw new Error("Mismatched brackets in generated code, overclosed");
        } else {
          accum.push(line);
        }
      }
    } else if (bracket === 0) {
      children.push(line);
    } else {
      accum.push(line);
    }
  }
  if (bracket !== 0) {
    throw new Error("Mismatched brackets in generated code, underclosed");
  }
  return children;
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
