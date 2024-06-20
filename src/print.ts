import {
  Expression,
  isVector,
  Shape,
  Internal,
  Lambda,
  isIdentifier,
} from "./dsl";

export const print = (
  expr: Expression,
  undoReaderMacros: boolean = true
): string => {
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
        if (undoReaderMacros && list.length === 2 && isIdentifier(list[0])) {
          // check to pretty-print reader macros
          switch (list[0].value as string) {
            case "quote":
              return `'${print(list[1], true)}`;
            case "quasi-quote":
              return `${"`"}${print(list[1], true)}`;
            case "unquote":
              return `,${print(list[1], true)}`;
            case "unquote-splicing":
              return `,@${print(list[1], true)}`;
            case "placeholder":
              if (isIdentifier(list[1])) {
                return `:${list[1].value}`;
              }
              break;
          }
        }
        return `(${list.map((el) => print(el, undoReaderMacros)).join(" ")})`;
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
      return `#shape<${shape.type}: ${shape.args
        .map((el) => print(el, undoReaderMacros))
        .join(" ")}>`;
    case "internal":
      return `#internal<${(expr.value as Internal).name}>`;
    case "lambda":
      return `#lambda<${(expr.value as Lambda).symbols.join(" ")}>`;
    case "placeholder":
      const retained = expr.value as Expression;
      if (undoReaderMacros && retained.type === "identifier") {
        return `:${retained.value as string}`;
      } else {
        return `(placeholder ${print(retained)})`;
      }
    case "error":
      return `#error<${expr.value}>`;
  }
};
