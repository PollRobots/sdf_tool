import { getValueAsVector } from "./builtins";
import * as dsl from "./dsl";
import { Env } from "./env";
import { evaluate } from "./evaluate";
import { printExpr } from "./print";

type SpecialEvaluator = (expr: dsl.Expression, env: Env) => dsl.Expression;

const kSpecialEvaluators: Map<string, SpecialEvaluator> = new Map([
  ["if", evaluateIf],
  ["define", evaluateDefine],
  ["set!", evaluateDefine],
  ["lambda", evaluateLambda],
  ["let", evaluateLet],
  ["begin", evaluateBegin],
  ["quote", evaluateQuote],
  ["quasi-quote", evaluateQuasiQuote],
  ["shape", evaluateShape],
  ["placeholder", evaluatePlaceholder],
  ["smoothcase", evaluateSmoothcase],
]);

export const evaluateSpecial = (
  expr: dsl.Expression,
  env: Env
): dsl.Expression => {
  const proc = (expr.value as dsl.Expression[])[0].value as string;

  const specialEvaluator = kSpecialEvaluators.get(proc);
  if (!specialEvaluator) {
    return dsl.makeError(
      `Unexpected special form: ${proc}`,
      expr.offset,
      expr.length
    );
  }
  return specialEvaluator(expr, env);
};

function evaluateIf(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  // must have two or three args
  if (list.length < 3 || list.length > 4) {
    return dsl.makeError(
      `if should have two or three arguments`,
      expr.offset,
      expr.length
    );
  }
  const test = evaluate(list[1], env);
  if (dsl.isPlaceholder(test)) {
    return dsl.makePlaceholder(dsl.makeList(list[0], test, ...list.slice(2)));
  } else if (dsl.isTruthy(test)) {
    return evaluate(list[2], env);
  } else if (list.length === 4) {
    return evaluate(list[3], env);
  } else {
    return dsl.kEmptyList;
  }
}

function evaluateDefine(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  const proc = list[0].value as string;
  if (list.length != 3 && list.length != 4) {
    return dsl.makeError(
      `${proc} must have two or three arguments, not ${list.length - 1}`,
      expr.offset,
      expr.length
    );
  }
  if (!dsl.isIdentifier(list[1])) {
    return dsl.makeError(
      `first argument for ${proc} must be an identifier`,
      expr.offset,
      expr.length
    );
  }
  if (list.length === 4) {
    // this is the lambda form (define <sym> (<sym> ...) body)
    // equivalent to (define <sym> (lambda (<sym> ...) body))
    const lambda = dsl.makeIdList("lambda", ...list.slice(2));
    env.set(list[1].value as string, evaluate(lambda, env), proc === "set!");
  } else {
    env.set(list[1].value as string, evaluate(list[2], env), proc === "set!");
  }
  return dsl.kEmptyList;
}

function evaluateLambda(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  if (list.length != 3) {
    return dsl.makeError(
      `lambda must have two arguments, not ${list.length - 1}`,
      expr.offset,
      expr.length
    );
  }
  if (!dsl.isList(list[1])) {
    return dsl.makeError(
      `First argument to lambda must be a list`,
      expr.offset,
      expr.length
    );
  }
  const symbols = list[1].value as dsl.Expression[];
  if (!symbols.every(dsl.isIdentifier)) {
    return dsl.makeError(
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
        body: dsl.makeIdList("begin", ...list.slice(2)),
        closure: env,
      },
      offset: expr.offset,
      length: expr.length,
    };
  }
}

function evaluateLet(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  if (list.length != 3) {
    return dsl.makeError(
      `let must have 2 arguments, not ${list.length - 1}`,
      expr.offset,
      expr.length
    );
  }
  if (!dsl.isList(list[1])) {
    return dsl.makeError(
      `First argument to let must be a list`,
      list[1].offset,
      list[1].length
    );
  }
  const let_symbols: dsl.Expression[] = [];
  const let_exprs: dsl.Expression[] = [];
  for (const el of list[1].value as dsl.Expression[]) {
    const el_list = el.value as dsl.Expression[];
    if (!dsl.isList(el) || el_list.length !== 2) {
      return dsl.makeError(
        `let init list elements must be a list of 2`,
        list[1].offset,
        list[1].length
      );
    }
    let_symbols.push(el_list[0]);
    let_exprs.push(el_list[1]);
  }
  // build the lambda expression
  const let_lambda = dsl.makeIdList(
    "lambda",
    dsl.makeList(...let_symbols),
    ...list.slice(2)
  );
  return evaluate(dsl.makeList(let_lambda, ...let_exprs), env);
}

