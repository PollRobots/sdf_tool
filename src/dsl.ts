import { Env } from "./env";

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
    | "error";
  value:
    | Expression[]
    | string
    | Vector
    | number
    | Shape
    | Lambda
    | Internal
    | Macro;
}

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
