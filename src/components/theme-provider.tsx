import React from "react";
import { kSolarizedDark, kSolarizedLight } from "../monaco/solarized";
import { Theme } from "../monaco/theme";
import {
  kSolarizedContrastDark,
  kSolarizedContrastLight,
} from "../monaco/solarized-contrast";
import { kTerminalDark, kTerminalLight } from "../monaco/terminal";

const kDefaultTheme: Theme = kSolarizedDark;

export const ThemeContext = React.createContext<Theme>(kDefaultTheme);

export const ThemeProvider = ThemeContext.Provider;

export const kDefinedThemes = new Map([
  ["dark", kSolarizedDark],
  ["light", kSolarizedLight],
  ["term-dark", kTerminalDark],
  ["term-light", kTerminalLight],
  ["hico-dark", kSolarizedContrastDark],
  ["hico-light", kSolarizedContrastLight],
]);
