import {
  Expression,
  Internal,
  Value,
  Vector,
  isValue,
  isNumber,
  isVector,
  kEmptyList,
  makeNumber,
  makeVector,
  Generated,
  makeList,
  DslEvalError,
  isExpression,
} from "./dsl";
import { printExpr } from "./print";
import { Env } from "./env";
import { read } from "./read";
import { hasVectors, coerce } from "./generate";
import { ColorTuple, make_color } from "./colorspaces";

const kTrue: Expression = {
  type: "identifier",
  value: "t",
  offset: -1,
  length: 1,
};

const requireValueArgs = (name: string, args: Expression[]): Value[] => {
  return args.map((el) => {
    if (!isValue(el)) {
      throw new DslEvalError(
        `${name} requires arguments to be numbers or vectors, found ${printExpr(
          el
        )}`,
        el.offset,
        el.length
      );
    }
    return el as Value;
  });
};

const requireValueArg = (name: string, index: number, arg: Expression) => {};

const requireArity = (
  name: string,
  arity: number | [number, number],
  args: Expression[] | Generated[]
): void => {
  if (typeof arity === "number") {
    if (args.length !== arity) {
      if (args.length > 0 && isExpression(args[0])) {
        const pos = getArgsPosition(args as Expression[]);
        throw new DslEvalError(
          `${name} requires ${arity} args, called with ${args.length}`,
          pos.offset,
          pos.length
        );
      }
      throw new Error(
        `${name} requires ${arity} args, called with ${args.length}`
      );
    }
  } else {
    if (args.length < arity[0]) {
      if (args.length > 0 && isExpression(args[0])) {
        const pos = getArgsPosition(args as Expression[]);
        throw new DslEvalError(
          `${name} must have at least ${arity[0]} args, called with ${args.length}`,
          pos.offset,
          pos.length
        );
      }
      throw new Error(
        `${name} must have at least ${arity[0]} args, called with ${args.length}`
      );
    } else if (args.length > arity[1]) {
      if (isExpression(args[0])) {
        const pos = getArgsPosition(args as Expression[]);
        throw new DslEvalError(
          `${name} must have at most ${arity[1]} args, called with ${args.length}`,
          pos.offset,
          pos.length
        );
      }
      throw new Error(
        `${name} must have at most ${arity[1]} args, called with ${args.length}`
      );
    }
  }
};

const requireMinArity = (
  name: string,
  arity: number,
  args: Expression[] | Generated[]
): void => {
  if (args.length < arity) {
    throw new Error(
      `${name} requires at least ${arity} args, called with ${args.length}`
    );
  }
};

const requireVector = (name: string, pos: number, arg: Expression): void => {
  if (arg.type !== "vector") {
    throw new DslEvalError(
      `${name} requires ${pos} arg to be a vector`,
      arg.offset,
      arg.length
    );
  }
};

const requireNumber = (name: string, pos: number, arg: Expression): void => {
  if (arg.type !== "number") {
    throw new DslEvalError(
      `${name} requires ${pos} arg to be a number, found ${printExpr(arg).slice(
        0,
        32
      )}`,
      arg.offset,
      arg.length
    );
  }
};

export const getValueAsVector = (value: Value): Vector => {
  if (value.type === "vector") {
    return value.value as Vector;
  } else {
    return {
      x: value.value as number,
      y: value.value as number,
      z: value.value as number,
    };
  }
};

const fnOfOne = (name: string, impl: (x: number) => number): Internal => ({
  name: name,
  impl: (args: Expression[]) => {
    requireArity(name, 1, args);
    const values = requireValueArgs(name, args);
    const a = values[0];
    if (a.type === "number") {
      return makeNumber(impl(a.value as number), a.offset, a.length);
    } else {
      const vec = a.value as Vector;
      return makeVector(
        impl(vec.x),
        impl(vec.y),
        impl(vec.z),
        a.offset,
        a.length
      );
    }
  },
  generate: (args) => ({
    code: `${name}(${args.map((el) => el.code).join(", ")})`,
    type: args[0].type,
  }),
  insertText: `${name} \${1:value}`,
});

const getArgsPosition = (
  exprs: Expression[]
): { offset: number; length: number } => {
  if (exprs.length == 0) {
    return { offset: 0, length: 0 };
  }
  const start = exprs.reduce(
    (lowest, el) => (el.offset > 0 ? Math.min(lowest, el.offset) : lowest),
    exprs[0].offset
  );
  const end = exprs.reduce(
    (highest, el) => Math.max(highest, el.offset + el.length),
    0
  );

  return {
    offset: start,
    length: end - start,
  };
};

const kComparisonNames = new Map([
  [".lt", "<"],
  [".le", "<="],
  [".gt", ">"],
  [".ge", ">="],
  ["eq", "=="],
  ["neq", "!="],
]);

const makeComparison = (
  name: string | string[],
  impl: (a: number, b: number) => number
): Internal[] => {
  const names = typeof name === "string" ? [name] : name;
  return names.map((name) => ({
    name: name,
    impl: (args) => {
      requireMinArity(name, 2, args);
      const values = requireValueArgs(name, args);
      if (values.some(isVector)) {
        const vecs = values.map(getValueAsVector);
        let last = vecs[0];
        const res: Vector = { x: 1, y: 1, z: 1 };
        for (const curr of vecs) {
          res.x &= impl(last.x, curr.x);
          res.y &= impl(last.y, curr.y);
          res.z &= impl(last.z, curr.z);
          if ((res.x | res.y | res.z) == 0) {
            break;
          }
          last = curr;
        }
        return {
          type: "vector",
          value: res,
          ...getArgsPosition(args),
        };
      } else {
        let last = values[0].value as number;
        for (const curr of values.slice(1)) {
          const n = curr.value as number;
          if (impl(last, n) == 0) {
            return kEmptyList;
          } else {
            last = n;
          }
        }
        return kTrue;
      }
    },
    generate: (args) => {
      if (hasVectors(args)) {
        args = args.map((el) => coerce(el, "vec"));
      }
      const wglsOp = kComparisonNames.get(name) || name;
      return {
        code: args.reduce((accum, el, i, arr) => {
          if (i == arr.length - 1) {
            return accum;
          }
          return i > 0
            ? `${accum} && (${el.code} ${wglsOp} ${arr[i + 1].code})`
            : `(${el.code} ${wglsOp} ${arr[i + 1].code})`;
        }, ""),
        type: args[0].type,
      };
    },
    insertText: `${name} \${1:left} \${2:right}`,
  }));
};

const makeSwizzle = (name: string): Internal => {
  return {
    name: name,
    impl: (args): Expression => {
      requireArity(name, 1, args);
      requireVector(name, 0, args[0]);
      const vec = args[0].value as any;
      return makeVector(
        vec[name[0]],
        vec[name[1]],
        vec[name[2]],
        args[0].offset,
        args[0].length
      );
    },
    generate: (args) => ({
      code: `${coerce(args[0], "vec").code}.${name}`,
      type: "vec",
    }),
    docs: [
      `(**${name}** *v*)`,
      `_swizzles_ the vector *v* by rearranging its components in the order *${name}*.`,
    ],
    insertText: `${name} \${1:vector}`,
  };
};

const makeAllSwizzles = (): Internal[] => {
  const swizzles: Internal[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        swizzles.push(
          makeSwizzle(String.fromCharCode(120 + i, 120 + j, 120 + k))
        );
      }
    }
  }
  return swizzles;
};

const trySplitVec = (code: string): [string, string, string] | undefined => {
  const m = code.match(/^vec3\<f32\>\((.+),\s(.+),\s(.+)\)$/);
  if (!m) {
    return;
  }
  const x = m[1];
  const y = m[2];
  const z = m[3];
  if (x.includes(" ") || y.includes(" ") || z.includes(" ")) {
    return;
  }
  return [x, y, z];
};

