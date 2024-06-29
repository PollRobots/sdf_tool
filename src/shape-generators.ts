import { Generated, Shape } from "./dsl";
import { Env } from "./env";
import { GenerateContext, generate, indent } from "./generate";
import { print } from "./print";
import {
  generateConstAngleRotationMatrix,
  generateConstAxisRotationMatrix,
  generateConstRotationMatrix,
} from "./rotate";

const changesColor = (expr: Generated) => expr.code.includes(" col = ");

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

const removeDeclarations = (name: string, code: string[]): string[] => {
  const prefix = `  var ${name} = `;
  const replace = `  ${
    name.includes(":") ? name.substring(0, name.indexOf(":")) : name
  } = `;
  return code.map((el) =>
    el.startsWith(prefix) ? replace + el.substring(prefix.length) : el
  );
};

export const makeShapeName = (identifier: string): string => {
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
    if (Number(kval.code) === 0 && !args.slice(1).some(changesColor)) {
      zeroK = true;
      op = shape.type === "union" ? "min" : "max";
    } else {
      lines.push(`  var k: f32 = ${kval.code};`);
    }
  }
  if (!zeroK) {
    ctx.dependencies.add(op);
    lines.push("  var outer_col = col;");
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
            : `  res4 = ${op}(k, res, ${el.code}, col, outer_col); col = res4.rgb; res = res4.w;`
        );
        break;
      case "void":
        if (i == 0) {
          lines.push(...indent(el.code));
        } else {
          if (!haveRes) {
            lines.push("  var tmp_res = res;");
            if (!zeroK) {
              lines.push("  var tmp_col = col;", "  col = outer_col;");
            }
            haveRes = true;
          } else {
            lines.push("  tmp_res = res;");
            if (!zeroK) {
              lines.push("  tmp_col = col;", "  col = outer_col;");
            }
          }
          lines.push(...indent(el.code));
          lines.push(
            zeroK
              ? `  res = ${op}(tmp_res, res);`
              : `  res4 = ${op}(k, tmp_res, res, tmp_col, col); col=res4.rgb; res = res4.w;`
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
  const haveColor = args.some(changesColor);
  const lines = ["{"];
  [left, right].forEach((el, i) => {
    const varName = i == 0 ? "leftRes" : "rightRes";
    switch (el.type) {
      case "sdf":
        lines.push(`  var ${varName} = ${el.code};`);
        if (haveColor && i == 0) {
          lines.push(`  var tmp_col = col;`);
        }
        break;
      case "void":
        lines.push(...indent(el.code));
        lines.push(`  var ${varName} = res;`);
        if (haveColor && i == 0) {
          lines.push(`  var tmp_col = col;`);
        }
        break;
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
  if (haveColor) {
    lines.push(`  col = mix(tmp_col, col, saturate(${t}));`);
  }
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
        break;
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

const generateColor = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 2);

  const color = generate(shape.args[0], env, ctx);
  if (color.type !== "vec") {
    throw new Error(`color must be a vector, found ${print(shape.args[0])}`);
  }
  const target = generate(shape.args[1], env, ctx);
  const lines = ["{"];
  lines.push(`  col = ${color.code};`);
  switch (target.type) {
    case "sdf":
      lines.push(`  res = ${target.code};`);
      break;
    case "void":
      lines.push(...indent(target.code, {}));
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

const generateShell = (
  shape: Shape,
  env: Env,
  ctx: GenerateContext
): Generated => {
  assertShapeArity(shape, 3);
  const args = shape.args.map((el) => generate(el, env, ctx));
  const offset = args[0];
  if (offset.type !== "float") {
    throw new Error(`offset must be a number, found ${print(shape.args[0])}`);
  }
  const select = args[1];
  if (select.type !== "float") {
    throw new Error(`selector must be a number, found ${print(shape.args[1])}`);
  }
  const target = args[2];
  const lines = ["{"];
  lines.push(`  var o: f32 = ${offset.code};`);
  lines.push(`  var s: f32 = saturate(${select.code});`);
  switch (target.type) {
    case "sdf":
      lines.push(`  res = ${target.code};`);
      break;
    case "void":
      lines.push("  var tmp_col = col;");
      lines.push(...indent(target.code));
      lines.push(`  col = mix(col, tmp_col, vec3<f32>(s));`);
      break;
    default:
      throw new Error(`cannot create a shell around ${print(shape.args[2])}`);
  }
  lines.push(`  res = mix(res - o * s, res - o, step(1.5 * o, res));`);

  //lines.push(`  res -= o * s;`);
  lines.push("}");

  return { code: lines.join("\n"), type: "void" };
};

export const kShapeGenerators = new Map<
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
  ["color", generateColor],
  // ["shell", generateShell],
  ["hide", () => ({ code: "1e5", type: "sdf" })],
]);