function evaluateBegin(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  let result: dsl.Expression = dsl.kEmptyList;
  for (const expr of list.slice(1)) {
    result = evaluate(expr, env);
  }
  return result;
}

function evaluateQuote(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  if (list.length != 2) {
    return dsl.makeError(
      `quote must have 1 argument, not ${list.length - 1}`,
      expr.offset,
      expr.length
    );
  }
  return list[1];
}

function evaluateQuasiQuote(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  if (list.length != 2) {
    return dsl.makeError(
      `quote must have 1 argument, not ${list.length - 1}`,
      expr.offset,
      expr.length
    );
  }
  const unquote = (
    list: dsl.Expression[],
    splicing: boolean
  ): dsl.Expression | dsl.Expression[] => {
    const op = splicing ? "unquote-splicing" : "unquote";
    if (list[0].value !== op || list.length !== 2) {
      return dsl.makeError(`Expecting ${op}`, expr.offset, expr.length);
    } else if (list.length !== 2) {
      return dsl.makeError(
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
      return dsl.makeError(
        `unquote-splicing can only splice a list`,
        expr.offset,
        expr.length
      );
    }
    return res.value as dsl.Expression[];
  };

  const qq_list = (l: dsl.Expression[]): dsl.Expression[] =>
    l
      .map((el) => {
        if (el.type === "list") {
          const list = el.value as dsl.Expression[];
          if (list[0].value === "unquote") {
            return unquote(list, false);
          } else if (list[0].value === "unquote-splicing") {
            return unquote(list, true);
          } else {
            el = dsl.makeList(...qq_list(list));
          }
        }
        return el;
      })
      .filter((el) => !Array.isArray(el) || el.length > 0)
      .flat();

  if (list[1].type === "list") {
    return dsl.makeList(...qq_list(list[1].value as dsl.Expression[]));
  } else {
    return list[1];
  }
}

function evaluateShape(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  if (list.length < 2 || list[1].type !== "identifier") {
    return dsl.makeError(
      `shape must have an identifier as the first argument`,
      expr.offset,
      expr.length
    );
  }
  const args = list.slice(2).map((expr) => evaluate(expr, env));
  if (args.some(dsl.isPlaceholder)) {
    return dsl.makePlaceholder(
      dsl.makeIdList(
        "shape",
        list[1],
        ...args.map((arg) =>
          dsl.isPlaceholder(arg) && !dsl.isPlaceholderVar(arg)
            ? (arg.value as dsl.Expression)
            : arg
        )
      )
    );
  } else {
    const shape: dsl.Shape = {
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
}

function evaluatePlaceholder(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  if (list.length !== 2) {
    return dsl.makeError(
      `placeholder must have a single argument`,
      expr.offset,
      expr.length
    );
  }
  const placeholder_arg = list[1];
  switch (placeholder_arg.type) {
    case "identifier":
      return dsl.makePlaceholder(placeholder_arg);
    case "list":
      const parts = placeholder_arg.value as dsl.Expression[];
      if (
        parts.length == 2 &&
        parts[0].value === "vec" &&
        dsl.isIdentifier(parts[1])
      ) {
        const name = parts[1].value as string;
        return dsl.makePlaceholder(
          dsl.makeIdList(
            "vec",
            dsl.makePlaceholder(
              dsl.makeIdentifier(`${name}.x`, placeholder_arg.offset)
            ),
            dsl.makePlaceholder(
              dsl.makeIdentifier(`${name}.y`, placeholder_arg.offset)
            ),
            dsl.makePlaceholder(
              dsl.makeIdentifier(`${name}.z`, placeholder_arg.offset)
            )
          )
        );
      }
    default:
      return dsl.makeError(
        `${printExpr(placeholder_arg)} is not a valid placeholder arg`,
        placeholder_arg.offset,
        placeholder_arg.length
      );
  }
}

function evaluateSmoothcase(expr: dsl.Expression, env: Env): dsl.Expression {
  const list = expr.value as dsl.Expression[];
  if (list.length < 3) {
    return dsl.makeError(
      `smoothcase must have at least 2 arguments`,
      expr.offset,
      expr.length
    );
  }

  // verify structure of cases.
  // a case should have the form
  // ((low high) body) or
  // ((value) body)
  const check = list.slice(2).reduce((a, el) => {
    if (dsl.isError(a)) {
      return a;
    }
    if (!dsl.isList(el)) {
      return dsl.makeError(
        `smoothcase case argument must be a list`,
        el.offset,
        el.length
      );
    }
    const caseList = el.value as dsl.Expression[];
    if (caseList.length !== 2) {
      return dsl.makeError(
        `smoothcase case argument must be a list of length 2, not ${caseList.length}`,
        el.offset,
        el.length
      );
    }

    const caseHead = caseList[0];
    if (!dsl.isList(caseHead)) {
      return dsl.makeError(
        `smoothcase case argument head must be a list.`,
        caseHead.offset,
        caseHead.length
      );
    }
    if (caseHead.value.length != 1 && caseHead.value.length != 2) {
      return dsl.makeError(
        `smoothcase case argument head must be a list of length 1 or 2, not ${caseHead.value.length}.`,
        caseHead.offset,
        caseHead.length
      );
    }
    return a;
  }, dsl.kEmptyList);

  if (dsl.isError(check)) {
    return check;
  }

  // evaluate value expression
  const value = evaluate(list[1], env);
  // evaluate case expressions
  const cases = list.slice(2).map((caseItem) => {
    const caseList = caseItem.value as dsl.Expression[];
    const caseHeadValues = (caseList[0].value as dsl.Expression[]).map((exp) =>
      evaluate(exp, env)
    );
    const caseBodyValue = evaluate(caseList[1], env);
    return dsl.makeList(dsl.makeList(...caseHeadValues), caseBodyValue);
  });

  // Check for any reference of a placeholder (which prevents early evaluation)
  if (
    dsl.isPlaceholder(value) ||
    cases.some((caseItem) => {
      const caseList = caseItem.value as dsl.Expression[];
      return (
        (caseList[0].value as dsl.Expression[]).some(dsl.isPlaceholder) ||
        dsl.isPlaceholder(caseList[1])
      );
    })
  ) {
    // remove extra placeholders from cases
    cases.forEach((caseItem) => {
      const caseList = caseItem.value as dsl.Expression[];
      const caseHead = caseList[0].value as dsl.Expression[];
      caseHead.forEach((exp, i) => {
        if (dsl.isPlaceholder(exp) && !dsl.isPlaceholderVar(exp)) {
          caseHead[i] = exp.value;
        }
      });
      const caseBody = caseList[1];
      if (dsl.isPlaceholder(caseBody) && !dsl.isPlaceholderVar(caseBody)) {
        caseList[1] = caseBody.value;
      }
    });
    return dsl.makePlaceholder(dsl.makeList(list[0], value, ...cases));
  }

  if (!dsl.isValue(value)) {
    if (dsl.isError(value)) {
      return value;
    }
    return dsl.makeError(
      `smoothcase first argument must evaluate to a value type`,
      list[1].offset,
      list[1].length
    );
  }

  // find any errors or non-value elements
  const err = cases.reduce((a, caseItem) => {
    if (dsl.isError(a)) {
      return a;
    }
    const caseList = caseItem.value as dsl.Expression[];
    const caseHead = caseList[0].value as dsl.Expression[];
    if (dsl.isError(caseHead[0])) {
      return caseHead[0];
    } else if (caseHead.length == 2 && dsl.isError(caseHead[1])) {
      return caseHead[1];
    } else if (dsl.isError(caseList[1])) {
      return caseList[1];
    } else if (!caseHead.every(dsl.isValue) || !dsl.isValue(caseList[1])) {
      return dsl.makeError(
        `smoothcase cases must be value items`,
        caseItem.offset,
        caseItem.length
      );
    }
    return a;
  }, dsl.kEmptyList);
  if (dsl.isError(err)) {
    return err;
  }

  if (
    value.type === "vector" ||
    cases.some((caseItem) => {
      const caseList = caseItem.value as dsl.Expression[];
      return (caseList[0].value as dsl.Expression[]).some((exp) =>
        dsl.isVector(exp)
      );
    })
  ) {
    // all values can be converted to vectors, convert each case into {low: vector, high: vector, body: vector}
    const caseVectors = cases.map((caseItem) => {
      const caseList = caseItem.value as dsl.Expression[];
      const caseHead = caseList[0].value as dsl.Expression[];
      const low = getValueAsVector(caseHead[0] as dsl.Value);
      const high =
        caseHead.length === 1
          ? low
          : getValueAsVector(caseHead[1] as dsl.Value);
      return {
        low: low,
        high: high,
        body: getValueAsVector(caseList[1] as dsl.Value),
      };
    });
    const xs: SmoothCaseNumber[] = caseVectors.map((el) => ({
      low: el.low.x,
      high: el.high.x,
      body: el.body.x,
    }));
    const ys: SmoothCaseNumber[] = caseVectors.map((el) => ({
      low: el.low.y,
      high: el.high.y,
      body: el.body.y,
    }));
    const zs: SmoothCaseNumber[] = caseVectors.map((el) => ({
      low: el.low.z,
      high: el.high.z,
      body: el.body.z,
    }));

    const actualValue = getValueAsVector(value);

    const xres = smoothcaseNumberImpl(actualValue.x, xs, list.slice(2));
    const yres = smoothcaseNumberImpl(actualValue.y, ys, list.slice(2));
    const zres = smoothcaseNumberImpl(actualValue.z, zs, list.slice(2));

    if (dsl.isNumber(xres) && dsl.isNumber(yres) && dsl.isNumber(zres)) {
      return dsl.makeVector(
        xres.value,
        yres.value,
        zres.value,
        xres.offset,
        xres.length
      );
    } else if (dsl.isError(xres)) {
      return xres;
    } else if (dsl.isError(yres)) {
      return yres;
    } else {
      return zres;
    }
  } else {
    // all values are numbers, convert each case into {low: number, high: number, body: number}
    const caseNumbers: SmoothCaseNumber[] = cases.map((caseItem) => {
      const caseList = caseItem.value as dsl.Expression[];
      const caseHead = caseList[0].value as dsl.Expression[];
      return {
        low: caseHead[0].value as number,
        high:
          caseHead.length === 1
            ? (caseHead[0].value as number)
            : (caseHead[1].value as number),
        body: caseList[1].value as number,
      };
    });

    return smoothcaseNumberImpl(
      value.value as number,
      caseNumbers,
      list.slice(2)
    );
  }
}

interface SmoothCaseNumber {
  low: number;
  high: number;
  body: number;
}

const smoothcaseNumberImpl = (
  value: number,
  cases: SmoothCaseNumber[],
  exprs: dsl.Expression[]
): dsl.Expression => {
  let previousBody: number | undefined;
  let previousHigh: number | undefined;

  for (let i = 0; i < cases.length; i++) {
    const { low, high, body } = cases[i];
    if (compare(low, high) > 0) {
      // case values are invalid
      return dsl.makeError(
        `smoothcase case argument head values must be ordered low to high`,
        exprs[i].offset,
        exprs[i].length
      );
    }

    const lowCmp = compare(low, value);
    const highCmp = compare(value, high);

    if (lowCmp > 0) {
      if (previousBody === undefined || previousHigh === undefined) {
        // no previous value, so return this body
        return dsl.makeNumber(body, exprs[i].offset, exprs[i].length);
      }
      // value is lower than this range so mix(smoothstep) this body value and the previous value
      return dsl.makeNumber(
        mix(previousBody, body, smoothstep(previousHigh, low, value)),
        exprs[i].offset,
        exprs[i].length
      );
    } else if (lowCmp <= 0 && highCmp <= 0) {
      // value is in range, return body
      return dsl.makeNumber(body, exprs[i].offset, exprs[i].length);
    } else {
      previousBody = body;
      previousHigh = high;
    }
  }
  return dsl.makeNumber(
    previousBody,
    exprs[exprs.length - 1].offset,
    exprs[exprs.length - 1].length
  );
};

function compare(left: number, right: number): number {
  return Math.sign(left - right);
}

function mix(left: number, right: number, t: number): number {
  t = Math.min(Math.max(0, t), 1);
  return left * (1 - t) + right * t;
}

function smoothstep(low: number, high: number, value: number): number {
  const x = Math.min(Math.max(0, (value - low) / (high - low)), 1);
  return x * x * (3 - 2 * x);
}