const kBuiltins: Internal[] = [
  {
    name: "list",
    impl: (args) => (args.length === 0 ? kEmptyList : makeList(...args)),
  },
  {
    name: "head",
    impl: (args) => {
      requireArity("head", 1, args);
      const arg = args[0];
      if (arg.type === "null") {
        return arg;
      } else if (arg.type === "list") {
        return (arg.value as Expression[])[0];
      } else {
        throw new DslEvalError(
          `head only works on lists`,
          arg.offset,
          arg.length
        );
      }
    },
  },
  {
    name: "tail",
    impl: (args) => {
      requireArity("tail", 1, args);
      const arg = args[0];
      if (arg.type === "null" || arg.type === "list") {
        const list = arg.value as Expression[];
        if (list.length < 2) {
          return kEmptyList;
        }
        return makeList(...list.slice(1));
      } else {
        throw new DslEvalError(
          `tail only works on lists`,
          arg.offset,
          arg.length
        );
      }
    },
  },
  {
    name: "null?",
    impl: (args) => {
      requireArity("null?", 1, args);
      const arg = args[0];
      if (arg.type === "null") {
        return kTrue;
      } else {
        return kEmptyList;
      }
    },
  },
  {
    name: "list?",
    impl: (args) => {
      requireArity("list?", 1, args);
      const arg = args[0];
      if (arg.type === "null" || arg.type === "list") {
        return kTrue;
      } else {
        return kEmptyList;
      }
    },
  },
  {
    name: "number?",
    impl: (args) => {
      requireArity("number?", 1, args);
      const arg = args[0];
      if (arg.type === "number") {
        return kTrue;
      } else {
        return kEmptyList;
      }
    },
  },
  {
    name: "vector?",
    impl: (args) => {
      requireArity("vector?", 1, args);
      const arg = args[0];
      if (arg.type === "vector") {
        return kTrue;
      } else {
        return kEmptyList;
      }
    },
  },
  {
    name: "shape?",
    impl: (args) => {
      requireArity("shape?", 1, args);
      const arg = args[0];
      if (arg.type === "shape") {
        return kTrue;
      } else {
        return kEmptyList;
      }
    },
  },
  {
    name: "callable?",
    impl: (args) => {
      requireArity("callable?", 1, args);
      const arg = args[0];
      if (
        arg.type === "lambda" ||
        arg.type === "macro" ||
        arg.type === "internal"
      ) {
        return kTrue;
      } else {
        return kEmptyList;
      }
    },
  },
  {
    name: "error?",
    impl: (args) => {
      requireArity("error?", 1, args);
      const arg = args[0];
      if (arg.type === "error") {
        return kTrue;
      } else {
        return kEmptyList;
      }
    },
  },
  {
    name: "sdf",
    impl: (args) => {
      requireArity("sdf", 1, args);
      requireNumber("sdf", 0, args[0]);
      return args[0];
    },
    generate: (args) => {
      return {
        code: args[0].code,
        type: "sdf",
      };
    },
  },
  {
    name: "+",
    impl: (args) => {
      const accum: Value = {
        type: "number",
        value: 0,
        ...getArgsPosition(args),
      };
      for (const value of requireValueArgs("+", args)) {
        if (accum.type === "number" && value.type === "number") {
          accum.value = (accum.value as number) + (value.value as number);
        } else {
          const accum_vec = getValueAsVector(accum);
          const value_vec = getValueAsVector(value);

          accum.type = "vector";
          accum.value = {
            x: accum_vec.x + value_vec.x,
            y: accum_vec.y + value_vec.y,
            z: accum_vec.z + value_vec.z,
          };
        }
      }
      return accum;
    },
    generate: (args) => {
      if (args.length == 0) {
        return { code: "0.0", type: "float" };
      } else if (args.length == 1) {
        return args[0];
      } else {
        return {
          code: `(${args.map((el) => el.code).join(" + ")})`,
          type: hasVectors(args) ? "vec" : "float",
        };
      }
    },
  },

  {
    name: "-",
    impl: (args) => {
      if (args.length === 0) {
        return { type: "number", value: 0, offset: 0, length: 0 };
      }
      const values = requireValueArgs("-", args);
      if (args.length === 1) {
        const head = values[0];
        if (isNumber(head)) {
          return makeNumber(-(head.value as number), head.offset, head.length);
        } else {
          const vec = head.value as Vector;
          return makeVector(-vec.x, -vec.y, -vec.z, head.offset, head.length);
        }
      }
      const accum = { ...values[0], ...getArgsPosition(args) };
      for (const value of values.slice(1)) {
        if (accum.type === "number" && value.type === "number") {
          accum.value = (accum.value as number) - (value.value as number);
        } else {
          const accum_vec = getValueAsVector(accum);
          const value_vec = getValueAsVector(value);

          accum.type = "vector";
          accum.value = {
            x: accum_vec.x - value_vec.x,
            y: accum_vec.y - value_vec.y,
            z: accum_vec.z - value_vec.z,
          };
        }
      }
      return accum;
    },
    generate: (args) => {
      if (args.length == 0) {
        return { code: "0.0", type: "float" };
      } else if (args.length == 1) {
        return { code: `-${args[0].code}`, type: args[0].type };
      } else {
        return {
          code: `(${args.map((el) => el.code).join(" - ")})`,
          type: hasVectors(args) ? "vec" : "float",
        };
      }
    },
  },

  {
    name: "*",
    impl: (args) => {
      const accum: Value = {
        type: "number",
        value: 1,
        ...getArgsPosition(args),
      };
      for (const value of requireValueArgs("*", args)) {
        if (accum.type === "number" && value.type === "number") {
          accum.value = (accum.value as number) * (value.value as number);
        } else {
          const accum_vec = getValueAsVector(accum);
          const value_vec = getValueAsVector(value);

          accum.type = "vector";
          accum.value = {
            x: accum_vec.x * value_vec.x,
            y: accum_vec.y * value_vec.y,
            z: accum_vec.z * value_vec.z,
          };
        }
      }
      return accum;
    },
    generate: (args) => {
      if (args.length == 0) {
        return { code: "1.0", type: "float" };
      } else if (args.length == 1) {
        return args[0];
      } else {
        return {
          code: `(${args.map((el) => el.code).join(" * ")})`,
          type: hasVectors(args) ? "vec" : "float",
        };
      }
    },
  },

  {
    name: "/",
    impl: (args) => {
      if (args.length === 0) {
        return { type: "number", value: 1, offset: 0, length: 0 };
      }
      const values = requireValueArgs("/", args);
      if (values.length === 1) {
        // (/ a) is equivalent to (/ 1 a)
        values.unshift(makeNumber(1, values[0].offset, values[0].length));
      }
      const accum = { ...values[0], ...getArgsPosition(args) };
      for (const value of values.slice(1)) {
        if (accum.type === "number" && value.type === "number") {
          accum.value = (accum.value as number) / (value.value as number);
        } else {
          const accum_vec = getValueAsVector(accum);
          const value_vec = getValueAsVector(value);

          accum.type = "vector";
          accum.value = {
            x: accum_vec.x / value_vec.x,
            y: accum_vec.y / value_vec.y,
            z: accum_vec.z / value_vec.z,
          };
        }
      }
      return accum;
    },
    generate: (args) => {
      if (args.length == 0) {
        return { code: "1.0", type: "float" };
      } else if (args.length == 1) {
        return { code: `(1.0 / ${args[0].code})`, type: args[0].type };
      } else {
        return {
          code: `(${args.map((el) => el.code).join(" / ")})`,
          type: hasVectors(args) ? "vec" : "float",
        };
      }
    },
  },

  {
    name: "dot",
    impl: (args) => {
      requireArity("dot", 2, args);
      requireVector("dot", 0, args[0]);
      requireVector("dot", 1, args[1]);
      const a = args[0].value as Vector;
      const b = args[1].value as Vector;

      const pos = getArgsPosition(args);
      return makeNumber(
        a.x * b.x + a.y * b.y + a.z * b.z,
        pos.offset,
        pos.length
      );
    },
    generate: (args) => ({
      code: `dot(${args[0].code}, ${args[1].code})`,
      type: "float",
    }),
    docs: [
      "(**dot** *a* *b*)",
      "Computes the dot product of *a* and *b*.",
      `Both *a* and *b* must be vectors`,
    ],
  },

  {
    name: "normalize",
    impl: (args) => {
      requireArity("normalize", 1, args);
      requireVector("normalize", 0, args[0]);
      const a = args[0].value as Vector;

      const length = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      return makeVector(
        a.x / length,
        a.y / length,
        a.z / length,
        args[0].offset,
        args[0].length
      );
    },
    generate: (args) => ({
      code: `normalize(${args[0].code})`,
      type: "vec",
    }),
    docs: ["(**normalize** *v*)", "Normalizes the vector *v*"],
  },

  {
    name: "length",
    impl: (args) => {
      requireArity("length", 1, args);
      requireVector("length", 0, args[0]);
      const a = args[0].value as Vector;

      return makeNumber(
        Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
        args[0].offset,
        args[0].length
      );
    },
    generate: (args) => ({
      code: `length(${args[0].code})`,
      type: "float",
    }),
    docs: ["(**length** *v*)", "Returns the length or magnitude of *v*"],
  },

  {
    name: "cross",
    impl: (args) => {
      requireArity("cross", 2, args);
      requireVector("cross", 0, args[0]);
      requireVector("cross", 1, args[1]);
      const a = args[0].value as Vector;
      const b = args[1].value as Vector;

      const pos = getArgsPosition(args);
      return makeVector(
        a.y * b.z - b.y * a.z,
        a.z * b.x - b.z * a.x,
        a.x * b.y - b.x * a.y,
        pos.offset,
        pos.length
      );
    },
    generate: (args) => ({
      code: `cross(${args[0].code}, ${args[1].code})`,
      type: "vec",
    }),
    docs: [
      "(**cross** *a* *b*)",
      "Computes the cross product of *a* and *b*.",
      `Both *a* and *b* must be vectors`,
    ],
  },

  fnOfOne("abs", Math.abs),
  fnOfOne("floor", Math.floor),
  fnOfOne("ceil", Math.ceil),
  fnOfOne("sqrt", Math.sqrt),
  fnOfOne("sin", Math.sin),
  fnOfOne("cos", Math.cos),
  fnOfOne("tan", Math.tan),
  fnOfOne("asin", Math.asin),
  fnOfOne("acos", Math.acos),
  fnOfOne("radians", (x) => (x * Math.PI) / 180),
  fnOfOne("degrees", (x) => (x * 180) / Math.PI),

  {
    name: "atan",
    impl: (args) => {
      requireArity("atan", [1, 2], args);
      const values = requireValueArgs("atan", args);
      const pos = getArgsPosition(args);
      if (values.length === 1) {
        if (values[0].type === "number") {
          return makeNumber(
            Math.atan(values[0].value as number),
            pos.offset,
            pos.length
          );
        } else {
          const vec = values[0].value as Vector;
          return makeVector(
            Math.atan(vec.x),
            Math.atan(vec.y),
            Math.atan(vec.z),
            pos.offset,
            pos.length
          );
        }
      } else {
        const y = values[0];
        const x = values[1];
        if (y.type === "number" && x.type === "number") {
          return makeNumber(
            Math.atan2(y.value as number, x.value as number),
            pos.offset,
            pos.length
          );
        } else {
          const yVec = getValueAsVector(y);
          const xVec = getValueAsVector(x);
          return makeVector(
            Math.atan2(yVec.x, xVec.x),
            Math.atan2(yVec.y, xVec.y),
            Math.atan2(yVec.z, xVec.z),
            pos.offset,
            pos.length
          );
        }
      }
    },
    generate: (args) => {
      requireArity("atan", [1, 2], args);
      if (args.length === 1) {
        return { type: args[0].type, code: `atan(${args[0].code})` };
      } else {
        if (hasVectors(args)) {
          args = args.map((el) => coerce(el, "vec"));
        }
        return {
          type: args[0].type,
          code: `atan2(${args[0].code}, ${args[1].code})`,
        };
      }
    },
  },

  {
    name: "cartesian-spherical",
    impl: (args) => {
      requireArity("cartesian-spherical", [1, 2], args);
      requireVector("cartesian-spherical", 0, args[0]);
      const pos = args[0].value as Vector;
      if (args.length == 2) {
        requireVector("cartesian-spherical", 1, args[1]);
        const center = args[1].value as Vector;
        pos.x -= center.x;
        pos.y -= center.y;
        pos.z -= center.z;
      }

      const length = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
      const theta = Math.acos(pos.y / length);
      const phi = Math.atan2(pos.z, pos.x);

      const argPos = getArgsPosition(args);

      return makeVector(length, theta, phi, argPos.offset, argPos.length);
    },
    generate: (args) => {
      requireArity("cartesian-spherical", [1, 2], args);
      args = args.map((a) => coerce(a, "vec"));
      return {
        type: "vec",
        code:
          args.length == 1
            ? `cartesianToSpherical(${args[0].code})`
            : `cartesianToSpherical(${args[0].code} - ${args[1].code})`,
      };
    },
    docs: [
      "(**cartesian-spherical** *v* [*c*])",
      "Converts a cartesian vector *v* to spherical/polar coordinates. If the " +
        "vector *c* is provided, then the conversion is done relative to *c*. " +
        "*i.e.* `(cartesian-spherical a b)` is equivalent to " +
        "`(cartesian-spherical (- a b))`",
      "The result is a vector of *radius* (*r*), *inclination* (*θ*), and " +
        " *azimuth* (*φ*) as the x, y, and z elements respectively. " +
        "*inclination* and *azimuth* are in radians.",
    ],
  },
  {
    name: "spherical-cartesian",
    impl: (args) => {
      requireArity("spherical-cartesian", [1, 2], args);
      requireVector("spherical-cartesian", 0, args[0]);
      const sph = args[0].value as Vector;
      // r = sph.x;
      // θ = sph.y;
      // φ = sph.z;

      const sin_theta = Math.sin(sph.y);
      const pos: Vector = {
        x: sph.x * sin_theta * Math.cos(sph.z),
        y: sph.x * Math.cos(sph.y),
        z: sph.x * sin_theta * Math.sin(sph.z),
      };

      if (args.length == 2) {
        requireVector("cartesian-spherical", 1, args[1]);
        const center = args[1].value as Vector;
        pos.x += center.x;
        pos.y += center.y;
        pos.z += center.z;
      }

      const argPos = getArgsPosition(args);

      return makeVector(pos.x, pos.y, pos.z, argPos.offset, argPos.length);
    },
    generate: (args) => {
      requireArity("spherical-cartesian", [1, 2], args);
      args = args.map((a) => coerce(a, "vec"));
      return {
        type: "vec",
        code:
          args.length == 1
            ? `sphericalToCartesian(${args[0].code})`
            : `(sphericalToCartesian(${args[0].code}) + ${args[1].code})`,
      };
    },
    docs: [
      "(**spherical-cartesian** *sph* [*off*])",
      "Converts a vector *sph*  representing a spherical/polar coordinate to " +
        "a cartesian coordinate. If the vector *off* is provided, then the " +
        "result is offset by *off*. *i.e.* `(spherical-cartesian a b)` is " +
        "equivalent to " +
        "`(+ (sperical-spherical a) b)`",
      "The spherical vector is interpreted with the *x*, *y* and *z* " +
        "coordinates as *radius* (*r*), *inclination* (*θ*), and *azimuth* " +
        "(*φ*) respectively. *inclination* and *azimuth* are in radians.",
    ],
  },

  {
    name: "min",
    impl: (args) => {
      if (args.length === 0) {
        return makeNumber(0, 0, 0);
      }
      const values = requireValueArgs("min", args);
      const accum = { ...values[0], ...getArgsPosition(args) };
      for (const value of values.slice(1)) {
        if (accum.type === "number" && value.type === "number") {
          accum.value = Math.min(accum.value as number, value.value as number);
        } else {
          const accum_vec = getValueAsVector(accum);
          const value_vec = getValueAsVector(value);

          accum.type = "vector";
          accum.value = {
            x: Math.min(accum_vec.x, value_vec.x),
            y: Math.min(accum_vec.y, value_vec.y),
            z: Math.min(accum_vec.z, value_vec.z),
          };
        }
      }
      return accum;
    },
    generate: (args) => {
      if (args.length == 0) {
        return { code: "0.0", type: "float" };
      } else if (args.length == 1) {
        return args[0];
      } else {
        if (hasVectors(args)) {
          args = args.map((el) => coerce(el, "vec"));
        }
        return {
          code: args
            .slice(0, args.length - 2)
            .reduceRight(
              (accum, el) => `min(${el.code}, ${accum})`,
              `min(${args[args.length - 2].code}, ${
                args[args.length - 1].code
              })`
            ),
          type: args[0].type,
        };
      }
    },
  },

  {
    name: "max",
    impl: (args) => {
      if (args.length === 0) {
        return makeNumber(0, 0, 0);
      }
      const values = requireValueArgs("max", args);
      const accum = { ...values[0], ...getArgsPosition(args) };
      for (const value of values.slice(1)) {
        if (accum.type === "number" && value.type === "number") {
          accum.value = Math.max(accum.value as number, value.value as number);
        } else {
          const accum_vec = getValueAsVector(accum);
          const value_vec = getValueAsVector(value);

          accum.type = "vector";
          accum.value = {
            x: Math.max(accum_vec.x, value_vec.x),
            y: Math.max(accum_vec.y, value_vec.y),
            z: Math.max(accum_vec.z, value_vec.z),
          };
        }
      }
      return accum;
    },
    generate: (args) => {
      if (args.length == 0) {
        return { code: "0.0", type: "float" };
      } else if (args.length == 1) {
        return args[0];
      } else {
        if (hasVectors(args)) {
          args = args.map((el) => coerce(el, "vec"));
        }
        return {
          code: args
            .slice(0, args.length - 2)
            .reduceRight(
              (accum, el) => `max(${el.code}, ${accum})`,
              `max(${args[args.length - 2].code}, ${
                args[args.length - 1].code
              })`
            ),
          type: args[0].type,
        };
      }
    },
  },

  {
    name: "get-x",
    impl: (args) => {
      requireArity("get-x", 1, args);
      requireVector("get-x", 0, args[0]);
      const vec = args[0].value as Vector;
      return makeNumber(vec.x, args[0].offset, args[0].length);
    },
    generate: (args) => {
      const vec = args[0].code;
      const parts = trySplitVec(vec);
      if (parts) {
        return { code: `${parts[0]}`, type: "float" };
      }
      return { code: `${vec}.x`, type: "float" };
    },
    docs: ["(**get-x** *v*)", "Gets the x component of the vector *v*."],
  },

  {
    name: "get-y",
    impl: (args) => {
      requireArity("get-y", 1, args);
      requireVector("get-y", 0, args[0]);
      const vec = args[0].value as Vector;
      return makeNumber(vec.y, args[0].offset, args[0].length);
    },
    generate: (args) => {
      const vec = args[0].code;
      const parts = trySplitVec(vec);
      if (parts) {
        return { code: `${parts[1]}`, type: "float" };
      }
      return { code: `${vec}.y`, type: "float" };
    },
    docs: ["(**get-y** *v*)", "Gets the y component of the vector *v*."],
  },

  {
    name: "get-z",
    impl: (args) => {
      requireArity("get-z", 1, args);
      requireVector("get-z", 0, args[0]);
      const vec = args[0].value as Vector;
      return makeNumber(vec.z, args[0].offset, args[0].length);
    },
    generate: (args) => {
      const vec = args[0].code;
      const parts = trySplitVec(vec);
      if (parts) {
        return { code: `${parts[2]}`, type: "float" };
      }
      return { code: `${vec}.z`, type: "float" };
    },
    docs: ["(**get-z** *v*)", "Gets the z component of the vector *v*."],
  },

  {
    name: "vec",
    impl: (args) => {
      if (args.length === 1) {
        requireNumber("vec", 0, args[0]);
        return makeVector(
          args[0].value as number,
          args[0].value as number,
          args[0].value as number,
          args[0].offset,
          args[0].length
        );
      }
      requireArity("vec", 3, args);
      requireNumber("vec", 0, args[0]);
      requireNumber("vec", 1, args[1]);
      requireNumber("vec", 2, args[2]);
      const pos = getArgsPosition(args);
      return makeVector(
        args[0].value as number,
        args[1].value as number,
        args[2].value as number,
        pos.offset,
        pos.length
      );
    },
    generate: (args) => {
      const first = args[0].code;
      if (args.every((el) => el.code === first)) {
        return {
          code: `vec3<f32>(${first})`,
          type: "vec",
        };
      }
      return {
        code: `vec3<f32>(${args.map((el) => el.code).join(", ")})`,
        type: "vec",
      };
    },
  },

  {
    name: "pow",
    impl: (args) => {
      requireArity("pow", 2, args);
      const values = requireValueArgs("pow", args);
      const pos = getArgsPosition(args);
      if (values[0].type === "number" && values[1].type === "number") {
        return makeNumber(
          Math.pow(values[0].value as number, values[1].value as number),
          pos.offset,
          pos.length
        );
      } else {
        const a = getValueAsVector(values[0]);
        const b = getValueAsVector(values[1]);

        return makeVector(
          Math.pow(a.x, b.x),
          Math.pow(a.y, b.y),
          Math.pow(a.z, b.z),
          pos.offset,
          pos.length
        );
      }
    },
    generate: (args) => {
      if (hasVectors(args)) {
        args = args.map((el) => coerce(el, "vec"));
      }
      return {
        code: `pow(${args.map((el) => el.code).join(", ")})`,
        type: args[0].type,
      };
    },
    docs: [
      "(**pow** *x* *n*)",
      "Returns `xⁿ`, this is applied component-wise to vectors",
    ],
  },

  ...makeComparison(["<", "lt"], (a, b) => (a < b ? 1 : 0)),
  ...makeComparison(["<=", "le"], (a, b) => (a <= b ? 1 : 0)),
  ...makeComparison([">", "gt"], (a, b) => (a > b ? 1 : 0)),
  ...makeComparison([">=", "ge"], (a, b) => (a <= b ? 1 : 0)),
  ...makeComparison("eq", (a, b) => (a == b ? 1 : 0)),
  ...makeComparison("neq", (a, b) => (a != b ? 1 : 0)),

  ...makeAllSwizzles(),

  {
    name: "smoothstep",
    impl: (args) => {
      requireArity("smoothstep", 3, args);
      const values = requireValueArgs("smoothstep", args);
      const pos = getArgsPosition(args);
      if (values.some((v) => v.type == "vector")) {
        const vecs = values.map((v) => getValueAsVector(v));
        const edge0 = vecs[0];
        const edge1 = vecs[1];
        const x = vecs[2];
        const t: Vector = {
          x: Math.max(0, Math.min((x.x - edge0.x) / (edge1.x - edge0.x), 1.0)),
          y: Math.max(0, Math.min((x.y - edge0.y) / (edge1.y - edge0.y), 1.0)),
          z: Math.max(0, Math.min((x.z - edge0.z) / (edge1.z - edge0.z), 1.0)),
        };
        return makeVector(
          t.x * t.x * (3 - 2 * t.x),
          t.y * t.y * (3 - 2 * t.y),
          t.z * t.z * (3 - 2 * t.z),
          pos.offset,
          pos.length
        );
      } else {
        const edge0 = values[0].value as number;
        const edge1 = values[1].value as number;
        const x = values[2].value as number;
        const t = Math.max(0, Math.min((x - edge0) / (edge1 - edge0), 1.0));
        return makeNumber(t * t * (3 - 2 * t), pos.offset, pos.length);
      }
    },
    generate: (args) => {
      requireArity("smoothstep", 3, args);
      if (hasVectors(args)) {
        args = args.map((el) => coerce(el, "vec"));
      }
      return {
        code: `smoothstep(${args.map((el) => el.code).join(", ")})`,
        type: args[0].type,
      };
    },
    docs: [
      "(**smoothstep** *low* *high* *x*)",
      "Returns the smooth Hermite interpolation of the value *x* between `0` " +
        "and `1`. This will be applied component-wise to vector values.",
      "This is equivalent to:",
      "```" +
        `
(let
  ((t (saturate (/ (-  x low) (- high low)))))
  (* t t (- 3 (* 2 t))))
` +
        "```",
      "or `3t² - 2t³` where `t ← saturate((x - low) / (high - low))`",
    ],
  },
  {
    name: "mix",
    impl: (args) => {
      requireArity("mix", 3, args);
      const values = requireValueArgs("mix", args);
      const pos = getArgsPosition(args);
      if (values.some((v) => v.type == "vector")) {
        const vecs = values.map((v) => getValueAsVector(v));
        const low = vecs[0];
        const high = vecs[1];
        const x = vecs[2];
        const t: Vector = {
          x: Math.max(0, Math.min(x.x, 1)),
          y: Math.max(0, Math.min(x.y, 1)),
          z: Math.max(0, Math.min(x.z, 1)),
        };
        return makeVector(
          low.x * (1.0 - t.x) + high.x * t.x,
          low.y * (1.0 - t.y) + high.y * t.y,
          low.z * (1.0 - t.z) + high.z * t.z,
          pos.offset,
          pos.length
        );
      } else {
        const low = values[0].value as number;
        const high = values[1].value as number;
        const x = values[2].value as number;
        const t = Math.max(0, Math.min(x, 1));
        return makeNumber(low * (1 - t) + high * t, pos.offset, pos.length);
      }
    },
    generate: (args) => {
      requireArity("mix", 3, args);
      if (hasVectors(args)) {
        args = args.map((el) => coerce(el, "vec"));
      }
      return {
        code: `mix(${args.map((el) => el.code).join(", ")})`,
        type: args[0].type,
      };
    },
    docs: [
      "(**mix** *a* *b* *t*)",
      "Returns the linear interpolation between *a* and *b* based on the value " +
        "*t*, this will be applied component-wise to vector values.",
      "Equivalent to:",
      "```" +
        `
(+ (* a (- 1 t)) (* b t))
` +
        "```",
    ],
  },
  {
    name: "clamp",
    impl: (args) => {
      requireArity("clamp", 3, args);
      const values = requireValueArgs("clamp", args);
      const pos = getArgsPosition(args);
      if (values.some((v) => v.type == "vector")) {
        const vecs = values.map((v) => getValueAsVector(v));
        const v = vecs[0];
        const low = vecs[1];
        const high = vecs[2];
        return makeVector(
          Math.min(Math.max(low.x, v.x), high.x),
          Math.min(Math.max(low.y, v.y), high.y),
          Math.min(Math.max(low.z, v.z), high.z),
          pos.offset,
          pos.length
        );
      } else {
        const v = values[0].value as number;
        const low = values[1].value as number;
        const high = values[2].value as number;
        return makeNumber(
          Math.min(Math.max(low, v), high),
          pos.offset,
          pos.length
        );
      }
    },
    generate: (args) => {
      requireArity("clamp", 3, args);
      if (hasVectors(args)) {
        args = args.map((el) => coerce(el, "vec"));
      }
      return {
        code: `clamp(${args.map((el) => el.code).join(", ")})`,
        type: args[0].type,
      };
    },
    docs: [
      "(**clamp** *value*, *low* *high*)",
      "Restricts *value*  between the range of *low* and *high*, this will be " +
        "applied component-wise to vector values.",
    ],
  },
  {
    name: "saturate",
    impl: (args) => {
      requireArity("saturate", 1, args);
      const values = requireValueArgs("clamp", args);
      const pos = getArgsPosition(args);
      if (isVector(values[0])) {
        const v = values[0].value as Vector;
        return makeVector(
          Math.min(Math.max(0, v.x), 1),
          Math.min(Math.max(0, v.y), 1),
          Math.min(Math.max(0, v.z), 1),
          pos.offset,
          pos.length
        );
      } else {
        const v = values[0].value as number;
        return makeNumber(Math.min(Math.max(0, v), 1), pos.offset, pos.length);
      }
    },
    generate: (args) => {
      requireArity("saturate", 1, args);
      return {
        code: `saturate(${args[0].code})`,
        type: args[0].type,
      };
    },
    docs: [
      "(**saturate** *value*)",
      "Restricts *value*  between the range of `0` and `1`, this will be " +
        "applied component-wise to vector values.",
      "Equivalent to",
      "```" +
        `
(clamp 0 1 value)
` +
        "```",
    ],
  },
  {
    name: "saturate-xyz",
    impl: (args) => {
      requireArity("saturate-xyz", 1, args);
      requireVector("saturate-xyz", 0, args[0]);
      const vec = args[0].value as Vector;
      return makeVector(
        Math.min(Math.max(0, vec.x), 0.950489),
        Math.min(Math.max(0, vec.y), 1),
        Math.min(Math.max(0, vec.z), 1.08884),
        args[0].offset,
        args[0].length
      );
    },
    generate: (args) => {
      requireArity("saturate-xyz", 1, args);
      const vec = coerce(args[0], "vec");
      return {
        type: "vec",
        code: `clamp(vec3<f32>(0), kReferenceD65 * 0.01, ${vec.code})`,
      };
    },
    docs: [
      "(**saturate-xyz** *v*)",
      "This clamps the vector *v* to within the XYZ gamut. It is equivalent to ",
      "```" +
        `
(clamp 0 #<0.950489 1 1.08884>)
` +
        "```",
    ],
  },
  {
    name: "perlin",
    impl: (args) => {
      requireArity("perlin", [1, 2], args);
      requireVector("perlin", 0, args[0]);
      if (args.length == 2) {
        requireNumber("perlin", 1, args[1]);
      }

      const pos = getArgsPosition(args);

      return makeNumber(1, pos.offset, pos.length);
    },
    generate: (args) => {
      const pt = coerce(args[0], "vec").code;
      const octave = args.length == 2 ? coerce(args[1], "float").code : "1";

      return {
        code: `perlin3(${pt}, ${octave})`,
        type: "float",
      };
    },
    docs: [
      "(**perlin** *p* [*octave*])",
      "Returns a number representing a noise value at point *p*. The *octave* " +
        " value, if provided, is used to specify a frequence for the noise.",
      "`(perlin p octave)` is equivalent to `(/ (perlin (* p octave)) octave)`.",
      "*p* must be a vector, and *octave* must be a numeric value.",
      "**Note:** The values returned by `perlin` are based on a noise texture " +
        "provided to the WebGPU pipeline. They will be repeatable for given *p* " +
        "and *octave* only while that texture remains unchanged",
      "**Example:**",
      "```example" +
        `
(color (* (+ 1 (perlin :pos 1)
                 (perlin :pos 2)
                 (perlin :pos 4)
                 (perlin :pos 8)
                 (perlin :pos 16)
                 (perlin :pos 32)) 0.5 (saturate-xyz #<2>))
    (union
        (plane #<0 1 0> 0.01)
        (sphere #<0 1 0> 1)))
` +
        "```",
      "This applies 6 octaves of perlin noise to a plane and a sphere. The call " +
        "to `(saturate-xzy #<2>)` is a way to get the value of the reference " +
        "illuminant to ensure that the noise is scaled correctly in the XYZ color " +
        "space.",
    ],
  },
  {
    name: "rgb-xyz",
    impl: (args) => {
      requireArity("rgb-xyz", 1, args);
      requireVector("rgb-xyz", 0, args[0]);
      const rgb = args[0].value as Vector;
      const xyz = make_color("sRGB", [rgb.x, rgb.y, rgb.z]).as(
        "CIEXYZ"
      ) as ColorTuple;

      return makeVector(xyz[0], xyz[1], xyz[2], args[0].offset, args[0].length);
    },
    generate: (args) => {
      requireArity("rgb-xyz", 1, args);
      const rgb = coerce(args[0], "vec");
      return { code: `colSRgbToXyz(${rgb.code})`, type: "vec" };
    },
    docs: [
      "(**rgb-xyz** *rgb*)",
      "Converts the *rgb* vector representing a color in sRgb space, into a vector " +
        "representing the same color in CIE 1931 XYZ color space, using the D65 reference illuminant",
    ],
  },
  {
    name: "xyz-rgb",
    impl: (args) => {
      requireArity("xyz-rgb", 1, args);
      requireVector("xyz-rgb", 0, args[0]);
      const xyz = args[0].value as Vector;
      const rgb = make_color("CIEXYZ", [xyz.x, xyz.y, xyz.z]).as(
        "sRGB"
      ) as ColorTuple;

      return makeVector(rgb[0], rgb[1], rgb[2], args[0].offset, args[0].length);
    },
    generate: (args) => {
      requireArity("xyz-rgb", 1, args);
      const xyz = coerce(args[0], "vec");
      return { code: `colXyzToSRgb(${xyz.code})`, type: "vec" };
    },
    docs: [
      "(**xyz-rgb** *xyz*)",
      "Converts the *xyz* vector representing a color in CIE 1931 XYZ color space, into a vector " +
        "representing the same color in sRgb color space, using the D65 reference illuminant",
    ],
  },
  {
    name: "lab-xyz",
    impl: (args) => {
      requireArity("lab-xyz", 1, args);
      requireVector("lab-xyz", 0, args[0]);
      const lab = args[0].value as Vector;
      const xyz = make_color("CIELAB", [lab.x, lab.y, lab.z]).as(
        "CIEXYZ"
      ) as ColorTuple;

      return makeVector(xyz[0], xyz[1], xyz[2], args[0].offset, args[0].length);
    },
    generate: (args) => {
      requireArity("lab-xyz", 1, args);
      const lab = coerce(args[0], "vec");
      return { code: `colCIELabToXyz(${lab.code})`, type: "vec" };
    },
    docs: [
      "(**lab-xyz** *lab*)",
      "Converts the *lab* vector representing a color in CIE 1931 LAB color " +
        "space, into a vector representing the same color in CIE 1931 XYZ color " +
        "space, using the D65 reference illuminant",
    ],
  },
  {
    name: "xyz-lab",
    impl: (args) => {
      requireArity("xyz-lab", 1, args);
      requireVector("xyz-lab", 0, args[0]);
      const xyz = args[0].value as Vector;
      const lab = make_color("CIEXYZ", [xyz.x, xyz.y, xyz.z]).as(
        "CIELAB"
      ) as ColorTuple;

      return makeVector(lab[0], lab[1], lab[2], args[0].offset, args[0].length);
    },
    generate: (args) => {
      requireArity("xyz-lab", 1, args);
      const xyz = coerce(args[0], "vec");
      return { code: `colXyzToCIELab(${xyz.code})`, type: "vec" };
    },
    docs: [
      "(**xyz-lab** *xyz*)",
      "Converts the *xyz* vector representing a color in CIE 1931 XYZ color space, into a vector " +
        "representing the same color in CIE 1931 LAB color space, using the D65 reference illuminant",
    ],
  },
  {
    name: "lab-lch",
    impl: (args) => {
      requireArity("lab-lch", 1, args);
      requireVector("lab-lch", 0, args[0]);
      const lab = args[0].value as Vector;
      const lch = make_color("CIELAB", [lab.x, lab.y, lab.z]).as(
        "CIELCH"
      ) as ColorTuple;

      return makeVector(lch[0], lch[1], lch[2], args[0].offset, args[0].length);
    },
    generate: (args) => {
      requireArity("lab-lch", 1, args);
      const lab = coerce(args[0], "vec");
      return { code: `colCIELabToLch(${lab.code})`, type: "vec" };
    },
    docs: [
      "(**lab-lch** *lab*)",
      "Converts the *lab* vector representing a color in CIE 1931 LAB color " +
        "space, into a vector representing the same color in CIE 1931 Lch color " +
        "space, using the D65 reference illuminant",
    ],
  },
  {
    name: "lch-lab",
    impl: (args) => {
      requireArity("lch-lab", 1, args);
      requireVector("lch-lab", 0, args[0]);
      const lch = args[0].value as Vector;
      const lab = make_color("CIEXYZ", [lch.x, lch.y, lch.z]).as(
        "CIELAB"
      ) as ColorTuple;

      return makeVector(lab[0], lab[1], lab[2], args[0].offset, args[0].length);
    },
    generate: (args) => {
      requireArity("lch-lab", 1, args);
      const lch = coerce(args[0], "vec");
      return { code: `colCIELchToLab(${lch.code})`, type: "vec" };
    },
    docs: [
      "(**lch-lab** *lch*)",
      "Converts the *lch* vector representing a color in CIE 1931 Lch color space, into a vector " +
        "representing the same color in CIE 1931 LAB color space, using the D65 reference illuminant",
    ],
  },
];

