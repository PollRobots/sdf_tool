import {
  Token,
  Expression,
  kEmptyList,
  isIdentifier,
  makeIdList,
  makeIdentifier,
  makeList,
  makeNumber,
} from "./dsl";

export class DslParseError extends Error {
  readonly offset: number;
  readonly length: number;

  constructor(msg: string, offset: number, length?: number) {
    super(msg);
    this.offset = offset;
    this.length = length === undefined ? 0 : length;
  }
}

export const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];

  const identifier_re = /^[a-zA-Z0-9_+\-*\/<>=!?.]+$/;

  let offset = 0;
  let start = 0;
  let mode:
    | "base"
    | "single-comment"
    | "multi-comment"
    | "pound"
    | "number"
    | "identifier"
    | "vector" = "base";
  let accum = "";
  let multiCount = 0;
  let vectorCount = 0;
  for (const ch of input + " ") {
    let repeat = true;
    while (repeat) {
      repeat = false;
      switch (mode) {
        case "base":
          if (
            ch == "(" ||
            ch == ")" ||
            ch == "'" ||
            ch == "`" ||
            ch == "," ||
            ch == ":"
          ) {
            tokens.push({ type: "punctuation", offset: offset, value: ch });
          } else if (ch == "@") {
            const top = tokens.pop();
            if (
              !top ||
              (top.type !== "punctuation" &&
                top.value !== "," &&
                top.offset != offset - 1)
            ) {
              throw new DslParseError(
                `Unexpected character '@' (should only occur as part of ',@')`,
                offset,
                1
              );
            }
            tokens.push({
              type: "punctuation",
              offset: top.offset,
              value: ",@",
            });
          } else if (ch.match(/\s/)) {
            // skip whitespace
          } else if (ch == ";") {
            mode = "single-comment";
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
            throw new DslParseError(`Unexpected character '${ch}'`, offset, 1);
          }
          break;
        case "single-comment":
          if (ch == "\n") {
            mode = "base";
          }
          break;
        case "multi-comment":
          if (ch != "#" && ch != "|") {
            // ignore everything except #| and |#
          }
          accum += ch;
          if (accum.endsWith("#|")) {
            multiCount++;
            accum = "";
          } else if (accum.endsWith("|#")) {
            multiCount--;
            accum = "";
            if (multiCount == 0) {
              mode = "base";
            }
          }
          break;
        case "pound":
          if (ch == "|") {
            mode = "multi-comment";
            multiCount = 1;
            start = offset;
            accum = "";
          } else if (ch == "<") {
            mode = "vector";
            accum = "#<";
            vectorCount = 1;
          } else {
            throw new DslParseError(
              `Unexpected reader sequence '#${ch}'`,
              offset,
              2
            );
          }
          break;
        case "number":
          if (ch.match(/[\s(),;]/)) {
            if (accum == "+" || accum == "-") {
              mode = "identifier";
              repeat = true;
              break;
            }
            const n = Number(accum);
            if (isNaN(n)) {
              throw new DslParseError(
                `Invalid number '${accum}'`,
                start,
                offset - start
              );
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
              throw new DslParseError(
                `Invalid identifier '${accum}'`,
                start,
                offset - start
              );
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
            vectorCount--;
            if (vectorCount == 0) {
              try {
                const vector_tokens = tokenize(
                  accum.slice(2, accum.length - 1)
                );
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
                if (err instanceof DslParseError) {
                  throw err;
                }
                throw new DslParseError(
                  `Error parsing vector '${accum}': ${err}`,
                  start,
                  offset - start
                );
              }
            }
          } else {
            accum += ch;
            if (accum.endsWith("#<")) {
              vectorCount++;
            }
          }
          break;
        default:
          throw new DslParseError(
            `Unknown internal state '${mode}'`,
            offset,
            1
          );
      }
    }
    offset++;
  }

  if (mode === "multi-comment" && multiCount > 0) {
    throw new DslParseError(
      `Unterminated multi-line comment`,
      start,
      input.length - start
    );
  }

  return tokens;
};

export const parse = (tokens: Token[]): Expression[] => {
  const res: Expression[] = [];
  const lists: Expression[][] = [];
  const endOffset = tokens[tokens.length - 1].offset;
  const readerMacros: string[] = [];
  let currReaderMacro: string | undefined = undefined;
  let isVector = false;

  const addExpression = (expr: Expression) => {
    if (isVector && currReaderMacro === "unquote") {
      currReaderMacro = undefined;
    }
    if (currReaderMacro) {
      expr = makeIdList(currReaderMacro, expr);
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
          isVector = false;
        } else if (curr.value === ")") {
          // pop current list and add to result
          if (lists.length == 0) {
            throw new DslParseError(
              `Unexpected ')' at ${curr.offset}`,
              curr.offset,
              1
            );
          }
          if (currReaderMacro !== undefined) {
            throw new DslParseError(
              `Reader macro '${currReaderMacro}' without argument at ${curr.offset}`,
              curr.offset,
              1
            );
          }
          const top = lists.pop();
          currReaderMacro = readerMacros.pop();

          const list: Expression =
            top.length == 0 ? kEmptyList : makeList(...top);
          addExpression(list);
        } else if (curr.value === "'") {
          currReaderMacro = "quote";
        } else if (curr.value === "`") {
          currReaderMacro = "quasi-quote";
        } else if (curr.value === ",") {
          currReaderMacro = "unquote";
        } else if (curr.value === ",@") {
          currReaderMacro = "unquote-splicing";
        } else if (curr.value === ":") {
          currReaderMacro = "placeholder";
        } else {
          throw new DslParseError(
            `Unknown punctuation '${curr.value}' at ${curr.offset}`,
            curr.offset,
            (curr.value as string).length
          );
        }
        isVector = false;
        if (lists.length !== 0) {
          const currTop = lists[lists.length - 1];
          if (
            currTop.length > 0 &&
            isIdentifier(currTop[0]) &&
            currTop[0].value === "vec"
          ) {
            isVector = true;
          }
        }
        break;
      case "identifier":
        addExpression(makeIdentifier(curr.value as string, curr.offset));
        if (
          curr.value === "vec" &&
          lists.length !== 0 &&
          lists[lists.length - 1].length === 1
        ) {
          isVector = true;
        }
        break;
      case "number":
        addExpression(
          makeNumber(
            curr.value as number,
            curr.offset,
            curr.value.toString().length
          )
        );
        break;
    }
  }
  if (lists.length !== 0) {
    throw new DslParseError(`${lists.length} unterminated lists`, endOffset);
  }
  return res;
};

export const read = (input: string): Expression[] => {
  return parse(tokenize(input));
};
