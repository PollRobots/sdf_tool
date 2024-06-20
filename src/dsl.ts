import { Env } from "./env";
import { print } from "./print";

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
    | "error";
  value:
    | Expression
    | Expression[]
    | string
    | Vector
    | number
    | Shape
    | Lambda
    | Internal
    | Macro;
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
}

export const kEmptyList: Expression = { type: "null", value: [] };

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

export const isTruthy = (expr: Expression): boolean => {
  return expr.type !== "null" && !(expr.type === "number" && expr.value === 0);
};

export const isPlaceholder = (expr: Expression): boolean =>
  expr.type === "placeholder";

export const isPlaceholderVar = (expr: Expression): boolean =>
  expr.type === "placeholder" && isIdentifier(expr.value as Expression);

export const makePlaceholder = (expr: Expression): Expression => ({
  type: "placeholder",
  value: expr,
});

export const isIdentifier = (expr: Expression): boolean =>
  expr.type === "identifier";

export const makeIdentifier = (symbol: string): Expression => ({
  type: "identifier",
  value: symbol,
});

export const isList = (expr: Expression): boolean =>
  expr.type === "null" || expr.type === "list";

export const makeList = (exprs: Expression[]): Expression =>
  exprs.length === 0
    ? kEmptyList
    : {
        type: "list",
        value: exprs,
      };

export const makeIdList = (
  symbol: string,
  exprs: Expression[]
): Expression => ({
  type: "list",
  value: [makeIdentifier(symbol), ...exprs],
});

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

export const makeError = (msg: string): Expression => ({
  type: "error",
  value: msg,
});

export const dslError = (
  strings: TemplateStringsArray,
  ...exprs: any[]
): Expression => {
  const result: string[] = [];

  for (let i = 0; i < exprs.length; i++) {
    result.push(strings[i]);
    const curr = exprs[i];
    if (isExpression(curr)) {
      result.push(print(curr));
    } else {
      result.push(curr.toString());
    }
  }
  result.push(strings[exprs.length]);

  return makeError(result.join(""));
};
