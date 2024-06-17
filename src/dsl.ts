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
    | "macro";
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

export const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];

  const identifier_re = /[a-zA-Z0-9_+\-*\/<>=]+/;

  let offset = 0;
  let start = 0;
  let mode: "base" | "comment" | "pound" | "number" | "identifier" | "vector" =
    "base";
  let accum = "";
  for (const ch of input + " ") {
    let repeat = true;
    while (repeat) {
      repeat = false;
      switch (mode) {
        case "base":
          if (ch == "(" || ch == ")" || ch == "'" || ch == "`" || ch == ",") {
            tokens.push({ type: "punctuation", offset: offset, value: ch });
          } else if (ch.match(/\s/)) {
            // skip whitespace
          } else if (ch == ";") {
            mode = "comment";
          } else if (ch == "#") {
            mode = "pound";
            start = offset;
          } else if (ch.match(/[\d+-]/)) {
            mode = "number";
            start = offset;
            accum = ch;
          } else if (ch.match(identifier_re)) {
            mode = "identifier";
            start = offset;
            accum = ch;
          } else {
            throw new Error(`Unexpected character '${ch}' at ${offset}`);
          }
          break;
        case "comment":
          if (ch == "\n") {
            mode = "base";
          }
          break;
        case "pound":
          if (ch == "<") {
            mode = "vector";
            accum = "#<";
          } else {
            throw new Error(`Unexpected reader sequence '#${ch}' at ${offset}`);
          }
          break;
        case "number":
          if (ch.match(/[\s();]/)) {
            if (accum == "+" || accum == "-") {
              mode = "identifier";
              repeat = true;
              break;
            }
            const n = Number(accum);
            if (isNaN(n)) {
              throw new Error(`Invalid number '${accum}' at ${start}`);
            }
            tokens.push({
              type: "number",
              offset: start,
              value: n,
            });

            mode = "base";
            repeat = true;
          } else {
            accum += ch;
          }
          break;
        case "identifier":
          if (ch.match(/[\s();]/)) {
            if (!accum.match(identifier_re)) {
              throw new Error(`Invalid identifier '${accum}' at ${start}`);
            }
            tokens.push({
              type: "identifier",
              offset: start,
              value: accum,
            });

            mode = "base";
            repeat = true;
          } else {
            accum += ch;
          }
          break;
        case "vector":
          if (ch === ">") {
            accum += ">";
            try {
              const vector_tokens = tokenize(accum.slice(2, accum.length - 1));
              tokens.push(
                {
                  type: "punctuation",
                  offset: start,
                  value: "(",
                  reader: true,
                },
                {
                  type: "identifier",
                  offset: start,
                  value: "vec",
                  reader: true,
                }
              );
              for (const vt of vector_tokens) {
                tokens.push({
                  type: vt.type,
                  offset: vt.offset + start + 2,
                  value: vt.value,
                });
              }
              tokens.push({
                type: "punctuation",
                offset: offset,
                value: ")",
                reader: true,
              });
              mode = "base";
            } catch (err) {
              throw new Error(`Error parsing vector '${accum}' at ${start}`);
            }
          } else {
            accum += ch;
          }
          break;
        default:
          throw new Error(`Unknown internal state '${mode}'`);
      }
    }
    offset++;
  }

  return tokens;
};

