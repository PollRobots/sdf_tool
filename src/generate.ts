import { ContextExclusionPlugin } from "webpack";
import {
  Expression,
  Generated,
  GeneratedType,
  Internal,
  Lambda,
  Shape,
  Vector,
  isIdentifier,
  isSpecial,
  makeGenerated,
  makeIdentifier,
} from "./dsl";
import { Env } from "./env";
import { evaluate } from "./evaluate";
import { print } from "./print";

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
  args.some((el) => el.type == "vec");

export interface GenerateContext {
  log: (...args: string[]) => void;
  dependencies: Set<string>;
  uniforms: string[];
}

export const makeContext = (
  ctx: Partial<GenerateContext>
): GenerateContext => ({ ...kDefaultContext, ...ctx });

const kDefaultContext: GenerateContext = {
  log: () => {},
  dependencies: new Set(),
  uniforms: [],
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
      const args = list
        .slice(1)
        .map((el) => generate(evaluate(el, env), env, ctx));
      if (isIdentifier(head) && isSpecial(head.value as string)) {
        const special = head.value as string;
        switch (special) {
          case "if":
            const test = args[0];
            const branches = args.slice(1);
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
        throw new Error(`Special form ${head.value} is not implemented`);
      } else {
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
              lambda_env.set(sym, { type: "generated", value: args[i] })
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
      const name = `sdf${shape.type
        .substring(0, 1)
        .toUpperCase()}${shape.type.substring(1)}`;
      const shape_args = shape.args.map((el) => generate(el, env, ctx));
      ctx.dependencies.add(name);
      return {
        code: `${name}(${shape_args.map((el) => el.code).join(", ")})`,
        type: "float",
      };
    case "placeholder":
      const retained = expr.value as Expression;
      if (isIdentifier(retained)) {
        const ident = retained.value as string;
        var index = ctx.uniforms.findIndex((el) => el === ident);
        if (index < 0) {
          index = ctx.uniforms.length;
          ctx.uniforms.push(ident);
        }
        return {
          code: `uniforms.values[${index}]`,
          type: "float",
        };
      } else {
        return generate(retained, env, ctx);
      }
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
    ctx = { ...kDefaultContext };
  }

  ctx.log("Generate:", print(expr));
  const value = generateImpl(expr, env, ctx);
  ctx.log(print(expr), "->", value.code);
  return value;
};
