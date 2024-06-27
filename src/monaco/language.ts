import monaco from "monaco-editor";
import { kBuiltinNames } from "../builtins";

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
  "shape",
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

  keywords: kBuiltinNames,

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
      [/[#][<]/, "delimiter.vector.open"],
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
  window.monaco.languages.register({ id: kLanguageId });
  window.monaco.languages.setMonarchTokensProvider(kLanguageId, kLanguage);
  window.monaco.languages.setLanguageConfiguration(kLanguageId, kConf);
};
