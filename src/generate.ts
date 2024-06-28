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
} from "./dsl";
import { Env } from "./env";
import { evaluate } from "./evaluate";
import { print } from "./print";
import { kShapeGenerators, makeShapeName } from "./shape-generators";
import { GenerateContextImpl } from "./generate-context";

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

export type GenerateContextLog = (...args: string[]) => void;

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

export interface UniformInfo {
  name: string;
  isVector: boolean;
  offset?: number;
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
