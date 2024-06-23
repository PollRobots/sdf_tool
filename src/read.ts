import { Token, Expression, kEmptyList, isIdentifier } from "./dsl";

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
              throw new Error(`Unexpected character '@' at ${offset}`);
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
            throw new Error(`Unexpected character '${ch}' at ${offset}`);
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
          } else {
            throw new Error(`Unexpected reader sequence '#${ch}' at ${offset}`);
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
              throw new Error(
                `Error parsing vector '${accum}' at ${start}: ${err}`
              );
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

  if (mode === "multi-comment" && multiCount > 0) {
    throw new Error(`Unterminated comment starting at ${start}`);
  }

  return tokens;
};

export const parse = (tokens: Token[]): Expression[] => {
  const res: Expression[] = [];
  const lists: Expression[][] = [];
  const readerMacros: string[] = [];
  let currReaderMacro: string | undefined = undefined;
  let isVector = false;

  const addExpression = (expr: Expression) => {
    if (isVector && currReaderMacro === "unquote") {
      currReaderMacro = undefined;
    }
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
          isVector = false;
        } else if (curr.value === ")") {
          // pop current list and add to result
          if (lists.length == 0) {
            throw new Error(`Unexpected ')' at ${curr.offset}`);
          }
          if (currReaderMacro !== undefined) {
            throw new Error(
              `Reader macro '${currReaderMacro}' without argument at ${curr.offset}`
            );
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
        } else if (curr.value === ",@") {
          currReaderMacro = "unquote-splicing";
        } else if (curr.value === ":") {
          currReaderMacro = "placeholder";
        } else {
          throw new Error(
            `Unknown punctuation '${curr.value}' at ${curr.offset}`
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
        addExpression({
          type: "identifier",
          value: curr.value,
        });
        if (
          curr.value === "vec" &&
          lists.length !== 0 &&
          lists[lists.length - 1].length === 1
        ) {
          isVector = true;
        }
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
