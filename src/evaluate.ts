import { Env } from "./env";
import {
  Expression,
  isTruthy,
  kEmptyList,
  Lambda,
  Macro,
  Internal,
  Shape,
} from "./dsl";
import { print } from "./print";

const isSpecial = (name: string): boolean =>
  !!name.match(/^(if|define|set\!|lambda|let|begin|quote|quasi-quote|shape)$/);

export const evaluate = (expr: Expression, env: Env): Expression => {
  switch (expr.type) {
    case "list":
      const list = expr.value as Expression[];
      if (list.length < 1) {
        return {
          type: "error",
          value: "Should never have an empty list at eval time",
        };
      }
      const head = list[0];
      if (head.type === "identifier" && isSpecial(head.value as string)) {
        const proc = head.value as string;
        switch (proc) {
          // special forms
          case "if":
            // must have two or three args
            if (list.length < 3 || list.length > 4) {
              return {
                type: "error",
                value: `if should have two or three arguments`,
              };
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
          case "set!":
            if (list.length != 3) {
              return {
                type: "error",
                value: `define must have two arguments, not ${list.length - 1}`,
              };
            }
            if (list[1].type !== "identifier") {
              return {
                type: "error",
                value: `first argument for define must be an identifier`,
              };
            }
            env.set(
              list[1].value as string,
              evaluate(list[2], env),
              proc === "set!"
            );
            return kEmptyList;

          case "lambda":
            if (list.length != 3) {
              return {
                type: "error",
                value: `lambda must have two arguments, not ${list.length - 1}`,
              };
            }
            if (list[1].type !== "list" && list[1].type !== "null") {
              return {
                type: "error",
                value: `First argument to lambda must be a list`,
              };
            }
            const symbols = list[1].value as Expression[];
            if (symbols.some((el) => el.type !== "identifier")) {
              return {
                type: "error",
                value: `First argument to lambda must be a list of symbols`,
              };
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
              return {
                type: "error",
                value: `let must have 2 arguments, not ${list.length - 1}`,
              };
            }
            if (list[1].type !== "list" && list[1].type !== "null") {
              return {
                type: "error",
                value: `First argument to let must be a list`,
              };
            }
            const let_symbols: Expression[] = [];
            const let_exprs: Expression[] = [];
            for (const el of list[1].value as Expression[]) {
              const el_list = el.value as Expression[];
              if (el.type !== "list" || el_list.length !== 2) {
                return {
                  type: "error",
                  value: `let init list elements must be a list of 2`,
                };
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
              return {
                type: "error",
                value: `quote must have 1 argument, not ${list.length - 1}`,
              };
            }
            return list[1];
          case "quasi-quote":
            if (list.length != 2) {
              return {
                type: "error",
                value: `quote must have 1 argument, not ${list.length - 1}`,
              };
            }
            const unquote = (
              expr: Expression,
              splicing: boolean
            ): Expression | Expression[] => {
              if (expr.type !== "list") {
                return { type: "error", value: "Expecting list" };
              }
              const list = expr.value as Expression[];
              const op = splicing ? "unquote-splicing" : "unquote";
              if (list[0].value !== op || list.length !== 2) {
                return { type: "error", value: `Expecting ${op}` };
              } else if (list.length !== 2) {
                return {
                  type: "error",
                  value: `${op} must have 1 argument, not ${list.length - 1}`,
                };
              }
              const res = evaluate(list[1], env);
              if (!splicing) {
                return res;
              }
              if (res.type !== "list" && res.type !== "null") {
                return {
                  type: "error",
                  value: `unquote-splicing can only splice a list`,
                };
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
                .filter((el) => !Array.isArray(el) || el.length > 0)
                .flat();

            if (list[1].type === "list") {
              return {
                type: "list",
                value: qq_list(list[1].value as Expression[]),
              };
            } else {
              return list[1];
            }
          case "shape":
            if (list.length < 2 || list[1].type !== "identifier") {
              return {
                type: "error",
                value: `shape must have an identifier as the first argument`,
              };
            }
            const shape: Shape = {
              type: list[1].value as string,
              args: list.slice(2).map((expr) => evaluate(expr, env)),
            };
            return { type: "shape", value: shape };
          default:
            return { type: "error", value: `Unexpected special form: ${proc}` };
        }
      } else {
        const fn = evaluate(head, env);
        if (fn.type === "lambda") {
          const args = list.slice(1).map((el) => evaluate(el, env));
          const lambda = fn.value as Lambda;
          if (args.length != lambda.symbols.length) {
            return {
              type: "error",
              value: `lambda expected ${lambda.symbols.length} args, got ${args.length}`,
            };
          }
          const lambda_env = new Env(lambda.closure);
          lambda.symbols.forEach((el, i) => lambda_env.set(el, args[i]));
          return evaluate(lambda.body, lambda_env);
        } else if (fn.type === "macro") {
          const args = list.slice(1);
          const macro = fn.value as Macro;
          const last_symbol =
            macro.symbols.length > 0
              ? macro.symbols[macro.symbols.length - 1]
              : "";
          if (last_symbol.startsWith("...")) {
            if (args.length < macro.symbols.length - 1) {
              return {
                type: "error",
                value: `macro expected at least ${
                  macro.symbols.length - 1
                } args, got ${args.length}`,
              };
            }
            const tail = args.splice(macro.symbols.length - 1);
            if (tail.length > 0) {
              args.push({ type: "list", value: tail });
            } else {
              args.push(kEmptyList);
            }
          } else if (args.length != macro.symbols.length) {
            return {
              type: "error",
              value: `macro expected ${macro.symbols.length} args, got ${args.length}`,
            };
          }
          const macro_env = new Env(env);
          macro.symbols.forEach((el, i) =>
            macro_env.set(el.startsWith("...") ? el.substring(3) : el, args[i])
          );
          return evaluate(evaluate(macro.body, macro_env), macro.closure);
        } else if (fn.type === "internal") {
          try {
            const args = list.slice(1).map((el) => evaluate(el, env));
            return (fn.value as Internal).impl(args);
          } catch (err) {
            return { type: "error", value: `${err}` };
          }
        } else {
          return { type: "error", value: `Cannot evaluate ${print(head)}` };
        }
      }
      break;
    case "identifier":
      return env.get(expr.value as string) || kEmptyList;
    default:
      return expr;
  }
};
