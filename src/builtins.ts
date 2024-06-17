import {
  Env,
  Expression,
  Internal,
  Value,
  Vector,
  isValue,
  isVector,
  kEmptyList,
  print,
  read,
} from "./dsl";

const requireValueArgs = (name: string, args: Expression[]): Value[] => {
  return args.map((el) => {
    if (!isValue(el)) {
      throw new Error(
        `${name} requires arguments to be numbers or vectors, found ${print(
          el
        )}`
      );
    }
    return el as Value;
  });
};

const requireArity = (
  name: string,
  arity: number,
  args: Expression[]
): void => {
  if (args.length !== arity) {
    throw new Error(
      `${name} requires ${arity} args, called with ${args.length}`
    );
  }
};

const requireMinArity = (
  name: string,
  arity: number,
  args: Expression[]
): void => {
  if (args.length < arity) {
    throw new Error(
      `${name} requires at least ${arity} args, called with ${args.length}`
    );
  }
};

const requireVector = (name: string, pos: number, arg: Expression): void => {
  if (arg.type !== "vector") {
    throw new Error(`${name} requires ${pos} arg to be a vector`);
  }
};

const requireNumber = (name: string, pos: number, arg: Expression): void => {
  if (arg.type !== "number") {
    throw new Error(`${name} requires ${pos} arg to be a number`);
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

const fnOfOne = (
  name: string,
  args: Expression[],
  impl: (x: number) => number
): Expression => {
  requireArity(name, 1, args);
  const values = requireValueArgs(name, args);
  const a = values[0];
  if (a.type === "number") {
    return {
      type: "number",
      value: impl(a.value as number),
    };
  } else {
    const vec = values[0].value as Vector;
    return {
      type: "vector",
      value: { x: impl(vec.x), y: impl(vec.y), z: impl(vec.z) },
    };
  }
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
        return { type: "vector", value: res };
      } else {
        let last = values[0].value as number;
        for (const curr of values.slice(1)) {
          const n = curr.value as number;
          if (impl(last, n) == 0) {
            return { type: "number", value: 0 };
          } else {
            last = n;
          }
        }
        return { type: "number", value: 1 };
      }
    },
  };
};

