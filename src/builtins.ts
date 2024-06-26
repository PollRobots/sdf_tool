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
import { print } from "./print";
import { Env } from "./env";
import { read } from "./read";
import { hasVectors, coerce } from "./generate";

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
        `${name} requires arguments to be numbers or vectors, found ${print(
          el
        )}`,
        el.offset,
        el.length
      );
    }
    return el as Value;
  });
};

const requireArity = (
  name: string,
  arity: number,
  args: Expression[] | Generated[]
): void => {
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
      `${name} requires ${pos} arg to be a number, found ${print(arg).slice(
        0,
        32
      )}`,
      arg.offset,
      arg.length
    );
  }
};

const getValueAsVector = (value: Value): Vector => {
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

const makeComparison = (
  name: string,
  impl: (a: number, b: number) => number
): Internal => {
  return {
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
      return {
        code: args.reduce((accum, el, i, arr) => {
          if (i == arr.length - 1) {
            return accum;
          }
          return i > 0
            ? `${accum} && ${el.code} ${name} ${arr[i + 1].code}`
            : `${el.code} ${name} ${arr[i + 1].code}`;
        }, ""),
        type: args[0].type,
      };
    },
  };
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
    impl: (args) => (args.length === 0 ? kEmptyList : makeList(args)),
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
        return makeList(list.slice(1));
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
          code: args.map((el) => el.code).join(" + "),
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
          code: args.map((el) => el.code).join(" - "),
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
          code: args.map((el) => el.code).join(" * "),
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
        return { code: `1.0 / ${args[0].code}`, type: args[0].type };
      } else {
        return {
          code: args.map((el) => el.code).join(" / "),
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
  fnOfOne("atan", Math.atan),
  fnOfOne("radians", (x) => (x * Math.PI) / 180),
  fnOfOne("degrees", (x) => (x * 180) / Math.PI),

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
  },

  makeComparison("<", (a, b) => (a < b ? 1 : 0)),
  makeComparison("<=", (a, b) => (a <= b ? 1 : 0)),
  makeComparison(">", (a, b) => (a > b ? 1 : 0)),
  makeComparison(">=", (a, b) => (a <= b ? 1 : 0)),
  makeComparison("eq", (a, b) => (a == b ? 1 : 0)),
  makeComparison("neq", (a, b) => (a != b ? 1 : 0)),

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
  },
];

interface MacroDef {
  name: string;
  symbols: string[];
  body: string;
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
  },
  {
    name: "max-vec",
    symbols: ["v"],
    body: "(max (get-x v) (get-y v) (get-z v))",
  },
];

const kShapes: MacroDef[] = [
  {
    name: "union",
    symbols: ["...c"],
    body: "`(shape union ,@c)",
  },
  {
    name: "intersect",
    symbols: ["...c"],
    body: "`(shape intersect ,@c)",
  },
  {
    name: "difference",
    symbols: ["...c"],
    body: "`(shape difference ,@c)",
  },
  {
    name: "scale",
    symbols: ["s", "c"],
    body: "`(shape scale ,s ,c)",
  },
  {
    name: "translate",
    symbols: ["v", "c"],
    body: "`(shape translate ,v ,c)",
  },
  {
    name: "translate-x",
    symbols: ["x", "c"],
    body: "`(let ((xval ,x) (cval ,c)) (shape translate (vec xval 0 0) cval))",
  },
  {
    name: "translate-y",
    symbols: ["y", "c"],
    body: "`(let ((yval ,y) (cval ,c)) (shape translate (vec 0 yval 0) cval))",
  },
  {
    name: "translate-z",
    symbols: ["z", "c"],
    body: "`(let ((zval ,z) (cval ,c)) (shape translate (vec 0 0 zval) cval))",
  },
  {
    name: "rotate",
    symbols: ["a", "theta", "c"],
    body: "`(shape rotate ,a ,theta ,c)",
  },
  {
    name: "rotate-x",
    symbols: ["theta", "c"],
    body: "`(shape rotate #<1 0 0> ,theta ,c)",
  },
  {
    name: "rotate-y",
    symbols: ["theta", "c"],
    body: "`(shape rotate #<0 1 0> ,theta ,c)",
  },
  {
    name: "rotate-z",
    symbols: ["theta", "c"],
    body: "`(shape rotate #<0 0 1> ,theta ,c)",
  },
  {
    name: "smooth",
    symbols: ["k", "c"],
    body: "`(shape smooth ,k ,c)",
  },
  {
    name: "abrupt",
    symbols: [".c"],
    body: "`(shape smooth 0 ,c)",
  },
  {
    name: "ellipsoid",
    symbols: ["p", "r"],
    body: "`(shape ellipsoid ,p ,r)",
  },
  {
    name: "sphere",
    symbols: ["p", "r"],
    body: "`(shape sphere ,p ,r)",
  },
  {
    name: "box",
    symbols: ["c", "s"],
    body: "`(shape box ,c ,s)",
  },
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
        },
        offset: 0,
        length: 0,
      });
    } catch (err) {
      throw new Error(`Error adding shape '${b.name}': ${err}`);
    }
  }
};
