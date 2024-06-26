import { Env } from "./env";
import { print } from "./print";

export class DslEvalError extends Error {
  readonly offset: number;
  readonly length: number;

  constructor(msg: string, offset: number, length?: number) {
    super(msg);
    this.offset = offset;
    this.length = length === undefined ? 0 : length;
  }
}

export class DslGeneratorError extends Error {
  readonly offset: number;
  readonly length: number;

  constructor(msg: string, offset: number, length?: number) {
    super(msg);
    this.offset = offset;
    this.length = length === undefined ? 0 : length;
  }
}

export interface Token {
  type: "punctuation" | "identifier" | "number";
  offset: number;
  value: string | number | Vector;
  reader?: boolean;
}

export interface Vector {
  x: number;
  y: number;
  z: number;
}

export const isVector = (value: any): value is Vector => {
  return (
    value &&
    typeof value === "object" &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.z === "number"
  );
};

export interface Value {
  type: "number" | "vector";
  value: number | Vector;
  offset: number;
  length: number;
}

export const isValue = (exp: Expression): exp is Value => {
  return (
    (exp.type === "number" && typeof exp.value === "number") ||
    (exp.type === "vector" && isVector(exp.value))
  );
};

export interface Expression {
  type:
    | "null"
    | "list"
    | "identifier"
    | "vector"
    | "number"
    | "shape"
    | "lambda"
    | "internal"
    | "macro"
    | "placeholder"
    | "error"
    | "generated";
  value:
    | Expression
    | Expression[]
    | string
    | Vector
    | number
    | Shape
    | Lambda
    | Internal
    | Macro
    | Generated;
  offset: number;
  length: number;
}

export const isExpression = (obj: any): obj is Expression => {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.type === "string" &&
    Reflect.has(obj, "value")
  );
};

export interface Lambda {
  symbols: string[];
  body: Expression;
  closure: Env;
}

export interface Internal {
  name: string;
  impl: (args: Expression[]) => Expression;
  generate?: (args: Generated[]) => Generated;
}

export const kEmptyList: Expression = {
  type: "null",
  value: [],
  offset: 0,
  length: 0,
};

export interface Shape {
  type: string;
  args: Expression[];
}

export interface Macro {
  name: string;
  symbols: string[];
  body: Expression;
  closure: Env;
}

export type GeneratedType = "float" | "vec" | "sdf" | "void";

export interface Generated {
  code: string;
  type: GeneratedType;
}

export const isTruthy = (expr: Expression): boolean => {
  return expr.type !== "null" && !(expr.type === "number" && expr.value === 0);
};

export const isSpecial = (name: string): boolean =>
  !!name.match(
    /^(if|define|set\!|lambda|let|begin|quote|quasi-quote|shape|placeholder)$/
  );

export const isNumber = (expr: Expression): boolean => expr.type === "number";

export const makeNumber = (
  value: number,
  offset: number,
  length: number
): Value => {
  return { type: "number", value: value, offset: offset, length: length };
};

export const makeVector = (
  x: number,
  y: number,
  z: number,
  offset: number,
  length: number
): Value => {
  return {
    type: "vector",
    value: { x: x, y: y, z: z },
    offset: offset,
    length: length,
  };
};

export const isShape = (expr: Expression): boolean => expr.type === "shape";
export const isTransform = (expr: Expression): boolean => {
  if (isShape(expr)) {
    const shape = expr.value as Shape;
    return (
      shape.type === "scale" ||
      shape.type === "rotate" ||
      shape.type === "translate"
    );
  }
  return false;
};

export const isVectorName = (name: string) => !!name.match(/\.[xyz]$/);

export const isPlaceholder = (expr: Expression): boolean =>
  expr.type === "placeholder";

export const isPlaceholderVar = (expr: Expression): boolean =>
  expr.type === "placeholder" && isIdentifier(expr.value as Expression);

export const makePlaceholder = (expr: Expression): Expression => ({
  ...expr,
  type: "placeholder",
  value: expr,
});

export const isIdentifier = (expr: Expression): boolean =>
  expr.type === "identifier";

export const makeIdentifier = (symbol: string, offset: number): Expression => ({
  type: "identifier",
  value: symbol,
  offset: offset,
  length: symbol.length,
});

export const isList = (expr: Expression): boolean =>
  expr.type === "null" || expr.type === "list";

export const makeList = (exprs: Expression[]): Expression =>
  exprs.length === 0
    ? kEmptyList
    : {
        type: "list",
        value: exprs,
        offset: exprs[0].offset,
        length: exprs.reduce(
          (best, el) => Math.max(best, el.offset + el.length),
          0
        ),
      };

export const makeIdList = (symbol: string, exprs: Expression[]): Expression =>
  makeList([
    makeIdentifier(symbol, exprs.length > 0 ? exprs[0].offset : 0),
    ...exprs,
  ]);

export const isIdList = (expr: Expression, id: string): boolean =>
  id === getIdList(expr);

export const getIdList = (expr: Expression): string | false => {
  if (isList(expr)) {
    const list = expr.value as Expression[];
    if (list.length > 0) {
      if (isIdentifier(list[0])) {
        return list[0].value as string;
      }
    }
  }
  return false;
};

export const makeError = (
  msg: string,
  offset: number,
  length: number
): Expression => ({
  type: "error",
  value: msg,
  offset: offset,
  length: length,
});

export const dslError = (
  strings: TemplateStringsArray,
  ...exprs: any[]
): Expression => {
  const result: string[] = [];
  let start = 1e5;
  let end = 0;

  for (let i = 0; i < exprs.length; i++) {
    result.push(strings[i]);
    const curr = exprs[i];
    if (isExpression(curr)) {
      result.push(print(curr));
      start = Math.min(start, curr.offset);
      end = Math.max(end, curr.offset + length);
    } else {
      result.push(curr.toString());
    }
  }
  result.push(strings[exprs.length]);

  return makeError(
    result.join(""),
    end >= start ? start : 0,
    end >= start ? end - start : 0
  );
};