interface MacroDef {
  name: string;
  symbols: string[];
  body: string;
  docs?: string[];
  insertText?: string;
}

const kMacros: MacroDef[] = [
  {
    name: "and",
    symbols: ["a", "...b"],
    body: "`(let ((aa ,a)) (if (null? (quote ,b)) aa (if aa (and ,@b) aa)))",
  },
  {
    name: "or",
    symbols: ["a", "...b"],
    body: "`(let ((aa ,a)) (if (null? (quote ,b)) aa (if aa aa (or ,@b))))",
  },
];

const kLambdas: MacroDef[] = [
  {
    name: "splat",
    symbols: ["a"],
    body: "(vec a a a)",
  },
  {
    name: "min-vec",
    symbols: ["v"],
    body: "(min (get-x v) (get-y v) (get-z v))",
    docs: [
      "(**min-vec** *v*)",
      "Gets the minimum component value of the vector *v*",
    ],
  },
  {
    name: "max-vec",
    symbols: ["v"],
    body: "(max (get-x v) (get-y v) (get-z v))",
    docs: [
      "(**max-vec** *v*)",
      "Gets the maximum component value of the vector *v*",
    ],
  },
  {
    name: "xyz-lch",
    symbols: ["xyz"],
    body: "(lab-lch (xyz-lab xyz))",
    docs: [
      "(**xyz-lch** *xyz*)",
      "Converts the *xyz* vector representing a color in CIE 1931 XYZ color " +
        "space, into a vector representing the same color in CIE 1931 LCH color " +
        "space, using the D65 reference illuminant",
    ],
  },
  {
    name: "lch-xyz",
    symbols: ["lch"],
    body: "(lab-xyz (lch-lab lch))",
    docs: [
      "(**xyz-lch** *lch*)",
      "Converts the *lch* vector representing a color in CIE 1931 LCH color " +
        "space, into a vector representing the same color in CIE 1931 XYZ color " +
        "space, using the D65 reference illuminant",
    ],
  },
];

