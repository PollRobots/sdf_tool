import * as dsl from "./dsl";
import { Env } from "./env";
import { evaluate } from "./evaluate";
import {
  GenerateContext,
  coerce,
  generate,
  hasVectors,
  hasVoids,
  indent,
} from "./generate";
import { printExpr } from "./print";

export const generateSpecial = (
  expr: dsl.Expression,
  env: Env,
  ctx: GenerateContext
): dsl.Generated => {
  const list = expr.value as dsl.Expression[];
  const special = list[0].value as string;
  switch (special) {
    case "if":
      return generateIf(expr, env, ctx);
    case "shape":
      return generateShape(expr, env, ctx);
    case "smoothcase":
      return generateSmoothcase(expr, env, ctx);
    default:
      throw new dsl.DslGeneratorError(
        `Special form ${special} is not implemented`,
        expr.offset,
        expr.length
      );
  }
};

const generateIf = (
  expr: dsl.Expression,
  env: Env,
  ctx: GenerateContext
): dsl.Generated => {
  const args = (expr.value as dsl.Expression[])
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
      code: `select(${coerced[1].code}, ${coerced[0].code}, ${test.code})`,
      type: coerced[0].type,
    };
  }
};

const generateShape = (
  expr: dsl.Expression,
  env: Env,
  ctx: GenerateContext
): dsl.Generated => {
  const list = expr.value as dsl.Expression[];
  const shape: dsl.Shape = {
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
};

interface GeneratedSmoothCase {
  low: dsl.Generated;
  high: dsl.Generated;
  body: dsl.Generated;
}

const generateSmoothcase = (
  expr: dsl.Expression,
  env: Env,
  ctx: GenerateContext
): dsl.Generated => {
  const list = expr.value as dsl.Expression[];

  const value = generate(list[1], env, ctx);
  if (value.type === "void") {
    throw new dsl.DslGeneratorError(
      `Cannot evaluate smoothcase for ${printExpr(list[1])}`,
      list[1].offset,
      list[1].length
    );
  }

  // generate all low, high, cases etc. and coerce all to value type
  const cases = list.slice(2).map((caselist) => {
    if (!dsl.isList(caselist) || caselist.value.length != 2) {
      throw new dsl.DslGeneratorError(
        "smoothcase case item must be a list of length 2",
        caselist.offset,
        caselist.length
      );
    }
    const caseHead = caselist.value[0];
    if (
      !dsl.isList(caseHead) ||
      caseHead.value.length === 0 ||
      caseHead.value.length > 2
    ) {
      throw new dsl.DslGeneratorError(
        "smoothcase case item head must be a list of length 1 or 2",
        caselist.offset,
        caselist.length
      );
    }
    const low = generate(caseHead.value[0], env, ctx);
    const high =
      caseHead.value.length == 1 ? low : generate(caseHead.value[1], env, ctx);
    const body = generate(caselist.value[1], env, ctx);
    return {
      low: coerce(low, value.type),
      high: coerce(high, value.type),
      body: coerce(body, value.type),
    };
  });

  // if all cases are value types, no placeholders, then we can build a custom array and function
  if (!list.slice(2).some(dsl.hasPlaceholder)) {
    const name = ctx.getName("smoothcase", true);
    const fn: string[] = [];
    switch (value.type) {
      case "float":
      case "sdf":
        fn.push(`fn ${name}(value: f32) -> f32 {`);
        fn.push(`  const cases = array<vec3<f32>, ${cases.length}>(`);
        fn.push(
          ...cases.map(
            ({ low, high, body }) =>
              `    vec3<f32>(${low.code}, ${high.code}, ${body.code}), `
          )
        );
        break;
      case "vec":
        fn.push(`fn ${name}(value: vec3<f32>) -> vec3<f32> {`);
        fn.push(`  const cases = array<vec3<f32>, ${cases.length * 3}>(`);
        fn.push(
          ...cases.map(
            ({ low, high, body }) =>
              `    ${low.code}, ${high.code}, ${body.code}, `
          )
        );
        break;
    }
    fn.push("  );", "");
    fn.push("  var prev_high = cases[1];");
    fn.push("  var prev_body = cases[2];");
    fn.push("  var res = prev_body;");
    fn.push(`  for (var i = 1; i < ${cases.length}; i++) {`);
    fn.push(
      "    var low = cases[i * 3];",
      "    var high = cases[i * 3 + 1];",
      "    var body = cases[i * 3 + 2];"
    );
    fn.push(
      "    res = select(select(body,",
      "                        mix(prev_body, body, smoothstep(prev_high, low, value)),",
      "                        value < low),",
      "                 res,",
      "                 value < prev_high);"
    );
    fn.push("    prev_high = high;");
    fn.push("    prev_body = body;");
    fn.push("  }");
    fn.push("  return res;");
    fn.push("}");

    ctx.addFunction(name, fn, value.type);

    return {
      type: value.type,
      code: `${name}(${value.code})`,
    };
  }

  /*
  (smoothcase x
      ((l_0 h_0) b_0)

      ((l_n-1 h_n-1) b_n-1)
      ((l_n h_n) b_n)

      ((l_j- h_j-1) b_j-1))
      ((l_j h_j) b_j))

  for first case...
  select(..., b_0,x < h_0)

  for middle case
  select(select(..., b_n, x < h_n) , mix(b_n-1,b_n,smoothstep(h_n-1, l_n, x)), x < l_n)

  for last case
  select(b_j, mix(b_j-1, b_j, smoothstep(h_j-1, l_j, x) ,x < l_j)
  */

  // generate a prefix and a suffix for each case.

  const fragments = cases.map(({ low, high, body }, i): [string, string] => {
    if (i === 0) {
      // first case
      return ["select(", `, ${body.code}, ${value.code} < ${high.code})`];
    }
    const high_p = cases[i - 1].high;
    const body_p = cases[i - 1].body;
    if (i !== cases.length - 1) {
      // middle case
      return [
        "select(select(",
        `, ${body.code}, ${value.code} < ${high.code}), ` +
          `mix(${body_p.code}, ${body.code}, smoothstep(${high_p.code}, ${low.code}, ${value.code})), ` +
          `${value.code} < ${low.code})`,
      ];
    } else {
      // last case
      return [
        `select(${body.code}, ` +
          `mix(${body_p.code}, ${body.code}, ` +
          `smoothstep(${high_p.code}, ${low.code}, ${value.code})), ` +
          `${value.code} < ${low.code})`,
        "",
      ];
    }
  });
  const lines: string[] = [];
  // add prefixes
  let indent = "";
  for (const frag of fragments) {
    lines.push(indent + frag[0]);
    indent += "  ";
  }
  // add suffixes
  fragments.reverse();
  for (const frag of fragments) {
    if (frag[1] == "") {
      continue;
    }
    if (indent.length > 0) {
      indent = indent.substring(0, indent.length - 2);
    }
    lines.push(indent + frag[1]);
  }

  return {
    type: value.type,
    code: lines.join("\n"),
  };
};
