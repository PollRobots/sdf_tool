import { ServeIndexOptions } from "webpack-dev-server";
import {
  DslGeneratorError,
  Expression,
  Generated,
  GeneratedType,
  Internal,
  Lambda,
  Shape,
  Vector,
  isIdentifier,
  isSpecial,
  isVectorName,
} from "./dsl";
import { Env } from "./env";
import { evaluate } from "./evaluate";
import { print } from "./print";
import {
  generateConstAngleRotationMatrix,
  generateConstAxisRotationMatrix,
  generateConstRotationMatrix,
} from "./rotate";

const isConstNumber = (value: Generated) =>
  value.type === "float" && !isNaN(Number(value.code));

const isConstVector = (value: Generated) => {
  if (value.type !== "vec") {
    return false;
  }
  const m = value.code.match(/^vec3\<f32\>\(([^)]*)\)$/);
  if (!m) {
    return false;
  }
  var parts = m[1].split(",");
  return parts.length == 3 && parts.every((el) => !isNaN(Number(el)));
};

export const coerce = (value: Generated, type: GeneratedType): Generated => {
  if (value.type === type) {
    return value;
  }
  switch (type) {
    case "vec":
      switch (value.type) {
        case "float":
          return {
            code: `vec3<f32>(${value.code})`,
            type: "vec",
          };
        default:
          throw new Error(`Cannot coerce from ${value.type} to vec`);
      }
    default:
      throw new Error(`Cannot coerce from ${value.type} to ${type}`);
  }
};

export const hasVectors = (args: Generated[]): boolean =>
  args.some((el) => el.type === "vec");

export const hasVoids = (args: Generated[]): boolean =>
  args.some((el) => el.type === "void");

type GenerateContextLog = (...args: string[]) => void;

export interface GenerateContext {
  log: GenerateContextLog;
  dependencies: Set<string>;
  readonly uniforms: string[];
  readonly offsets: number[];
  getUniformCode: (name: string, failForUnknown?: boolean) => string;
  applyUniforms: (lines: string[]) => void;
}

export const makeContext = (ctx: Partial<GenerateContext>): GenerateContext =>
  new GenerateContextImpl(
    ctx.log || (() => {}),
    ctx.dependencies || new Set(),
    ctx.uniforms || []
  );

interface UniformInfo {
  name: string;
  isVector: boolean;
  offset?: number;
}

class GenerateContextImpl implements GenerateContext {
  log: GenerateContextLog;
  dependencies: Set<string>;

  private haveOffsets = false;
  private readonly uniformsInfo: UniformInfo[];

  constructor(
    log: GenerateContextLog,
    dependencies: Set<string>,
    uniforms: string[]
  ) {
    this.log = log;
    this.dependencies = dependencies;
    this.uniformsInfo = uniforms.map((el) => ({
      name: el,
      isVector: isVectorName(el),
    }));
  }

  get uniforms(): string[] {
    return this.uniformsInfo.map((el) => el.name);
  }

  get offsets(): number[] {
    return this.uniformsInfo.map((el) => {
      if (el.isVector) {
        return (
          el.offset * 4 +
          (el.name.endsWith("x") ? 0 : el.name.endsWith("y") ? 1 : 2)
        );
      }
      return el.offset;
    });
  }

  getUniformCode(ident: string, failForUnknown?: boolean): string {
    let index = this.uniformsInfo.findIndex((el) => el.name === ident);
    if (index < 0) {
      if (failForUnknown) {
        throw new Error(`Unknown uniform value ${ident}`);
      }
      index = this.uniforms.length;
      this.uniformsInfo.push({ name: ident, isVector: isVectorName(ident) });
      this.haveOffsets = false;
    }
    return `{%${ident}%}`;
  }

