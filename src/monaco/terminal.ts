import { BaseColors, NamedColors, Theme } from "./theme";

export const kTerminalNamedColors: NamedColors = {
  yellow: "#c19c00", // 'yellow',
  orange: "#c25208", // 'brred',
  red: "#c50f1f", // 'red',
  magenta: "#859900", // 'magenta',
  violet: "#5e1799", // 'brmagenta',
  blue: "#0037da", // 'blue',
  cyan: "#3a96dd", // 'cyan',
  green: "#13a10e", // 'green',
};

const kTerminalColors: BaseColors = {
  base03: "#0c0c0c", // 'brblack',
  base02: "#333333", // 'black',
  base01: "#666666", // 'brgreen',
  base00: "#777777", // 'bryellow',
  base0: "#888888", // 'brblue',
  base1: "#999999", // 'brcyan',
  base2: "#dddddd", // 'white'
  base3: "#f2f2f2", // 'brwhite'
  ...kTerminalNamedColors,
};

export const kTerminalDark: Theme = {
  name: "TerminalDark",
  ...kTerminalColors,
  background: kTerminalColors.base02,
  foreground: kTerminalColors.base2,
  boldBackground: kTerminalColors.base03,
  boldForeground: kTerminalColors.base3,
};

export const kTerminalLight: Theme = {
  name: "TerminalLight",
  ...kTerminalColors,
  background: kTerminalColors.base2,
  foreground: kTerminalColors.base02,
  boldBackground: kTerminalColors.base3,
  boldForeground: kTerminalColors.base03,
};

export function defineThemes() {
  window.monaco.editor.defineTheme(kTerminalDark.name, {
    base: "vs-dark",
    inherit: false,
    rules: [
      { token: "keyword", foreground: kTerminalDark.green },
      { token: "constant", foreground: kTerminalDark.orange },
      { token: "identifier", foreground: kTerminalDark.yellow },
      { token: "delimiter.vector", foreground: kTerminalDark.yellow },
      { token: "string.character", foreground: kTerminalDark.cyan },
      { token: "string", foreground: kTerminalDark.cyan },
      { token: "number", foreground: kTerminalDark.blue },
      { token: "comment", foreground: kTerminalDark.base1 },
      { token: "operators", foreground: kTerminalDark.green },
      { token: "delimiter", foreground: kTerminalDark.base01 },
      { token: "variable", foreground: kTerminalDark.green },
      { token: "bracket", foreground: kTerminalDark.base01 },
      {
        token: "",
        foreground: kTerminalDark.foreground,
        background: kTerminalDark.background,
      },
    ],
    colors: {
      "editor.foreground": kTerminalDark.foreground,
      "editor.background": kTerminalDark.background,
      "editorLineNumber.foreground": kTerminalColors.base00,
    },
  });

  window.monaco.editor.defineTheme(kTerminalLight.name, {
    base: "vs",
    inherit: false,
    rules: [
      { token: "keyword", foreground: kTerminalLight.green },
      { token: "constant", foreground: kTerminalLight.orange },
      { token: "identifier", foreground: kTerminalLight.yellow },
      { token: "delimiter.vector", foreground: kTerminalLight.yellow },
      { token: "string.character", foreground: kTerminalLight.cyan },
      { token: "string", foreground: kTerminalLight.cyan },
      { token: "number", foreground: kTerminalLight.blue },
      { token: "comment", foreground: kTerminalLight.base01 },
      { token: "operators", foreground: kTerminalLight.green },
      { token: "delimiter", foreground: kTerminalLight.base01 },
      { token: "variable", foreground: kTerminalLight.green },
      { token: "bracket", foreground: kTerminalLight.base01 },
      {
        token: "",
        foreground: kTerminalLight.foreground,
        background: kTerminalLight.background,
      },
    ],
    colors: {
      "editor.foreground": kTerminalLight.foreground,
      "editor.background": kTerminalLight.background,
      "editorLineNumber.foreground": kTerminalColors.base00,
    },
  });
}
