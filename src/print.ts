import { Expression, isVector, Shape, Internal, Lambda } from "./dsl";

export const print = (expr: Expression): string => {
  switch (expr.type) {
    case "null":
      return "()";
    case "list":
      if (!Array.isArray(expr.value)) {
        throw new Error("Expecting array for list");
      }
      const list = expr.value as Expression[];
      if (list.length === 0) {
        return "()";
      } else {
        return `(${list.map((el) => print(el)).join(" ")})`;
      }
    case "identifier":
      if (typeof expr.value !== "string") {
        throw new Error("Expecting string for identifier");
      }
      return expr.value as string;
    case "number":
      if (typeof expr.value !== "number") {
        throw new Error("Expecting number");
      }
      return (expr.value as number).toString();
    case "vector":
      if (!isVector(expr.value)) {
        throw new Error("Expecting vector");
      }
      return `#<${expr.value.x} ${expr.value.y} ${expr.value.z}>`;
    case "shape":
      const shape = expr.value as Shape;
      return `#shape<${shape.type}: ${shape.args.map(print).join(" ")}>`;
    case "internal":
      return `#internal<${(expr.value as Internal).name}>`;
    case "lambda":
      return `#lambda<${(expr.value as Lambda).symbols.join(" ")}>`;
    case "error":
      return `#error<${expr.value}>`;
  }
};