export const parse = (tokens: Token[]): Expression[] => {
  const res: Expression[] = [];
  const lists: Expression[][] = [];
  type ReaderMacro = (expr: Expression) => Expression;
  const readerMacros: string[] = [];
  let currReaderMacro: string | undefined = undefined;

  const addExpression = (expr: Expression) => {
    if (currReaderMacro) {
      expr = {
        type: "list",
        value: [{ type: "identifier", value: currReaderMacro }, expr],
      };
      currReaderMacro = undefined;
    }

    if (lists.length == 0) {
      res.push(expr);
    } else {
      lists[lists.length - 1].push(expr);
    }
  };

  while (tokens.length > 0) {
    const curr = tokens.shift();
    switch (curr.type) {
      case "punctuation":
        if (curr.value === "(") {
          // create new list
          lists.push([]);
          readerMacros.push(currReaderMacro);
          currReaderMacro = undefined;
        } else if (curr.value === ")") {
          // pop current list and add to result
          if (lists.length == 0) {
            throw new Error(`Unexpected ')' at ${curr.offset}`);
          }
          const top = lists.pop();
          currReaderMacro = readerMacros.pop();

          const list: Expression =
            top.length == 0 ? kEmptyList : { type: "list", value: top };
          addExpression(list);
        } else if (curr.value === "'") {
          currReaderMacro = "quote";
        } else if (curr.value === "`") {
          currReaderMacro = "quasi-quote";
        } else if (curr.value === ",") {
          currReaderMacro = "unquote";
        } else {
          throw new Error(
            `Unknown punctuation '${curr.value}' at ${curr.offset}`
          );
        }
        break;
      case "identifier":
        addExpression({
          type: "identifier",
          value: curr.value,
        });
        break;
      case "number":
        addExpression({ type: "number", value: curr.value });
        break;
    }
  }
  if (lists.length !== 0) {
    throw new Error(`${lists.length} unterminated lists`);
  }
  return res;
};

export const read = (input: string): Expression[] => {
  return parse(tokenize(input));
};

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
      return `#shape<${(expr.value as Shape).args.map(print).join(" ")}>`;
    case "internal":
      return `#internal<${(expr.value as Internal).name}>`;
    case "lambda":
      return `#lambda<${(expr.value as Lambda).symbols.join(" ")}>`;
  }
};

export class Env {
  parent?: Env;
  values: Map<string, Expression> = new Map();

  constructor(parent: Env | undefined = undefined) {
    this.parent = parent;
  }

  has(name: string, local: boolean = false): boolean {
    if (this.values.has(name)) {
      return true;
    } else if (!local && this.parent) {
      return this.parent.has(name);
    } else {
      return false;
    }
  }

  get(name: string): Expression | undefined {
    const local = this.values.get(name);
    if (local) {
      return local;
    } else if (this.parent) {
      return this.parent.get(name);
    } else {
      return;
    }
  }

  set(name: string, exp: Expression) {
    if (this.values.has(name)) {
      throw new Error(`Cannot mutate value of '${name}'`);
    }
    this.values.set(name, exp);
  }
}

const isSpecial = (name: string): boolean =>
  !!name.match(/^(if|define|lambda|let|begin|quote|quasi-quote)$/);

const isTruthy = (expr: Expression): boolean => {
  return expr.type !== "null" && !(expr.type === "number" && expr.value === 0);
};

