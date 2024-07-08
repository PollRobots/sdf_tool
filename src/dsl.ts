import { Env } from "./env";
import { printExpr } from "./print";

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
  docs?: string[];
}

export interface Internal {
  name: string;
  impl: (args: Expression[]) => Expression;
  generate?: (args: Generated[]) => Generated;
  docs?: string[];
}

export const kEmptyList: ExpressionList = {
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
  docs?: string[];
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
    /^(if|define|set\!|lambda|let|begin|quote|quasi-quote|shape|placeholder|smoothcase)$/
  );

interface ExpressionNumber {
  type: "number";
  value: number;
  offset: number;
  length: number;
}

export const isNumber = (expr: Expression): expr is ExpressionNumber =>
  expr.type === "number";

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

export const isGenerated = (expr: Expression): boolean =>
  expr.type === "generated";

export const isVectorName = (name: string) => !!name.match(/\.[xyz]$/);

interface ExpressionPlaceholder {
  type: "placeholder";
  value: Expression;
  offset: number;
  length: number;
}

export const isPlaceholder = (
  expr: Expression
): expr is ExpressionPlaceholder => expr.type === "placeholder";

export const hasPlaceholder = (expr: Expression): boolean => {
  switch (expr.type) {
    case "placeholder":
      return true;
    case "list":
      return (expr.value as Expression[]).some(hasPlaceholder);
    case "shape":
      return (expr.value as Shape).args.some(hasPlaceholder);
    default:
      return false;
  }
};

export const isPlaceholderVar = (expr: Expression): boolean =>
  expr.type === "placeholder" && isIdentifier(expr.value as Expression);

export const makePlaceholder = (expr: Expression): Expression => ({
  ...expr,
  type: "placeholder",
  value: expr,
});

interface ExpressionIdentifier {
  type: "identifier";
  value: string;
  offset: number;
  length: number;
}

export const isIdentifier = (expr: Expression): expr is ExpressionIdentifier =>
  expr.type === "identifier";

export const makeIdentifier = (
  symbol: string,
  offset: number
): ExpressionIdentifier => ({
  type: "identifier",
  value: symbol,
  offset: offset,
  length: symbol.length,
});

interface ExpressionList {
  type: "list" | "null";
  value: Expression[];
  offset: number;
  length: number;
}

export const isList = (expr: Expression): expr is ExpressionList =>
  expr.type === "null" || expr.type === "list";

export const makeList = (...exprs: Expression[]): ExpressionList =>
  exprs.length === 0
    ? kEmptyList
    : {
        type: "list",
        value: exprs,
        offset: exprs[0].offset,
        length:
          exprs.reduce(
            (best, el) => Math.max(best, el.offset + el.length),
            exprs[0].offset
          ) - exprs[0].offset,
      };

export const makeIdList = (
  symbol: string,
  ...exprs: Expression[]
): Expression =>
  makeList(
    makeIdentifier(symbol, exprs.length > 0 ? exprs[0].offset : 0),
    ...exprs
  );

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

export const isError = (expr: Expression): boolean => expr.type === "error";

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
      result.push(printExpr(curr));
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

interface DocumentedValue {
  docs: string[];
}

interface DocumentedObject {
  value: DocumentedValue;
}

const isDocumentedValue = (obj: any): obj is DocumentedValue => {
  return (
    obj &&
    Array.isArray(obj.docs) &&
    obj.docs.every((el: any) => typeof el === "string")
  );
};

export const isDocumentedObject = (obj: any): obj is DocumentedObject => {
  return obj && isDocumentedValue(obj.value);
};
