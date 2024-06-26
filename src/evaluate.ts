import { Env } from "./env";
import {
  Expression,
  isTruthy,
  kEmptyList,
  Lambda,
  Macro,
  Internal,
  Shape,
  isPlaceholder,
  makePlaceholder,
  makeIdList,
  isIdentifier,
  isList,
  makeList,
  makeError,
  dslError,
  makeIdentifier,
  isIdList,
  isPlaceholderVar,
  isSpecial,
  DslEvalError,
} from "./dsl";
import { print } from "./print";

const getUnresolved = (expr: Expression): Map<string, Expression> => {
  const syms = new Map<string, Expression>();

  const inner = (expr: Expression) => {
    switch (expr.type) {
      case "list":
        const list = expr.value as Expression[];
        list.forEach((el) => inner(el));
        break;
      case "identifier":
        syms.set(expr.value as string, expr);
        break;
    }
  };

  inner(expr);

  return syms;
};

export const evaluate = (expr: Expression, env: Env): Expression => {
  /// console.log("evaluate:", print(expr));
  switch (expr.type) {
    case "list":
      const list = expr.value as Expression[];
      if (list.length < 1) {
        return makeError(
          "Should never have an empty list at eval time",
          expr.offset,
          expr.length
        );
      }
      const head = list[0];
      if (head.type === "identifier" && isSpecial(head.value as string)) {
        const proc = head.value as string;
        switch (proc) {
          // special forms
          case "if":
            // must have two or three args
            if (list.length < 3 || list.length > 4) {
              return makeError(
                `if should have two or three arguments`,
                expr.offset,
                expr.length
              );
            }
            const test = evaluate(list[1], env);
            if (isPlaceholder(test)) {
              return makePlaceholder(makeList([head, test, ...list.splice(2)]));
            } else if (isTruthy(test)) {
              return evaluate(list[2], env);
            } else if (list.length === 4) {
              return evaluate(list[3], env);
            } else {
              return kEmptyList;
            }

          case "define":
          case "set!":
            if (list.length != 3) {
              return makeError(
                `define must have two arguments, not ${list.length - 1}`,
                expr.offset,
                expr.length
              );
            }
            if (!isIdentifier(list[1])) {
              return makeError(
                `first argument for define must be an identifier`,
                expr.offset,
                expr.length
              );
            }
            env.set(
              list[1].value as string,
              evaluate(list[2], env),
              proc === "set!"
            );
            return kEmptyList;

          case "lambda":
            if (list.length != 3) {
              return makeError(
                `lambda must have two arguments, not ${list.length - 1}`,
                expr.offset,
                expr.length
              );
            }
            if (!isList(list[1])) {
              return makeError(
                `First argument to lambda must be a list`,
                expr.offset,
                expr.length
              );
            }
            const symbols = list[1].value as Expression[];
            if (!symbols.every(isIdentifier)) {
              return makeError(
                `First argument to lambda must be a list of symbols`,
                expr.offset,
                expr.length
              );
            }

            if (list.length === 3) {
              return {
                type: "lambda",
                value: {
                  symbols: symbols.map((el) => el.value as string),
                  body: list[2],
                  closure: env,
                },
                offset: expr.offset,
                length: expr.length,
              };
            } else {
              return {
                type: "lambda",
                value: {
                  symbols: symbols.map((el) => el.value as string),
                  body: makeIdList("begin", list.slice(2)),
                  closure: env,
                },
                offset: expr.offset,
                length: expr.length,
              };
            }

          case "let":
            if (list.length != 3) {
              return makeError(
                `let must have 2 arguments, not ${list.length - 1}`,
                expr.offset,
                expr.length
              );
            }
            if (!isList(list[1])) {
              return makeError(
                `First argument to let must be a list`,
                list[1].offset,
                list[1].length
              );
            }
            const let_symbols: Expression[] = [];
            const let_exprs: Expression[] = [];
            for (const el of list[1].value as Expression[]) {
              const el_list = el.value as Expression[];
              if (!isList(el) || el_list.length !== 2) {
                return makeError(
                  `let init list elements must be a list of 2`,
                  list[1].offset,
                  list[1].length
                );
              }
              let_symbols.push(el_list[0]);
              let_exprs.push(el_list[1]);
            }
            // build the lambda expression
            const let_lambda = makeIdList("lambda", [
              makeList(let_symbols),
              ...list.slice(2),
            ]);
            return evaluate(makeList([let_lambda, ...let_exprs]), env);

          case "begin":
            let result = kEmptyList;
            for (const expr of list.slice(1)) {
              result = evaluate(expr, env);
            }
            return result;
          case "quote":
            if (list.length != 2) {
              return makeError(
                `quote must have 1 argument, not ${list.length - 1}`,
                expr.offset,
                expr.length
              );
            }
            return list[1];
          case "quasi-quote":
            if (list.length != 2) {
              return makeError(
                `quote must have 1 argument, not ${list.length - 1}`,
                expr.offset,
                expr.length
              );
            }
            const unquote = (
              list: Expression[],
              splicing: boolean
            ): Expression | Expression[] => {
              const op = splicing ? "unquote-splicing" : "unquote";
              if (list[0].value !== op || list.length !== 2) {
                return makeError(`Expecting ${op}`, expr.offset, expr.length);
              } else if (list.length !== 2) {
                return makeError(
                  `${op} must have 1 argument, not ${list.length - 1}`,
                  expr.offset,
                  expr.length
                );
              }
              const res = evaluate(list[1], env);
              if (!splicing) {
                return res;
              }
              if (res.type !== "list" && res.type !== "null") {
                return makeError(
                  `unquote-splicing can only splice a list`,
                  expr.offset,
                  expr.length
                );
              }
              return res.value as Expression[];
            };

            const qq_list = (l: Expression[]): Expression[] =>
              l
                .map((el) => {
                  if (el.type === "list") {
                    const list = el.value as Expression[];
                    if (list[0].value === "unquote") {
                      return unquote(list, false);
                    } else if (list[0].value === "unquote-splicing") {
                      return unquote(list, true);
                    } else {
                      el = makeList(qq_list(list));
                    }
                  }
                  return el;
                })
                .filter((el) => !Array.isArray(el) || el.length > 0)
                .flat();

            if (list[1].type === "list") {
              return makeList(qq_list(list[1].value as Expression[]));
            } else {
              return list[1];
            }
          case "shape":
            if (list.length < 2 || list[1].type !== "identifier") {
              return makeError(
                `shape must have an identifier as the first argument`,
                expr.offset,
                expr.length
              );
            }
            const args = list.slice(2).map((expr) => evaluate(expr, env));
            if (args.some(isPlaceholder)) {
              return makePlaceholder(
                makeIdList("shape", [
                  list[1],
                  ...args.map((arg) =>
                    isPlaceholder(arg) && !isPlaceholderVar(arg)
                      ? (arg.value as Expression)
                      : arg
                  ),
                ])
              );
            } else {
              const shape: Shape = {
                type: list[1].value as string,
                args: args,
              };
              return {
                type: "shape",
                value: shape,
                offset: expr.offset,
                length: expr.length,
              };
            }
          case "placeholder":
            if (list.length !== 2 || list[1].type !== "identifier") {
              return makeError(
                `placeholder must have an identifier as the first argument`,
                expr.offset,
                expr.length
              );
            }
            return makePlaceholder(list[1]);
          default:
            return makeError(
              `Unexpected special form: ${proc}`,
              head.offset,
              head.length
            );
        }
      } else {
        const fn = evaluate(head, env);
        if (fn.type === "lambda") {
          const args = list.slice(1).map((el) => evaluate(el, env));
          const lambda = fn.value as Lambda;
          if (args.length != lambda.symbols.length) {
            return makeError(
              `lambda expected ${lambda.symbols.length} args, got ${args.length}`,
              expr.offset,
              expr.length
            );
          }
          const lambda_env = new Env(lambda.closure);
          lambda.symbols.forEach((el, i) => lambda_env.set(el, args[i]));
          const lambda_res = evaluate(lambda.body, lambda_env);
          if (isPlaceholder(lambda_res) && lambda.symbols.length != 0) {
            const retained = lambda_res.value as Expression;
            const unresolved_syms = getUnresolved(retained);
            if (isIdList(retained, "let")) {
              const retained_list = retained.value as Expression[];
              // let is only the retained expression when a lambda was retained.
              // any symbols defined in the let symbol list cannot be in the unresolved_syms
              // otherwise recursive evaluation will mess things up
              const let_symbols = (retained_list[1].value as Expression[]).map(
                (el) => (el.value as Expression[])[0].value as string
              );
              let_symbols.forEach((sym) => unresolved_syms.delete(sym));
            }
            const recapture = lambda.symbols.filter((el) =>
              unresolved_syms.has(el)
            );
            if (recapture.length == 0) {
              return lambda_res;
            }

            return makePlaceholder(
              makeIdList("let", [
                makeList(
                  recapture.map((el) => {
                    const re_exp = unresolved_syms.get(el) || kEmptyList;
                    return makeList([
                      makeIdentifier(el, re_exp.offset),
                      lambda_env.get(el),
                    ]);
                  })
                ),
                lambda_res.value as Expression,
              ])
            );
          } else {
            return lambda_res;
          }
        } else if (fn.type === "macro") {
          const args = list.slice(1);
          const macro = fn.value as Macro;
          const last_symbol =
            macro.symbols.length > 0
              ? macro.symbols[macro.symbols.length - 1]
              : "";
          if (last_symbol.startsWith("...")) {
            if (args.length < macro.symbols.length - 1) {
              return makeError(
                `macro expected at least ${
                  macro.symbols.length - 1
                } args, got ${args.length}`,
                expr.offset,
                expr.length
              );
            }
            const tail = args.splice(macro.symbols.length - 1);
            if (tail.length > 0) {
              args.push(makeList(tail));
            } else {
              args.push(kEmptyList);
            }
          } else if (args.length != macro.symbols.length) {
            return makeError(
              `macro expected ${macro.symbols.length} args, got ${args.length}`,
              expr.offset,
              expr.length
            );
          }
          const macro_env = new Env(macro.closure);
          macro.symbols.forEach((el, i) =>
            macro_env.set(el.startsWith("...") ? el.substring(3) : el, args[i])
          );
          return evaluate(evaluate(macro.body, macro_env), env);
        } else if (fn.type === "internal") {
          try {
            const internal = fn.value as Internal;
            const args = list.slice(1).map((el) => evaluate(el, env));
            if (args.some((el) => isPlaceholder(el))) {
              return makePlaceholder(
                makeIdList(
                  internal.name,
                  args.map((arg) =>
                    isPlaceholder(arg) && !isPlaceholderVar(arg)
                      ? (arg.value as Expression)
                      : arg
                  )
                )
              );
            }
            return internal.impl(args);
          } catch (err) {
            if (err instanceof DslEvalError) {
              return makeError(`${err}`, err.offset, err.length);
            }
            return makeError(`${err}`, expr.offset, expr.length);
          }
        } else if (fn.type === "error") {
          return fn;
        } else {
          return dslError`Cannot evaluate ${head}`;
        }
      }
    case "identifier":
      const id = env.get(expr.value as string) || kEmptyList;
      //console.log("   =", print(id));
      return id;
    default:
      return expr;
  }
};