  calculateOffsets() {
    this.uniformsInfo.sort((a, b) => {
      if (a.isVector && b.isVector) {
        return a.name.localeCompare(b.name);
      } else if (a.isVector) {
        return -1;
      } else if (b.isVector) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    let offset = 0;
    const vectorOffsets = new Map<string, number>();

    this.uniformsInfo
      .filter((el) => el.isVector)
      .forEach((el) => {
        const vectorName = el.name.substring(0, el.name.lastIndexOf("."));
        if (vectorOffsets.has(vectorName)) {
          el.offset = vectorOffsets.get(vectorName);
        } else {
          el.offset = offset;
          vectorOffsets.set(vectorName, offset);
          offset++;
        }
      });
    offset *= 4;

    this.uniformsInfo
      .filter((el) => !el.isVector)
      .forEach((el) => {
        el.offset = offset;
        offset++;
      });

    this.haveOffsets = true;
  }

  applyUniforms(lines: string[]) {
    if (!this.haveOffsets) {
      this.calculateOffsets();
    }
    for (let i = 0; i < lines.length; i++) {
      lines[i] = lines[i]
        .replaceAll(
          /vec3\<f32\>\(\s*{%([^%]+)%},\s*{%([^%]+)%},\s*{%([^%]+)%}\s*\)/g,
          (match, a, b, c) => {
            if (!isVectorName(a) || !isVectorName(b) || !isVectorName(c)) {
              return match;
            }
            const aVectorName = a.substring(0, a.lastIndexOf("."));
            const bVectorName = b.substring(0, b.lastIndexOf("."));
            const cVectorName = c.substring(0, c.lastIndexOf("."));
            if (aVectorName !== bVectorName || bVectorName !== cVectorName) {
              return match;
            }
            const uniform = this.uniformsInfo.find((el) => el.name === a);
            if (!uniform) {
              return match;
            }
            return `uniforms.values[${uniform.offset}].${a.charAt(
              a.length - 1
            )}${b.charAt(b.length - 1)}${c.charAt(c.length - 1)}`;
          }
        )
        .replaceAll(/{%([^%]+)%}/g, (match, ident) => {
          const uniform = this.uniformsInfo.find((el) => el.name === ident);
          if (!uniform) {
            return match;
          }
          if (uniform.isVector) {
            return `uniforms.values[${uniform.offset}].${uniform.name.charAt(
              uniform.name.length - 1
            )}`;
          } else {
            const index = uniform.offset;
            return `uniforms.values[${Math.floor(index / 4)}][${index % 4}]`;
          }
        });
    }
  }
}

interface IndentOptions {
  pad?: string;
  strip?: boolean;
}

export const indent = (code: string, options: IndentOptions = {}): string[] => {
  const lines = code.split("\n");
  if (options.strip) {
    if (lines[0] === "{" && lines[lines.length - 1] === "}") {
      return lines.slice(1, lines.length - 1);
    }
  } else {
    return code.split("\n").map((el) => (options.pad || "  ") + el);
  }
};

const removeDeclarations = (name: string, code: string[]): string[] => {
  const prefix = `  var ${name} = `;
  const replace = `  ${
    name.includes(":") ? name.substring(0, name.indexOf(":")) : name
  } = `;
  return code.map((el) =>
    el.startsWith(prefix) ? replace + el.substring(prefix.length) : el
  );
};

const generateImpl = (
  expr: Expression,
  env: Env,
  ctx: GenerateContext
): Generated => {
  switch (expr.type) {
    case "list":
      const list = expr.value as Expression[];
      const head = list[0];
      if (isIdentifier(head) && isSpecial(head.value as string)) {
        const special = head.value as string;
        switch (special) {
          case "if":
            const args = list
              .slice(1)
              .map((el) => generate(evaluate(el, env), env, ctx));
            const test = args[0];
            const branches = args.slice(1);
            if (hasVoids(branches)) {
              const lines = [`if (${test.code}) {`];
              branches.forEach((branch, i) => {
                switch (branch.type) {
                  case "void":
                    lines.push(...indent(branch.code, { strip: true }));
                    break;
                  case "sdf":
                    lines.push(`  res = ${branch.code};`);
                    break;
                  default:
                    throw new Error("Incompatible types in if branches");
                }
                lines.push(i == 0 && branches.length > 1 ? "} else {" : "}");
              });
              return {
                code: lines.join("\n"),
                type: "void",
              };
            } else {
              const coerced = hasVectors(branches)
                ? branches.map((el) => coerce(el, "vec"))
                : branches;
              return {
                code: `${test.code} ? ${coerced
                  .map((el) => el.code)
                  .join(" : ")}`,
                type: coerced[0].type,
              };
            }
          case "shape":
            const shape: Shape = {
              type: list[1].value as string,
              args: list.slice(2),
            };
            return generate(
              {
                type: "shape",
                value: shape,
                offset: expr.offset,
                length: expr.length,
              },
              env,
              ctx
            );
        }
        throw new Error(`Special form ${head.value} is not implemented`);
      } else {
        const args = list
          .slice(1)
          .map((el) => generate(evaluate(el, env), env, ctx));
        const proc = evaluate(head, env);
        switch (proc.type) {
          case "internal":
            const internal = proc.value as Internal;
            if (!internal.generate) {
              throw new Error(
                `Internal procedure ${internal.name} is not implemented.`
              );
            }
            return internal.generate(args);
          case "lambda":
            const lambda = proc.value as Lambda;
            const lambda_env = new Env(env);
            lambda.symbols.forEach((sym, i) =>
              lambda_env.set(sym, {
                type: "generated",
                value: args[i],
                offset: expr.offset,
                length: expr.length,
              })
            );
            return generate(lambda.body, lambda_env, ctx);
          default:
            throw new Error(`Not implemented!, cannot generate ${print(proc)}`);
        }
      }

    case "number":
      return {
        code: expr.value.toString(),
        type: "float",
      };
    case "vector":
      const vec = expr.value as Vector;
      return vec.x === vec.y && vec.y === vec.z
        ? {
            code: `vec3<f32>(${vec.x})`,
            type: "vec",
          }
        : {
            code: `vec3<f32>(${vec.x}, ${vec.y}, ${vec.z})`,
            type: "vec",
          };
    case "generated":
      return expr.value as Generated;
    case "shape":
      const shape = expr.value as Shape;
      const generator = kShapeGenerators.get(shape.type);
      if (generator) {
        return generator(shape, env, ctx);
      }
      const name = makeShapeName(shape.type);
      const shape_args = shape.args.map((el) => generate(el, env, ctx));
      ctx.dependencies.add(name);
      return {
        code: `${name}(p, ${shape_args.map((el) => el.code).join(", ")})`,
        type: "sdf",
      };
    case "placeholder":
      const retained = expr.value as Expression;
      if (isIdentifier(retained)) {
        const ident = retained.value as string;
        return {
          code: ident === "pos" ? "p" : ctx.getUniformCode(ident),
          type: "float",
        };
      } else {
        return generate(retained, env, ctx);
      }
    case "identifier":
      if (expr.value === "t") {
        return { code: "1", type: "float" };
      }
      throw new Error(
        `Generation not implemented for ${expr.type} ${print(expr)}`
      );
    default:
      throw new Error(
        `Generation not implemented for ${expr.type} ${print(expr)}`
      );
  }
};

const makeShapeName = (identifier: string): string => {
  const letters = ["sdf"];

  let capitalize = true;
  for (const ch of identifier) {
    if (capitalize) {
      letters.push(ch.toUpperCase());
      capitalize = false;
    } else if (ch == "-") {
      capitalize = true;
    } else {
      letters.push(ch);
    }
  }
  return letters.join("");
};

export const generate = (
  expr: Expression,
  env: Env,
  ctx?: GenerateContext
): Generated => {
  if (!ctx) {
    ctx = makeContext({});
  }

  ctx.log("Generate:", print(expr));
  try {
    const value = generateImpl(expr, env, ctx);
    ctx.log(print(expr), "->", value.code);
    return value;
  } catch (err) {
    if (err instanceof DslGeneratorError) {
      throw err;
    }
    throw new DslGeneratorError(
      err instanceof Error ? err.message : err.toString(),
      expr.offset,
      expr.length
    );
  }
};

const assertShapeArity = (shape: Shape, arity: number | [number, number]) => {
  if (typeof arity === "number") {
    if (shape.args.length !== arity) {
      throw new Error(
        `${shape.type} must have exactly ${arity} arguments, found ${shape.args.length}`
      );
    }
  } else if (shape.args.length < arity[0]) {
    throw new Error(
      `${shape.type} must have at least ${arity[0]} arguments, found ${shape.args.length}`
    );
  } else if (shape.args.length > arity[1]) {
    throw new Error(
      `${shape.type} must have at most ${arity[1]} arguments, found ${shape.args.length}`
    );
  }
};

const generateSmooth = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 2);
  const lines: string[] = [];
  lines.push("{", `  var k: f32 = ${generate(shape.args[0], env, ctx).code};`);
  const smoothed = generate(shape.args[1], env, ctx);
  switch (smoothed.type) {
    case "sdf":
      lines.push(`  res = ${smoothed.code};`);
      break;
    case "void":
      lines.push(
        ...removeDeclarations("k: f32", indent(smoothed.code, { strip: true }))
      );
      break;
    default:
      throw new Error(`cannot smooth ${print(shape.args[1])}`);
  }
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const generateUnionOrIntersect = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  let op = shape.type === "union" ? "sdfUnion" : "sdfIntersection";
  const lines = ["{"];
  const args = shape.args.map((el) => generate(el, env, ctx));
  let zeroK = false;
  if (args.length > 0 && args[0].type === "float") {
    const kval = args.shift()!;
    if (Number(kval.code) === 0) {
      zeroK = true;
      op = shape.type === "union" ? "min" : "max";
    } else {
      lines.push(`  var k: f32 = ${kval.code};`);
    }
  }
  if (!zeroK) {
    ctx.dependencies.add(op);
  }
  let haveRes = false;
  args.forEach((el, i) => {
    switch (el.type) {
      case "sdf":
        lines.push(
          i == 0
            ? `  res = ${el.code};`
            : zeroK
            ? `  res = ${op}(res, ${el.code});`
            : `  res = ${op}(k, res, ${el.code});`
        );
        break;
      case "void":
        if (i == 0) {
          lines.push(...indent(el.code));
        } else {
          if (!haveRes) {
            lines.push("  var tmp_res = res;");
            haveRes = true;
          } else {
            lines.push("  tmp_res = res;");
          }
          lines.push(...indent(el.code));
          lines.push(
            zeroK
              ? `  res = ${op}(tmp_res, res);`
              : `  res = ${op}(k, tmp_res, res);`
          );
        }
        break;
      default:
        throw new Error(
          `cannot take ${
            shape.type === "union" ? "a union" : "an intersection"
          } of ${print(shape.args[i])}`
        );
    }
  });
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const generateDifference = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, [2, 3]);
  ctx.dependencies.add("sdfDifference");
  const args = shape.args.map((el) => generate(el, env, ctx));
  let k = "k";
  if (args.length == 3) {
    if (args[0].type !== "float") {
      throw new Error(
        `difference smoothing factor must be a number, found ${print(
          shape.args[0]
        )}`
      );
    }
    k = args[0].code;
    args.shift();
  }
  const left = args[0];
  const right = args[1];
  if (left.type === "sdf" && right.type === "sdf") {
    return {
      code: [
        `sdfDifference(${k},`,
        `    ${left.code},`,
        `    ${right.code})`,
      ].join("\n"),
      type: "sdf",
    };
  }

  const lines = ["{"];
  if (k !== "k") {
    lines.push(`  var k: f32 = ${k};`);
  }
  [left, right].forEach((el, i) => {
    const varName = i == 0 ? "leftRes" : "rightRes";
    switch (el.type) {
      case "sdf":
        lines.push(`  var ${varName} = ${el.code};`);
        break;
      case "void":
        lines.push(...indent(el.code));
        lines.push(`  var ${varName} = res;`);
        break;
      default:
        throw new Error(
          `cannot take difference of ${print(
            shape.args[shape.args.length - 2]
          )} and ${print(shape.args[shape.args.length - 1])}`
        );
    }
  });
  lines.push("  res = sdfDifference(k, leftRes, rightRes);");
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const generateLerp = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 3);

  const args = shape.args.map((el) => generate(el, env, ctx));
  if (args[0].type !== "float") {
    throw new Error(
      `lerp interpolation factor must be a number, found ${print(
        shape.args[0]
      )}`
    );
  }
  const t = args[0].code;
  const left = args[1];
  const right = args[2];
  if (left.type === "sdf" && right.type === "sdf") {
    return {
      code: [
        `mix(${left.code},`,
        `    ${right.code},`,
        `    saturate(${t}))`,
      ].join("\n"),
      type: "sdf",
    };
  }
  const lines = ["{"];
  [left, right].forEach((el, i) => {
    const varName = i == 0 ? "leftRes" : "rightRes";
    switch (el.type) {
      case "sdf":
        lines.push(`  var ${varName} = ${el.code};`);
        break;
      case "void":
        lines.push(...indent(el.code));
        lines.push(`  var ${varName} = res;`);
        break;
      default:
        throw new Error(
          `cannot take linear interpolation of ${print(
            shape.args[1]
          )} and ${print(shape.args[2])}}`
        );
    }
  });
  lines.push(`  res = mix(leftRes, rightRes, saturate(${t}));`);
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const generateRound = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 2);
  const radius = generate(shape.args[0], env, ctx);
  if (radius.type !== "float") {
    throw new Error(
      `rounding radius must be a number, found ${print(shape.args[0])}`
    );
  }
  const target = generate(shape.args[1], env, ctx);
  const round = Number(radius.code);
  const lines = ["{"];
  if (!isNaN(round)) {
    if (round == 0) {
      return target;
    }
    switch (target.type) {
      case "sdf":
        lines.push(`    res = ${target.code} - ${radius.code};`);
        break;
      case "void":
        lines.push(...indent(target.code, { strip: true }));
        lines.push(`  res -= ${radius.code};`);
      default:
        throw new Error(`cannot ${shape.type} ${print(shape.args[1])}`);
    }
  } else {
    lines.push(`  var radius = ${radius.code};`);
    switch (target.type) {
      case "sdf":
        lines.push(`  res = ${target.code} - radius;`);
        break;
      case "void":
        lines.push(...indent(target.code));
        lines.push("  res -= radius;");
        break;
      default:
        throw new Error(`cannot ${shape.type} ${print(shape.args[1])}`);
    }
  }
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const generateScale = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 2);

  const factor = generate(shape.args[0], env, ctx);
  if (factor.type !== "float") {
    throw new Error(
      `scale factor must be a number, found ${print(shape.args[0])}`
    );
  }
  const target = generate(shape.args[1], env, ctx);
  const scale = Number(factor.code);
  const lines = ["{"];
  if (!isNaN(scale)) {
    if (scale == 0) {
      return {
        type: "sdf",
        code: "1e5",
      };
    }
    lines.push(`  var p = p / ${factor.code};`);
    switch (target.type) {
      case "sdf":
        lines.push(`  res = ${factor.code} * ${target.code};`);
        break;
      case "void":
        lines.push(...indent(target.code));
        lines.push(`  res *= ${factor.code};`);
      default:
        throw new Error(`cannot ${shape.type} ${print(shape.args[1])}`);
    }
  } else {
    lines.push(`  var scale = ${factor.code};`);
    lines.push("  if (scale == 0) {", "    res = 1e5;", "  } else {");
    lines.push(`    var p = p / scale;`);
    switch (target.type) {
      case "sdf":
        lines.push(`    res = scale * ${target.code};`);
        break;
      case "void":
        lines.push(...indent(target.code, { pad: "    " }));
        lines.push("    res *= scale;");
        break;
      default:
        throw new Error(`cannot ${shape.type} ${print(shape.args[1])}`);
    }
    lines.push("  }");
  }
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const generateTranslate = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 2);
  const lines = ["{"];
  const translation = generate(shape.args[0], env, ctx);
  if (translation.type !== "vec") {
    throw new Error(
      `translation must be a vector, found ${print(shape.args[0])}`
    );
  }
  lines.push(`  var p = p - ${translation.code};`);
  const translation_target = generate(shape.args[1], env, ctx);
  switch (translation_target.type) {
    case "sdf":
      lines.push(`  res = ${translation_target.code};`);
      break;
    case "void":
      lines.push(...indent(translation_target.code));
      break;
    default:
      throw new Error(`cannot ${shape.type} ${print(shape.args[1])}`);
  }
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const generateRotate = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 3);
  const axis = generate(shape.args[0], env, ctx);
  if (axis.type !== "vec") {
    throw new Error(
      `rotation axis must be a vector, found ${print(shape.args[0])}`
    );
  }
  const angle = generate(shape.args[1], env, ctx);
  if (angle.type !== "float") {
    throw new Error(
      `rotation angle must be a number, found ${print(shape.args[1])}`
    );
  }
  const lines = ["{"];
  const axisIsConst = isConstVector(axis);
  const angleIsConst = isConstNumber(angle);
  if (axisIsConst && angleIsConst) {
    lines.push(
      ...generateConstRotationMatrix(axis.code, Number(angle.code)),
      `  var p = rot * p;`
    );
  } else if (axisIsConst) {
    lines.push(
      ...generateConstAxisRotationMatrix(axis.code, angle.code),
      `  var p = rot * p;`
    );
  } else if (angleIsConst) {
    lines.push(
      ...generateConstAngleRotationMatrix(axis.code, Number(angle.code)),
      "  var p = rot * p;"
    );
  } else {
    lines.push(`  var p = sdfRotate(p, ${axis.code}, ${angle.code});`);
    ctx.dependencies.add("sdfRotate");
  }
  const target = generate(shape.args[2], env, ctx);
  switch (target.type) {
    case "sdf":
      lines.push(`  res = ${target.code};`);
      break;
    case "void":
      const inner = indent(target.code);
      lines.push(...removeDeclarations("p", inner));
      break;
    default:
      throw new Error(`cannot ${shape.type} ${print(shape.args[2])}`);
  }
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const generateReflect = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 2);
  const lines = ["{"];
  const reflection = generate(shape.args[0], env, ctx);
  if (reflection.type !== "vec") {
    throw new Error(
      `reflection must be a vector, found ${print(shape.args[0])}`
    );
  }
  lines.push(`  var p = select(p, abs(p), ${reflection.code} > vec3<f32>(0));`);
  const target = generate(shape.args[1], env, ctx);
  switch (target.type) {
    case "sdf":
      lines.push(`  res = ${target.code};`);
      break;
    case "void":
      lines.push(...indent(target.code));
      break;
    default:
      throw new Error(`cannot ${shape.type} ${print(shape.args[1])}`);
  }
  lines.push("}");
  return {
    code: lines.join("\n"),
    type: "void",
  };
};

const kShapeGenerators = new Map<
  string,
  (shape: Shape, env: Env, ctx: GenerateContext) => Generated
>([
  ["smooth", generateSmooth],
  ["union", generateUnionOrIntersect],
  ["intersect", generateUnionOrIntersect],
  ["difference", generateDifference],
  ["lerp", generateLerp],
  ["round", generateRound],
  ["scale", generateScale],
  ["translate", generateTranslate],
  ["rotate", generateRotate],
  ["reflect", generateReflect],
  ["hide", () => ({ code: "1e5", type: "sdf" })],
]);
