import {
  DslGeneratorError,
  Expression,
  Generated,
  GeneratedType,
  Internal,
  Lambda,
  Shape,
  Vector,
  dslError,
  isIdentifier,
  isSpecial,
} from "./dsl";
import { Env } from "./env";
import { evaluate } from "./evaluate";
import { printExpr } from "./print";
import { kShapeGenerators, makeShapeName } from "./shape-generators";
import { GenerateContextImpl } from "./generate-context";
import { generateSpecial } from "./special-forms-gen";

export const coerce = (value: Generated, type: GeneratedType): Generated => {
  if (value.type === type) {
    return value;
  }
  switch (type) {
    case "vec":
      switch (value.type) {
        case "sdf":
        case "float":
          return {
            code: `vec3<f32>(${value.code})`,
            type: "vec",
          };
        default:
          throw new Error(`Cannot coerce from ${value.type} to vec`);
      }
    case "float":
      switch (value.type) {
        case "sdf":
          return {
            code: value.code,
            type: "float",
          };
        default:
          throw new Error(`Cannot coerce from ${value.type} to float`);
      }
    case "sdf":
      switch (value.type) {
        case "float":
          return {
            code: value.code,
            type: "sdf",
          };
        default:
          throw new Error(`Cannot coerce from ${value.type} to sdf`);
      }
    case "void":
      switch (value.type) {
        case "sdf":
        case "float":
          return {
            code: ["{", `  res = ${value.code};`, "}"].join("\n"),
            type: "void",
          };
        default:
          throw new Error(`Cannot coerce from ${value.type} to void`);
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
  readonly builtins: Set<string>;
  readonly uniforms: string[];
  readonly offsets: number[];
  readonly generatedLambdas: GeneratedLambda[];
  getUniformCode: (name: string, failForUnknown?: boolean) => string;
  applyUniforms: (lines: string[]) => void;
  getName: (hint: string, requireNumber?: boolean) => string;
  addFunction: (
    name: string,
    definition: string[],
    type: GeneratedType
  ) => void;
  getLambda: (l: Lambda) => GeneratedLambda | undefined;
  setLambda: (
    l: Lambda,
    hint: string,
    argTypes: GeneratedType[]
  ) => GeneratedLambda;
}

export interface GeneratedLambda {
  name: string;
  type: GeneratedType;
  code: string;
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
      if (isIdentifier(head) && isSpecial(head.value)) {
        return generateSpecial(expr, env, ctx);
      } else {
        const args = list
          .slice(1)
          .map((el) => generate(evaluate(el, env), env, ctx));
        const proc = evaluate(head, env);
        switch (proc.type) {
          case "internal":
            const internal = proc.value as Internal;
            if (!internal.generate) {
              throw new DslGeneratorError(
                `Internal procedure ${internal.name} is not implemented.`,
                head.offset,
                head.length
              );
            }
            return internal.generate(args);
          case "lambda":
            const lambda = proc.value as Lambda;
            const existing =
              ctx.getLambda(lambda) ||
              ctx.setLambda(
                lambda,
                isIdentifier(head) ? (head.value as string) : "anon",
                args.map((el) => el.type)
              );
            args.forEach((arg, i) => {
              if (arg.type === "void") {
                throw new DslGeneratorError(
                  `Cannot pass ${printExpr(
                    list[i + 1]
                  )} as an argument to ${printExpr(head)}`,
                  head.offset,
                  head.length
                );
              }
            });
            // const closureSymbols = getLambdaClosureSymbols(lambda, ctx.builtins);
            const largs: string[] = args.map((el) => el.code);
            if (existing) {
              switch (existing.type) {
                case "float":
                case "vec":
                case "sdf":
                  return {
                    type: existing.type,
                    code: `${existing.name}(p, col, ${largs.join(", ")})`,
                  };
                case "void":
                  return {
                    type: "void",
                    code: [
                      "{",
                      `  var tmp_res = ${existing.name}(p, col, ${largs.join(
                        ", "
                      )});`,
                      "  res = tmp_res.w;",
                      "  col = tmp_res.xyz;",
                      "}",
                    ].join("\n"),
                  };
                default:
                  throw new DslGeneratorError(
                    `Lambda ${printExpr(head)} has an unexpected type`,
                    head.offset,
                    head.length
                  );
              }
            }
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
            throw new DslGeneratorError(
              `Not implemented!, cannot generate ${printExpr(proc)}`,
              head.offset,
              head.length
            );
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
        switch (ident) {
          case "pos":
            return { code: "p", type: "vec" };
          case "col":
            return { code: "col", type: "vec" };
          default:
            return {
              code: ctx.getUniformCode(ident),
              type: "float",
            };
        }
      } else {
        return generate(retained, env, ctx);
      }
    case "identifier":
      if (expr.value === "t") {
        return { code: "1", type: "float" };
      }
      throw new Error(
        `Generation not implemented for ${expr.type} ${printExpr(expr)}`
      );
    case "error":
      throw new DslGeneratorError(
        expr.value as string,
        expr.offset,
        expr.length
      );
    default:
      throw new Error(
        `Generation not implemented for ${expr.type} ${printExpr(expr)}`
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

  ctx.log("Generate:", printExpr(expr));
  try {
    const value = generateImpl(expr, env, ctx);
    ctx.log(printExpr(expr), "->", value.code);
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

const getLambdaClosureSymbols = (
  l: Lambda,
  builtin: Readonly<Set<string>>
): string[] => {
  const pending = [l.body];
  const accessed = new Set<string>();
  const shadowed = new Set(l.symbols);

  while (pending.length > 0) {
    const curr = pending.pop()!;

    switch (curr.type) {
      case "list":
        const list = curr.value as Expression[];
        if (isIdentifier(list[0])) {
          const proc = list[0].value as string;
          if (proc === "shape") {
            if (list.length > 2) {
              pending.push(...list.slice(2));
            }
            break;
          } else if (l.closure.has(proc)) {
            const defined = l.closure.get(proc);
            if (defined.type === "lambda") {
              const child = getLambdaClosureSymbols(
                defined.value as Lambda,
                builtin
              );
              for (const sym of child) {
                if (!shadowed.has(sym)) {
                  accessed.add(sym);
                }
              }
            }
          }
        } else {
          pending.push(...list);
        }
        break;
      case "placeholder":
        const retained = curr.value as Expression;
        if (isIdentifier(retained)) {
          break;
        }
        pending.push(retained);
        break;
      case "identifier":
        const ident = curr.value as string;
        if (isSpecial(ident) || shadowed.has(ident) || builtin.has(ident)) {
          break;
        }
        accessed.add(ident);
        break;
    }
  }

  return Array.from(accessed).sort();
};