export const evaluate = (expr: Expression, env: Env): Expression => {
  switch (expr.type) {
    case "list":
      const list = expr.value as Expression[];
      if (list.length < 1) {
        throw new Error("Should never have an empty list at eval time");
      }
      const head = list[0];
      if (head.type === "identifier" && isSpecial(head.value as string)) {
        const proc = head.value as string;
        switch (proc) {
          // special forms
          case "if":
            // must have two or three args
            if (list.length < 3 || list.length > 4) {
              throw new Error(`if should have two or three arguments`);
            }
            const test = evaluate(list[1], env);
            if (isTruthy(test)) {
              return evaluate(list[2], env);
            } else if (list.length === 4) {
              return evaluate(list[3], env);
            } else {
              return kEmptyList;
            }

          case "define":
            if (list.length != 3) {
              throw new Error(
                `define must have two arguments, not ${list.length - 1}`
              );
            }
            if (list[1].type !== "identifier") {
              throw new Error(
                `first argument for define must be an identifier`
              );
            }
            env.set(list[1].value as string, evaluate(list[2], env));
            return kEmptyList;

          case "lambda":
            if (list.length != 3) {
              throw new Error(
                `lambda must have two arguments, not ${list.length - 1}`
              );
            }
            if (list[1].type !== "list" && list[1].type !== "null") {
              throw new Error(`First argument to lambda must be a list`);
            }
            const symbols = list[1].value as Expression[];
            if (symbols.some((el) => el.type !== "identifier")) {
              throw new Error(
                `First argument to lambda must be a list of symbols`
              );
            }

            return {
              type: "lambda",
              value: {
                symbols: symbols.map((el) => el.value as string),
                body: list[2],
                closure: env,
              },
            };

          case "let":
            if (list.length != 3) {
              throw new Error(
                `let must have 2 arguments, not ${list.length - 1}`
              );
            }
            if (list[1].type !== "list" && list[1].type !== "null") {
              throw new Error(`First argument to let must be a list`);
            }
            const let_symbols: Expression[] = [];
            const let_exprs: Expression[] = [];
            for (const el of list[1].value as Expression[]) {
              const el_list = el.value as Expression[];
              if (el.type !== "list" || el_list.length !== 2) {
                throw new Error(`let init list elements must be a list of 2`);
              }
              let_symbols.push(el_list[0]);
              let_exprs.push(el_list[1]);
            }
            // build the lambda expression
            const let_lambda: Expression = {
              type: "list",
              value: [
                { type: "identifier", value: "lambda" },
                { type: "list", value: let_symbols },
                list[2],
              ],
            };
            return evaluate(
              { type: "list", value: [let_lambda, ...let_exprs] },
              env
            );

          case "begin":
            let result = kEmptyList;
            for (const expr of list.slice(1)) {
              result = evaluate(expr, env);
            }
            return result;
          case "quote":
            if (list.length != 2) {
              throw new Error(
                `quote must have 1 argument, not ${list.length - 1}`
              );
            }
            return list[1];
          case "quasi-quote":
            if (list.length != 2) {
              throw new Error(
                `quote must have 1 argument, not ${list.length - 1}`
              );
            }
            const unquote = (
              expr: Expression,
              splicing: boolean
            ): Expression | Expression[] => {
              if (expr.type !== "list") {
                throw new Error("Expecting list");
              }
              const list = expr.value as Expression[];
              const op = splicing ? "unquote-splicing" : "unquote";
              if (list[0].value !== op || list.length !== 2) {
                throw new Error(`Expecting ${op}`);
              } else if (list.length !== 2) {
                throw new Error(
                  `${op} must have 1 argument, not ${list.length - 1}`
                );
              }
              const res = evaluate(list[1], env);
              if (!splicing) {
                return res;
              }
              if (res.type !== "list" && test.type !== "null") {
                throw new Error(`unquote-splicing can only splice a list`);
              }
              return res.value as Expression[];
            };

            const qq_list = (l: Expression[]): Expression[] =>
              l
                .map((el) => {
                  if (el.type === "list") {
                    const list = el.value as Expression[];
                    if (list[0].value === "unquote") {
                      return unquote(el, false);
                    } else if (list[0].value === "unquote-splicing") {
                      return unquote(el, true);
                    } else {
                      el = {
                        type: "list",
                        value: qq_list(list),
                      };
                    }
                  }
                  return el;
                })
                .flat();

            if (list[1].type === "list") {
              return {
                type: "list",
                value: qq_list(list[1].value as Expression[]),
              };
            } else {
              return list[1];
            }
          default:
            throw new Error(`Unexpected special form: ${proc}`);
        }
      } else {
        const fn = evaluate(head, env);
        if (fn.type === "lambda") {
          const args = list.slice(1).map((el) => evaluate(el, env));
          const lambda = fn.value as Lambda;
          if (args.length != lambda.symbols.length) {
            throw new Error(
              `lambda expected ${lambda.symbols.length} args, got ${args.length}`
            );
          }
          const lambda_env = new Env(lambda.closure);
          lambda.symbols.forEach((el, i) => lambda_env.set(el, args[i]));
          return evaluate(lambda.body, lambda_env);
        } else if (fn.type === "macro") {
          const args = list.slice(1);
          const macro = fn.value as Macro;
          if (args.length != macro.symbols.length) {
            throw new Error(
              `macro expected ${macro.symbols.length} args, got ${args.length}`
            );
          }
          const macro_env = new Env(env);
          macro.symbols.forEach((el, i) => macro_env.set(el, args[i]));
          return evaluate(evaluate(macro.body, macro_env), macro.closure);
        } else if (fn.type === "internal") {
          const args = list.slice(1).map((el) => evaluate(el, env));
          return (fn.value as Internal).impl(args);
        } else {
          throw new Error(`Cannot evaluate ${print(head)}`);
        }
      }
      break;
    case "identifier":
      return env.get(expr.value as string) || kEmptyList;
    default:
      return expr;
  }
};
