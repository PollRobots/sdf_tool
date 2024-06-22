import monaco from "monaco-editor";

const swizzles = (): string[] => {
  const l: string[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        l.push(String.fromCharCode(120 + i, 120 + j, 120 + k));
      }
    }
  }
  return l;
};

const kBuiltins = [
  "list",
  "head",
  "tail",
  "null?",
  "list?",
  "number?",
  "vector?",
  "shape?",
  "callable?",
  "error?",
  "+",
  "-",
  "*",
  "/",
  "dot",
  "cross",
  "abs",
  "floor",
  "ceil",
  "sqrt",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "radians",
  "degrees",
  "min",
  "max",
  "get-x",
  "get-y",
  "get-z",
  "vec",
  "pow",
  "<",
  "<=",
  ">",
  ">=",
  "eq",
  "neq",
  ...swizzles(),
  "splat",
  "min-vec",
  "max-vec",
  "normalize",
  "length",
  "union",
  "intersect",
  "difference",
  "scale",
  "translate",
  "translate-x",
  "translate-y",
  "translate-z",
  "rotate",
  "rotate-x",
  "rotate-y",
  "rotate-z",
  "smooth",
  "abrupt",
  "ellipsoid",
  "sphere",
];

const kSpecial = [
  "if",
  "let",
  "lambda",
  "define",
  "quote",
  "set!",
  "and",
  "or",
  "begin",
];
const kConf: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: ";",
    blockComment: ["#|", "|#"],
  },

  brackets: [
    ["(", ")"],
    ["#<", ">"],
  ],

  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: "#<", close: ">" },
  ],
};

const kLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: false,
  tokenPostfix: ".scheme",

  brackets: [
    { open: "#<", close: ">", token: "delimiter.vector" },
    { open: "(", close: ")", token: "delimiter.parenthesis" },
  ],

  keywords: kBuiltins,

  constants: ["t"],

  operators: kSpecial,

  tokenizer: {
    root: [
      [/(?:#[iIeE])?#[dD][+-]?[0-9]+/, "number.dec"],

      [/[+-]?\d+(?:(?:\.\d*)?(?:[eE][+-]?\d+)?)?/, "number.float"],
      [/[+-](inf|nan)\.0/, "number.float"],

      [
        /#\\(alarm|backspace|delete|escape|newline|null|return|space|tab)/,
        "string.character",
      ],
      [/#\\x[0-9a-fA-F]+/, "string.character"],
      [/#\\\w/, "string"],

      [
        /(?:\b(?:(define|define-syntax|define-macro))\b)(\s+)((?:\w|\-|\!|\?)*)/,
        ["keyword", "white", "variable"],
      ],

      { include: "@whitespace" },
      { include: "@strings" },
      { include: "@brackets" },

      [
        /[a-zA-Z_#][a-zA-Z0-9_\-\?\!\*]*/,
        {
          cases: {
            "@keywords": "keyword",
            "@constants": "constant",
            "@operators": "operators",
            "@default": "identifier",
          },
        },
      ],
    ],

    brackets: [
      [/[#](?=\<)/, "delimiter.vector.open"],
      [/\>/, "delimiter.vector.close"],
      [/\(/, "delimiter.open"],
      [/[)]/, "delimiter.close"],
    ],

    comment: [
      [/[^\|#]+/, "comment"],
      [/#\|/, "comment", "@push"],
      [/\|#/, "comment", "@pop"],
      [/[\|#]/, "comment"],
    ],

    whitespace: [
      [/[ \t\r\n]+/, "white"],
      [/#\|/, "comment", "@comment"],
      [/;.*$/, "comment"],
    ],

    strings: [
      [/"$/, "string", "@popall"],
      [/"(?=.)/, "string", "@multiLineString"],
    ],

    multiLineString: [
      [/[^\\"]+$/, "string", "@popall"],
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@popall"],
      [/\\$/, "string"],
    ],
  },
};

export const kLanguageId = "sdf-tool-dsl";

export const registerLanguage = () => {
  // @ts-ignore
  window.monaco.languages.register({ id: kLanguageId });
  // @ts-ignore
  window.monaco.languages.setMonarchTokensProvider(kLanguageId, kLanguage);
  // @ts-ignore
  window.monaco.languages.setLanguageConfiguration(kLanguageId, kConf);
};