const kShapes: MacroDef[] = [
  {
    name: "union",
    symbols: ["...c"],
    body: "`(shape union ,@c)",
    docs: [
      "(**union** *[k]* *...args*)",
      "Creates a shape that is the union of the child shapes in *...args*.",
      "If *k* is provided, then that sets the smoothing factor to be used in " +
        "this union, and in the evaluation of the children.",
      "If *k* is `0`, then no smoothing is applied, and the union is the " +
        "simple minimum of the distance functions of the children.",
    ],
    insertText: "union ${1:0} (${2:shape})",
  },
  {
    name: "intersect",
    symbols: ["...c"],
    body: "`(shape intersect ,@c)",
    docs: [
      "(**intersect** *[k]* *...args*)",
      "Creates a shape that is the intersection of the child shapes in *...args*.",
      "If *k* is provided, then that sets the smoothing factor to be used in " +
        "this intersection, and in the evaluation of the children.",
      "If *k* is `0`, then no smoothing is applied, and the intersection is the " +
        "simple maximum of the distance functions of the children.",
    ],
    insertText: "intersect ${1:0} (${2:shape})",
  },
  {
    name: "difference",
    symbols: ["...c"],
    body: "`(shape difference ,@c)",
    docs: [
      "(**difference** *[k]* *a* *b*)",
      "Creates a shape that is the difference of the shapes *a* and *b*",
      "If *k* is provided, then that sets the smoothing factor to be used in " +
        "this difference, and in the evaluation of the children.",
      "If *k* is `0`, then no smoothing is applied, and the difference is the " +
        "simple maximum of the distance function of *a* and the inverse of the " +
        "distance function of *b*",
    ],
    insertText: "difference ${1:0} (${2:shape}) (${3:subtracted-shape})",
  },
  {
    name: "lerp",
    symbols: ["a", "b", "t"],
    body: "`(shape lerp ,t ,a ,b)",
    docs: [
      "(**lerp** *a* *b* *t*)",
      "Creates a shape that is the linear interpolation of distance fields of " +
        "the shapes *a* and *b*, where *t* is a value between `0` and `1` " +
        "used to determine the proportion for the interpolation.",
      "`0` will simply be the shape *a*, `1` will be the shape *b*.",
      "*t* must be a numeric value.",
    ],
    insertText: "lerp ${1:t} (${2:shape-at-zero}) (${3:shape-at-one})",
  },
  {
    name: "scale",
    symbols: ["s", "c"],
    body: "`(shape scale ,s ,c)",
    docs: [
      "(**scale** *s* *shape*)",
      "Scales the child *shape* by a constant scaling factor *s*. ",
      "*s* must be a numeric value.",
    ],
    insertText: "scale ${1:scale} (${2:shape})",
  },
  {
    name: "translate",
    symbols: ["v", "c"],
    body: "`(shape translate ,v ,c)",
    docs: [
      "(**translate** *v* *shape*)",
      "Translates the child *shape* by the vector *v*.",
    ],
    insertText: "translate ${1:vector} (${2:shape})",
  },
  {
    name: "translate-x",
    symbols: ["x", "c"],
    body: "`(let ((xval ,x) (cval ,c)) (shape translate (vec xval 0 0) cval))",
    docs: [
      "(**translate-x** *x* *shape*)",
      "Translates the child *shape* by the vector (*x*, 0, 0).",
      "*x* must be a numeric value",
    ],
    insertText: "translate-x ${1:x} (${2:shape})",
  },
  {
    name: "translate-y",
    symbols: ["y", "c"],
    body: "`(let ((yval ,y) (cval ,c)) (shape translate (vec 0 yval 0) cval))",
    docs: [
      "(**translate-y** *y* *shape*)",
      "Translates the child *shape* by the vector (0, *y*, 0).",
      "*y* must be a numeric value",
    ],
    insertText: "translate-y ${1:y} (${2:shape})",
  },
  {
    name: "translate-z",
    symbols: ["z", "c"],
    body: "`(let ((zval ,z) (cval ,c)) (shape translate (vec 0 0 zval) cval))",
    docs: [
      "(**translate-z** *z* *shape*)",
      "Translates the child *shape* by the vector (0, 0, *y*).",
      "*z* must be a numeric value",
    ],
    insertText: "translate-z ${1:z} (${2:shape})",
  },
  {
    name: "rotate",
    symbols: ["a", "theta", "c"],
    body: "`(shape rotate ,a ,theta ,c)",
    docs: [
      "(**rotate** *axis* *angle* *shape*)",
      "Rotates the child *shape* by *angle* radians about *axis*.",
      "*axis* must be avector, *angle* must be a numeric value",
      "*Note:* To convert an angle *theta* from degrees to radians use `(radians theta)`",
    ],
    insertText: "rotate ${1:axis} ${2:angle} (${3:shape})",
  },
  {
    name: "rotate-x",
    symbols: ["theta", "c"],
    body: "`(shape rotate #<1 0 0> ,theta ,c)",
    docs: [
      "(**rotate-x** *angle* *shape*)",
      "Rotates the child *shape* by *angle* radians about the x-axis",
      "*angle* must be a numeric value",
      "*Note:* To convert an angle *theta* from degrees to radians use `(radians theta)`",
    ],
    insertText: "rotate-x ${1:angle} (${2:shape})",
  },
  {
    name: "rotate-y",
    symbols: ["theta", "c"],
    body: "`(shape rotate #<0 1 0> ,theta ,c)",
    docs: [
      "(**rotate-y** *angle* *shape*)",
      "Rotates the child *shape* by *angle* radians about the y-axis",
      "*angle* must be a numeric value",
      "*Note:* To convert an angle *theta* from degrees to radians use `(radians theta)`",
    ],
    insertText: "rotate-y ${1:angle} (${2:shape})",
  },
  {
    name: "rotate-z",
    symbols: ["theta", "c"],
    body: "`(shape rotate #<0 0 1> ,theta ,c)",
    docs: [
      "(**rotate-z** *angle* *shape*)",
      "Rotates the child *shape* by *angle* radians about the z-axis",
      "*angle* must be a numeric value",
      "*Note:* To convert an angle *theta* from degrees to radians use `(radians theta)`",
    ],
    insertText: "rotate-z ${1:angle} (${2:shape})",
  },
  {
    name: "rotate-xyz",
    symbols: ["v", "c"],
    body: "`(shape rotate #<1 0 0> (get-x ,v) (shape rotate #<0 1 0> (get-y ,v) (shape rotate #<0 0 1> (get-z ,v) ,c)))",
    docs: [
      "(**rotate-xyz** *angle* *shape*)",
      "Rotates the child *shape* by the x, y, and z components of *angle* vector about the respective component axes",
      "*angle* must be a vector value",
      "*Note:* To convert an angle *theta* from degrees to radians use `(radians theta)`",
      "`(rotate-xyz #<a b c> child)` is equivalent to calling `(rotate-x a (rotate-y b (rotate-z c child)))`",
    ],
    insertText: "rotate-xyz ${1:vector} (${2:shape})",
  },
  {
    name: "smooth",
    symbols: ["k", "c"],
    body: "`(shape smooth ,k ,c)",
    docs: [
      "(**smooth** *k* *shape*)",
      "Sets the smoothing factor *k* used in any combining operations used " +
        "to evaluate *shape*.",
      "*k* must be a numeric value.",
      "If *k* is `0`, then no smoothing is applied.",
    ],
    insertText: "smooth ${1:k} (${2:shape})",
  },
  {
    name: "abrupt",
    symbols: ["c"],
    body: "`(shape smooth 0 ,c)",
    docs: [
      "(**abrupt** *shape*)",
      "Sets the smoothing factor used in any combining operations used " +
        "to evaluate *shape* to 0. This means no smoothing will be applied.",
      "This is equivalent to `(smooth 0 shape)`",
    ],
    insertText: "abrupt (${1:shape})",
  },
  {
    name: "rounded",
    symbols: ["r", "c"],
    body: "`(shape round ,r ,c)",
    docs: [
      "(**rounded** *r* *shape*)",
      "Rounds the edges of *shape* with a rounding radius of *r*.",
      "*r* must be a numeric value.",
      "If *r* is `0`, then no rounding is applied.",
    ],
    insertText: "rounded ${1:r} (${2:shape})",
  },
  {
    name: "ellipsoid",
    symbols: ["p", "r"],
    body: "`(shape ellipsoid ,p ,r)",
    docs: [
      "(**ellipsoid** *c* *r*)",
      "Creates an ellipsoid centered on *c* with radius *r*.",
      "*c* and *r* must be vectors.",
      "**Example:**",
      "```example" +
        `
(ellipsoid #<0.5 0.25 0> #<0.5 0.25 0.5>)
` +
        "```",
      "Creates an ellipsoid centered at `(0.5, 0.25, 0)` with a radius of " +
        "`0.5` in the x and z axes, and `0.25` in the y-axis.",
    ],
    insertText: "ellipsoid ${1:c} ${2:r}",
  },
  {
    name: "sphere",
    symbols: ["p", "r"],
    body: "`(shape sphere ,p ,r)",
    docs: [
      "(**sphere** *c* *r*)",
      "Creates a sphere centered on *c* with radius *r*.",
      "*c* must be a vector, and *r* must be a numeric value.",
      "**Example:**",
      "```example" +
        `
(sphere #<0.5 0.25 0> 0.25)
` +
        "```",
      "Creates a sphere centered at `(0.5, 0.25, 0)` with a radius of `0.25`",
    ],
    insertText: "sphere ${1:c} ${2:r}",
  },
  {
    name: "box",
    symbols: ["c", "s"],
    body: "`(shape box ,c ,s)",
    docs: [
      "(**box** *c* *s*)",
      "Creates an axis aligned cuboid centered on *c* with size *s*. The box " +
        "faces will be offset from *c* along each component-axis by the absolute " +
        "value of the respective component of *s*.",
      "Both *c* and *s* must be vectors.",
      "**Example:**",
      "```example\n(box #<0 0.5 0> #<0.5>)\n```",
      "Will create a unit cube centered at `(0, 0.5, 0)`",
    ],
    insertText: "box ${1:c} ${2:s}",
  },
  {
    name: "rounded-box",
    symbols: ["c", "s", "r"],
    body: "`(shape rounded-box ,c ,s ,r)",
    docs: [
      "(**rounded-box** *c* *s* *r*)",
      "Creates an axis aligned rounded cuboid centered on *c* with size *s*. The box " +
        "faces will be offset from *c* along each component-axis by the absolute " +
        "value of the respective component of *s*. The edges will be rounded with " +
        "a radius of *r*.",
      "Both *c* and *s* must be vectors, *r* must be a numeric value",
      "**Example:**",
      "```example\n(rounded-box #<0 0.5 0> #<0.5> 0.1)\n```",
      "Will create a rounded unit cube centered at `(0, 0.5, 0)`, with edges rounded to a radius of `0.1`",
    ],
    insertText: "box ${1:c} ${2:s} ${3:r}",
  },
  {
    name: "torus",
    symbols: ["c", "maj", "min"],
    body: "`(shape torus ,c ,maj ,min)",
    docs: [
      "(**torus** *c* *major* *minor*)",
      "Creates a torus centered on *c* with the *major* and *minor* radii " +
        "respectively.",
      "The torus is created parallel with the x-z plane.",
      "*c* must be a vector, *major* and *minor* must be numeric values.",
      "**Example:**",
      "```example" +
        `
(torus #<0 0.5 0> 1 0.5)
` +
        "```",
      "Will create a torus centered at `(0, 0.5, 0)`, with major and minor " +
        "radii of `1` and `0.5` respectively",
    ],
    insertText: "torus ${1:c} ${2:major} ${3:minor}",
  },
  {
    name: "cone",
    symbols: ["c", "a", "h"],
    body: "`(shape cone ,c ,a ,h)",
    docs: [
      "(**cone** *c* *angle* *height*)",
      "Creates a cone with the apex/point at *c*, specified by *angle* (in radians), and " +
        "*height*. The cone is generated aligned with the y-axis.",
      "*c* must be a vector, *angle* and *height* must be numeric values.",
      "**Example:**",
      "```example" +
        `
(cone #<0 2 0> (radians 30) 2)
` +
        "```",
      "Will create a cone with its tip at `(0, 1, 0)` an angle of `30°`, and " +
        "a height of `2`.",
    ],
    insertText: "cone ${1:c} ${2:angle} ${3:height}",
  },
  {
    name: "infinite-cone",
    symbols: ["c", "a"],
    body: "`(shape infinite-cone ,c ,a)",
    docs: [
      "(**infinite-cone** *c* *angle*)",
      "Creates an infinite cone with the apex/point at *c*, specified by *angle* " +
        "(in radians). The cone is generated aligned with the y-axis.",
      "*c* must be a vector, *angle* must be a numeric value.",
      "**Example:**",
      "```example" +
        `
(translate-y 2 (rotate-z (radians -90)
    (infinite-cone #<0> (radians 5))))
` +
        "```",
      "This creates an infinite cone with its apex at the origin and then " +
        "rotates and translates it into view.",
    ],
    insertText: "infinite-cone ${1:c} ${2:angle}",
  },
  {
    name: "infinite-cylinder",
    symbols: ["c", "d", "r"],
    body: "`(shape infinite-cylinder ,c ,d ,r)",
    docs: [
      "(**infinite-cylinder** *c* *dir* *radius*)",
      "Creates an infinite cylinder, whose axis parallel to *dir* passes through *c*.",
      "*c* and *dir* must be vectors, *radius* must be a numeric value.",
      "**Example:**",
      "```example" +
        `
(infinite-cylinder #<0 1 0> #<0.866 0.5 0> 0.5)
` +
        "```",
      "Creates an infinite cylinder of radius `0.5`, with an axis that passes " +
        "through the point `(0, 1, 0)` and is angled 30° to the x-axis.",
    ],
    insertText: "infinite-cylinder ${1:c} ${2:dir} ${3:radius}",
  },
  {
    name: "hide",
    symbols: ["...c"],
    body: "(shape hide)",
    docs: [
      "(**hide** *...shapes*)",
      "Prevents *shapes* from rendering. This is useful as a way of " +
        '"commenting out" parts of a sketch.',
      "**Example:**",
      "```example" +
        `
(union
    (hide sphere #<-1 1 0> 1)
    (sphere #<1 1 0> 1))
` +
        "```",
      "This prevents one of the spheres in the union from rendering, simply " +
        "deleting the word `hide` will include the sphere back in the sketch.",
      "This is equivalent to:",
      "```" +
        `
(union
    (hide (sphere #<-1 1 0> 1))
    (sphere #<1 1 0> 1))
` +
        "```",
    ],
    insertText: "hide",
  },
  {
    name: "reflect",
    symbols: ["v", "c"],
    body: "`(shape reflect ,v ,c)",
    docs: [
      "(**reflect** *v* *shape*)",
      "Reflects *shape* in the axes where the respective components of *v* are " +
        "greater than zero.",
      "Depending on the component values of *v*, one two four or eight " +
        "reflected copies of *shape* will be generated.",
      "*v* must be a vector.",
      "**Example:**",
      "```example\n(reflect #<1 0 0> (sphere #<1 1 0> 0.5))\n```",
      "This will reflect the sphere in the x-axis, creating two spheres, " +
        "centered at `(1, 1, 0)` and `(-1, 1, 0)`",
      "**Note:** due to the way signed distance fields are computed, this is no " +
        "more expensive than generating a single sphere, and is cheaper than the equivalent:",
      "```" +
        `
(union
  (sphere #<1 1 0> 0.5)
  (sphere #<-1 1 0> 0.5))
` +
        "```",
    ],
    insertText: "reflect ${1:v} (${2:shape})",
  },
  {
    name: "plane",
    symbols: ["n", "h"],
    body: "`(shape plane ,n ,h)",
    docs: [
      "(**plane** *normal* *offset*)",
      "Creates a plane with the supplied *normal* at an *offset* from the origin.",
      "*normal* and *offset* must be vectors.",
      "**Example:**",
      "```example" +
        `
(union
    (intersect
        (plane #<0 1 0> 4)
        (union
            (plane #<1 0 1> -3)
            (plane #<-1 0 1> -3)))
    (sphere #<0 1 0> 1))
` +
        "```",
      "This uses the union and intersection of three planes to create walls " +
        "behind a sphere",
      "**Note:** planar shapes are a mixed blessing, their SDFs are trivial to " +
        "compute, but if the raycasting algorithm is projecting a ray parallel, or " +
        "close to parallel to the plane, and close to the surface of the plane, " +
        "then the step size the raycaster uses becomes very small and this can cause " +
        "visible glitches where the ray doesn't terminate in a reasonable number of " +
        "iterations.",
    ],
    insertText: "plane ${1:normal} ${2:offset}",
  },
  {
    name: "disk",
    symbols: ["n", "c", "r"],
    body: "`(shape disk ,n ,c ,r)",
    docs: [
      "(**disk** *normal* *center* *radius*)",
      "Creates a disk, which is a circular area of a plane with the supplied " +
        "*normal*, centered on *center* with *radius*.",
      "*normal* and *center* must be vectors, *radius* must be a number.",
      "**Example:**",
      "```example" +
        `
(disk #<0 1 0> #<0 0.5 0> 1)
` +
        "```",
      "This creates a disk with radius 1, parallel with the ground plane, " +
        "centered at `(0, 1, 0)`",
    ],
    insertText: "disk ${1:normal} ${2:center} ${3:offset}",
  },
  {
    name: "color",
    symbols: ["c", "s"],
    body: "`(shape color ,c ,s)",
    docs: [
      "(**color** *c* *shape*)",
      "Applies the color *c* to *shape*.",
      "*c* must be a vector. The components are interpreted as CIE XYZ colorspace coordinates.",
      "To convert from sRGB to XYZ use the `rgb-xzy` function.",
      "**Example:**",
      "```example" +
        `
(color (rgb-xyz #<0 0 1>) (sphere #<0 1 0> 1))
` +
        "```",
      "Creates a blue sphere of radius `1` centered at `(0, 1, 0)`.",
    ],
    insertText: "color ${1:c} (${2:shape})",
  },
  {
    name: "asymmetric-ellipsoid",
    symbols: ["c", "r1", "r2"],
    body: "`(shape asymmetric-ellipsoid ,c ,r1 ,r2)",
    docs: [
      "(**asymmetric-ellipsoid** *c* *r1* *r2*)",
      "Creates an asymmetric ellipsoid centered on *c*. The radii are selected " +
        "(on a per-component basis) from *r1* when the respective component of the " +
        "current point is less that the *c* and from *r2* otherwise.",
      "All three arguments must be vectors.",
      "**Example:**",
      "```example" +
        `
(asymmetric-ellipsoid #<0 1 0> #<1 0.25 1> #<1 0.5 0.75>)
` +
        "```",
    ],
    insertText: "asymmetric-ellipsoid ${1:c} ${2:r1} ${3:r2}",
  },
];