const makeSwizzle = (name: string): Internal => {
  return {
    name: name,
    impl: (args) => {
      requireArity(name, 1, args);
      requireVector(name, 0, args[0]);
      const vec = args[0].value as any;
      return {
        type: "vector",
        value: { x: vec[name[0]], y: vec[name[1]], z: vec[name[2]] },
      };
    },
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

const kBuiltins: Internal[] = [
  {
    name: "list",
    impl: (args) =>
      args.length === 0 ? kEmptyList : { type: "list", value: args },
  },
  {
    name: "+",
    impl: (args) => {
      const accum: Value = { type: "number", value: 0 };
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
  },

  {
    name: "-",
    impl: (args) => {
      if (args.length === 0) {
        return { type: "number", value: 0 };
      }
      const values = requireValueArgs("-", args);
      const accum = { ...values[0] };
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
  },

  {
    name: "*",
    impl: (args) => {
      const accum: Value = { type: "number", value: 1 };
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
  },

  {
    name: "/",
    impl: (args) => {
      if (args.length === 0) {
        return { type: "number", value: 1 };
      }
      const values = requireValueArgs("/", args);
      if (values.length === 1) {
        // (/ a) is equivalent to (/ 1 a)
        values.unshift({ type: "number", value: 1 });
      }
      const accum = { ...values[0] };
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
  },

  {
    name: "dot",
    impl: (args) => {
      requireArity("dot", 2, args);
      requireVector("dot", 0, args[0]);
      requireVector("dot", 1, args[1]);
      const a = args[0].value as Vector;
      const b = args[1].value as Vector;

      return { type: "number", value: a.x * b.x + a.y * b.y + a.z * b.z };
    },
  },

  {
    name: "cross",
    impl: (args) => {
      requireArity("cross", 2, args);
      requireVector("cross", 0, args[0]);
      requireVector("cross", 1, args[1]);
      const a = args[0].value as Vector;
      const b = args[1].value as Vector;

      return {
        type: "vector",
        value: {
          x: a.y * b.z - b.y * a.z,
          y: a.z * b.x - b.z * a.x,
          z: a.x * b.y - b.x * a.y,
        },
      };
    },
  },

  { name: "abs", impl: (args) => fnOfOne("abs", args, Math.abs) },
  { name: "floor", impl: (args) => fnOfOne("floor", args, Math.floor) },
  { name: "ceil", impl: (args) => fnOfOne("ceil", args, Math.ceil) },
  { name: "sqrt", impl: (args) => fnOfOne("sqrt", args, Math.sqrt) },
  { name: "sin", impl: (args) => fnOfOne("sin", args, Math.sin) },
  { name: "cos", impl: (args) => fnOfOne("cos", args, Math.cos) },
  { name: "tan", impl: (args) => fnOfOne("tan", args, Math.tan) },
  { name: "asin", impl: (args) => fnOfOne("asin", args, Math.asin) },
  { name: "acos", impl: (args) => fnOfOne("acos", args, Math.acos) },
  { name: "atan", impl: (args) => fnOfOne("atan", args, Math.atan) },
  {
    name: "radians",
    impl: (args) => fnOfOne("radians", args, (x) => (x * Math.PI) / 180),
  },
  {
    name: "degrees",
    impl: (args) => fnOfOne("degrees", args, (x) => (x * 180) / Math.PI),
  },

  {
    name: "min",
    impl: (args) => {
      if (args.length === 0) {
        return { type: "number", value: 0 };
      }
      const values = requireValueArgs("min", args);
      const accum = { ...values[0] };
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
  },

  {
    name: "max",
    impl: (args) => {
      if (args.length === 0) {
        return { type: "number", value: 0 };
      }
      const values = requireValueArgs("max", args);
      const accum = { ...values[0] };
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
  },

  {
    name: "get-x",
    impl: (args) => {
      requireArity("get-x", 1, args);
      requireVector("get-x", 0, args[0]);
      const vec = args[0].value as Vector;
      return {
        type: "number",
        value: vec.x,
      };
    },
  },

  {
    name: "get-y",
    impl: (args) => {
      requireArity("get-y", 1, args);
      requireVector("get-y", 0, args[0]);
      const vec = args[0].value as Vector;
      return {
        type: "number",
        value: vec.y,
      };
    },
  },

  {
    name: "get-z",
    impl: (args) => {
      requireArity("get-z", 1, args);
      requireVector("get-z", 0, args[0]);
      const vec = args[0].value as Vector;
      return {
        type: "number",
        value: vec.z,
      };
    },
  },

  {
    name: "vec",
    impl: (args) => {
      requireArity("vec", 3, args);
      requireNumber("vec", 0, args[0]);
      requireNumber("vec", 1, args[1]);
      requireNumber("vec", 2, args[2]);
      return {
        type: "vector",
        value: {
          x: args[0].value as number,
          y: args[1].value as number,
          z: args[2].value as number,
        },
      };
    },
  },

  {
    name: "pow",
    impl: (args) => {
      requireArity("pow", 2, args);
      const values = requireValueArgs("pow", args);
      if (values[0].type === "number" && values[1].type === "number") {
        return {
          type: "number",
          value: Math.pow(values[0].value as number, values[1].value as number),
        };
      } else {
        const a = getValueAsVector(values[0]);
        const b = getValueAsVector(values[1]);

        return {
          type: "vector",
          value: {
            x: Math.pow(a.x, b.x),
            y: Math.pow(a.y, b.y),
            z: Math.pow(a.z, b.z),
          },
        };
      }
    },
  },

  makeComparison("<", (a, b) => (a < b ? 1 : 0)),
  makeComparison("<=", (a, b) => (a <= b ? 1 : 0)),
  makeComparison(">", (a, b) => (a > b ? 1 : 0)),
  makeComparison(">=", (a, b) => (a <= b ? 1 : 0)),
  makeComparison("eq", (a, b) => (a == b ? 1 : 0)),
  makeComparison("neq", (a, b) => (a != b ? 1 : 0)),

  ...makeAllSwizzles(),
];

interface MacroDef {
  name: string;
  symbols: string[];
  body: string;
}

const kMacros: MacroDef[] = [
  {
    name: "splat",
    symbols: ["a"],
    body: "`(let ((val ,a)) (vec val val val))",
  },
  {
    name: "min-vec",
    symbols: ["a"],
    body: "`(let ((v ,a)) (min (get-x v) (get-y v) (get-z v)))",
  },
  {
    name: "max-vec",
    symbols: ["a"],
    body: "`(let ((v ,a)) (max (get-x v) (get-y v) (get-z v)))",
  },
  {
    name: "normalize",
    symbols: ["a"],
    body: "`(let ((v ,a)) (/ v length(v))",
  },
  {
    name: "length",
    symbols: ["a"],
    body: "`(sqrt (dot ,a))",
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
  for (const b of kBuiltins) {
    env.set(b.name, { type: "internal", value: b });
  }
  for (const b of kMacros) {
    env.set(b.name, {
      type: "macro",
      value: {
        name: b.name,
        symbols: b.symbols,
        body: readOne(b.name, b.body),
        closure: env,
      },
    });
  }
};
