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
  args.some((el) => el.type === "vec");

export const hasVoids = (args: Generated[]): boolean =>
  args.some((el) => el.type === "void");

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

const indent = (code: string, strip?: boolean): string[] => {
  const lines = code.split("\n");
  if (strip) {
    if (lines[0] === "{" && lines[lines.length - 1] === "}") {
      return lines.slice(1, lines.length - 1);
    }
  } else {
    return code.split("\n").map((el) => "  " + el);
  }
};

const removeDeclarations = (name: string, code: string[]): string[] => {
  const prefix = `  var ${name} = `;
  const replace = `  ${name} = `;
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
                    lines.push(...indent(branch.code, true));
                    break;
                  case "float":
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
            return generate({ type: "shape", value: shape }, env, ctx);
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
      const lines: string[] = [];
      switch (shape.type) {
        case "smooth":
          if (shape.args.length !== 2) {
            throw new Error(
              `smooth must have exactly two arguments, found ${shape.args.length}`
            );
          }
          lines.push(
            "{",
            `  var k = ${generate(shape.args[0], env, ctx).code};`
          );
          const smoothed = generate(shape.args[1], env, ctx);
          switch (smoothed.type) {
            case "float":
              lines.push(`  res = ${smoothed.code};`);
              break;
            case "void":
              lines.push(
                ...removeDeclarations("k", indent(smoothed.code, true))
              );
              break;
            default:
              throw new Error(
                `Error: cannot smooth of ${print(shape.args[1])}`
              );
          }
          lines.push("}");
          return {
            code: lines.join("\n"),
            type: "void",
          };
        case "union":
        case "intersect":
          const ui_op = shape.type === "union" ? "sdfUnion" : "sdfIntersection";
          ctx.dependencies.add(ui_op);
          lines.push("{");
          let union_res = false;
          shape.args
            .map((el) => generate(el, env, ctx))
            .forEach((el, i) => {
              switch (el.type) {
                case "float":
                  lines.push(
                    i == 0
                      ? `  res = ${el.code};`
                      : `  res = ${ui_op}(p, t, k, res, ${el.code});`
                  );
                  break;
                case "void":
                  if (i == 0) {
                    lines.push(...indent(el.code));
                  } else {
                    if (!union_res) {
                      lines.push("  var tmp_res = res;");
                      union_res = true;
                    } else {
                      lines.push("  tmp_res = res;");
                      lines.push(...indent(el.code));
                      lines.push("  res = ${ui_op}(p, t, k, res, u_res);");
                    }
                  }
                  break;
                default:
                  throw new Error(
                    `Error: cannot take ${
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
        case "difference":
          if (shape.args.length !== 2) {
            throw new Error(
              `difference must have exactly two arguments, found ${shape.args.length}`
            );
          }
          ctx.dependencies.add("sdfDifferences");
          const diff_left = generate(shape.args[0], env, ctx);
          const diff_right = generate(shape.args[1], env, ctx);
          if (diff_left.type === "float" && diff_right.type === "float") {
            return {
              code: `sdfDifference(p, t, k, ${diff_left.code}, ${diff_right.code})`,
              type: "float",
            };
          }
          lines.push("{");
          [diff_left, diff_right].forEach((el, i) => {
            const diff_var = i == 0 ? "diff_left" : "diff_right";
            switch (el.type) {
              case "float":
                lines.push(`  var ${diff_var} = ${el.code};`);
                break;
              case "void":
                lines.push(...indent(el.code));
                lines.push(`  var ${diff_var} = res;`);
                break;
              default:
                throw new Error(
                  `Error: cannot take difference of ${print(shape.args[i])}`
                );
            }
          });
          lines.push("  res = sdfDifference(p, t, k, diff_left, diff_right);");
          lines.push("}");
          return {
            code: lines.join("\n"),
            type: "void",
          };
        case "scale":
        case "translate":
          if (shape.args.length !== 2) {
            throw new Error(
              `${shape.type} must have exactly two arguments, found ${shape.args.length}`
            );
          }
          lines.push("{");
          if (shape.type === "scale") {
            const scale_factor = generate(shape.args[0], env, ctx);
            if (scale_factor.type !== "float") {
              throw new Error(
                `scale factor must be a number, found ${print(shape.args[0])}`
              );
            }
            lines.push(`  var t = sdfScale(t, ${scale_factor.code});`);
            ctx.dependencies.add("sdfScale");
          } else {
            const translation = generate(shape.args[0], env, ctx);
            if (translation.type !== "vec") {
              throw new Error(
                `translation must be a vector, found ${print(shape.args[0])}`
              );
            }
            lines.push(`  var t = sdfTranslate(t, ${translation.code});`);
            ctx.dependencies.add("sdfTranslate");
          }
          const scale_target = generate(shape.args[1], env, ctx);
          switch (scale_target.type) {
            case "float":
              lines.push(`  res = ${scale_target.code};`);
              break;
            case "void":
              const inner = indent(scale_target.code, true);
              lines.push(...removeDeclarations("t", inner));
              break;
            default:
              throw new Error(
                `Error: cannot ${shape.type} ${print(shape.args[1])}`
              );
          }
          lines.push("}");
          return {
            code: lines.join("\n"),
            type: "void",
          };
        case "rotate":
          if (shape.args.length !== 3) {
            throw new Error(
              `rotate must have exactly three arguments, found ${shape.args.length}`
            );
          }
          const rotate_axis = generate(shape.args[0], env, ctx);
          if (rotate_axis.type !== "vec") {
            throw new Error(
              `rotation axis must be a vector, found ${print(shape.args[0])}`
            );
          }
          const rotate_angle = generate(shape.args[1], env, ctx);
          if (rotate_angle.type !== "float") {
            throw new Error(
              `rotation angle must be a number, found ${print(shape.args[1])}`
            );
          }
          lines.push("{");
          lines.push(
            `  var t = sdfRotate(t, ${rotate_axis.code}, ${rotate_angle.code});`
          );
          const rotate_target = generate(shape.args[2], env, ctx);
          switch (rotate_target.type) {
            case "float":
              lines.push(`  res = ${rotate_target.code};`);
              break;
            case "void":
              const inner = indent(rotate_target.code, true);
              lines.push(...removeDeclarations("t", inner));
              break;
            default:
              throw new Error(
                `Error: cannot ${shape.type} ${print(shape.args[2])}`
              );
          }
          lines.push("}");
          return {
            code: lines.join("\n"),
            type: "void",
          };
        default:
          const name = `sdf${shape.type
            .substring(0, 1)
            .toUpperCase()}${shape.type.substring(1)}`;
          const shape_args = shape.args.map((el) => generate(el, env, ctx));
          ctx.dependencies.add(name);
          return {
            code: `${name}(p, t, k, ${shape_args
              .map((el) => el.code)
              .join(", ")})`,
            type: "float",
          };
      }
    case "placeholder":
      const retained = expr.value as Expression;
      if (isIdentifier(retained)) {
        const ident = retained.value as string;
        if (ident === "pos") {
          return { code: "p", type: "vec" };
        }
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
    ctx = { ...kDefaultContext };
  }

  ctx.log("Generate:", print(expr));
  const value = generateImpl(expr, env, ctx);
  ctx.log(print(expr), "->", value.code);
  return value;
};