export const kBuiltinNames = [
  ...kBuiltins.map((el) => el.name),
  ...kMacros.map((el) => el.name),
  ...kLambdas.map((el) => el.name),
  ...kShapes.map((el) => el.name),
];

const readOne = (name: string, input: string): Expression => {
  const parsed = read(input);
  if (parsed.length !== 1) {
    throw new Error(
      `${name}: expecting only one expression in ${input.slice(0, 32)}`
    );
  }
  return parsed[0];
};

export const addBuiltins = (env: Env) => {
  env.set("t", kTrue);
  for (const b of kBuiltins) {
    env.set(b.name, { type: "internal", value: b, offset: 0, length: 0 });
  }
  for (const b of kMacros) {
    try {
      env.set(b.name, {
        type: "macro",
        value: {
          name: b.name,
          symbols: b.symbols,
          body: readOne(b.name, b.body),
          closure: env,
          docs: b.docs,
          insertText: b.insertText,
        },
        offset: 0,
        length: 0,
      });
    } catch (err) {
      throw new Error(`Error adding macro '${b.name}': ${err}`);
    }
  }

  for (const b of kLambdas) {
    try {
      env.set(b.name, {
        type: "lambda",
        value: {
          name: b.name,
          symbols: b.symbols,
          body: readOne(b.name, b.body),
          closure: env,
          docs: b.docs,
          insertText: b.insertText,
        },
        offset: 0,
        length: 0,
      });
    } catch (err) {
      throw new Error(`Error adding lambda '${b.name}': ${err}`);
    }
  }

  for (const b of kShapes) {
    try {
      env.set(b.name, {
        type: "macro",
        value: {
          name: b.name,
          symbols: b.symbols,
          body: readOne(b.name, b.body),
          closure: env,
          docs: b.docs,
          insertText: b.insertText,
        },
        offset: 0,
        length: 0,
      });
    } catch (err) {
      throw new Error(`Error adding shape '${b.name}': ${err}`);
    }
  }
};
