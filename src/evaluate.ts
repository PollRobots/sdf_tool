import { Env } from "./env";
import * as dsl from "./dsl";
import { evaluateSpecial } from "./special-forms-eval";

const getUnresolved = (expr: dsl.Expression): Map<string, dsl.Expression> => {
  const syms = new Map<string, dsl.Expression>();

  const inner = (expr: dsl.Expression) => {
    switch (expr.type) {
      case "list":
        const list = expr.value as dsl.Expression[];
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

export const evaluate = (expr: dsl.Expression, env: Env): dsl.Expression => {
  /// console.log("evaluate:", print(expr));
  switch (expr.type) {
    case "list":
      const list = expr.value as dsl.Expression[];
      if (list.length < 1) {
        return dsl.makeError(
          "Should never have an empty list at eval time",
          expr.offset,
          expr.length
        );
      }
      const head = list[0];
      if (head.type === "identifier" && dsl.isSpecial(head.value as string)) {
        return evaluateSpecial(expr, env);
      } else {
        const fn = evaluate(head, env);
        if (fn.type === "lambda") {
          const args = list.slice(1).map((el) => evaluate(el, env));
          const lambda = fn.value as dsl.Lambda;
          if (lambda.closure.generating) {
            const depth = maxDepth(lambda.body);
            if (depth >= 2) {
              if (dsl.isIdentifier(head)) {
                return dsl.makeList(head, ...args);
              } else {
                return dsl.makeList(fn, ...args);
              }
            }
          }
          if (args.length != lambda.symbols.length) {
            return dsl.makeError(
              `lambda expected ${lambda.symbols.length} args, got ${args.length}`,
              expr.offset,
              expr.length
            );
          }
          const lambda_env = new Env(lambda.closure);
          lambda.symbols.forEach((el, i) => lambda_env.set(el, args[i]));
          const lambda_res = evaluate(lambda.body, lambda_env);
          if (dsl.isPlaceholder(lambda_res) && lambda.symbols.length != 0) {
            const retained = lambda_res.value as dsl.Expression;
            const unresolved_syms = getUnresolved(retained);
            if (dsl.isIdList(retained, "let")) {
              const retained_list = retained.value as dsl.Expression[];
              // let is only the retained expression when a lambda was retained.
              // any symbols defined in the let symbol list cannot be in the unresolved_syms
              // otherwise recursive evaluation will mess things up
              const let_symbols = (
                retained_list[1].value as dsl.Expression[]
              ).map((el) => (el.value as dsl.Expression[])[0].value as string);
              let_symbols.forEach((sym) => unresolved_syms.delete(sym));
            }
            const recapture = lambda.symbols.filter((el) =>
              unresolved_syms.has(el)
            );
            if (recapture.length == 0) {
              return lambda_res;
            }

            return dsl.makePlaceholder(
              dsl.makeIdList(
                "let",
                dsl.makeList(
                  ...recapture.map((el) => {
                    const re_exp = unresolved_syms.get(el) || dsl.kEmptyList;
                    return dsl.makeList(
                      dsl.makeIdentifier(el, re_exp.offset),
                      lambda_env.get(el)
                    );
                  })
                ),
                lambda_res.value as dsl.Expression
              )
            );
          } else {
            return lambda_res;
          }
        } else if (fn.type === "macro") {
          const args = list.slice(1);
          const macro = fn.value as dsl.Macro;
          const last_symbol =
            macro.symbols.length > 0
              ? macro.symbols[macro.symbols.length - 1]
              : "";
          if (last_symbol.startsWith("...")) {
            if (args.length < macro.symbols.length - 1) {
              return dsl.makeError(
                `${macro.name} macro expected at least ${
                  macro.symbols.length - 1
                } args, got ${args.length}`,
                head.offset,
                head.length
              );
            }
            const tail = args.splice(macro.symbols.length - 1);
            if (tail.length > 0) {
              args.push(dsl.makeList(...tail));
            } else {
              args.push(dsl.kEmptyList);
            }
          } else if (args.length < macro.symbols.length) {
            return dsl.makeError(
              `Too few arguments(${args.length}) for ${macro.name} macro, expected ${macro.symbols.length}`,
              head.offset,
              head.length
            );
          } else if (args.length > macro.symbols.length) {
            return dsl.makeError(
              `Too many arguments(${args.length}) for ${macro.name} macro, expected ${macro.symbols.length}`,
              head.offset,
              head.length
            );
          }
          const macro_env = new Env(macro.closure);
          macro.symbols.forEach((el, i) =>
            macro_env.set(el.startsWith("...") ? el.substring(3) : el, args[i])
          );
          return evaluate(evaluate(macro.body, macro_env), env);
        } else if (fn.type === "internal") {
          try {
            const internal = fn.value as dsl.Internal;
            const args = list.slice(1).map((el) => evaluate(el, env));
            if (
              args.some((el) => dsl.isPlaceholder(el) || dsl.isGenerated(el))
            ) {
              return dsl.makePlaceholder(
                dsl.makeIdList(
                  internal.name,
                  ...args.map((arg) =>
                    dsl.isPlaceholder(arg) && !dsl.isPlaceholderVar(arg)
                      ? (arg.value as dsl.Expression)
                      : arg
                  )
                )
              );
            }
            return internal.impl(args);
          } catch (err) {
            if (err instanceof dsl.DslEvalError) {
              return dsl.makeError(`${err}`, err.offset, err.length);
            }
            return dsl.makeError(`${err}`, expr.offset, expr.length);
          }
        } else if (fn.type === "error") {
          return fn;
        } else {
          return dsl.dslError`Cannot evaluate ${head}`;
        }
      }
    case "identifier":
      return env.getExpr(expr);
    default:
      return expr;
  }
};

const maxDepth = (expr: dsl.Expression): number => {
  switch (expr.type) {
    case "list":
      return (
        1 +
        (expr.value as dsl.Expression[]).reduce(
          (a, e) => Math.max(a, maxDepth(e)),
          0
        )
      );
    case "placeholder":
      return maxDepth(expr.value as dsl.Expression);
    default:
      return 0;
  }
};
