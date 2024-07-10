import React from "react";
import { IconButton } from "./icon-button";

const kFontSizes: number[] = [
  6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96,
];

const kThemeNames = new Map([
  ["dark", "Solarized Dark"],
  ["light", "Solarized Light"],
  ["term-dark", "Basic Dark"],
  ["term-light", "Basic Light"],
  ["hico-dark", " Contrast Dark"],
  ["hico-light", "Contrast Light"],
]);

export interface PersistedSettings {
  themeName: string;
  fontSize: number;
  vimMode?: boolean;
}

const isPersistedSettings = (obj: any): obj is PersistedSettings => {
  return (
    obj && typeof obj.themeName === "string" && typeof obj.fontSize === "number"
  );
};

const kPersistedSettingsKey =
  "sdf-tool-settings-486a8e89-cd54-4fa3-9374-3ad83d74e717";

const getBrowserColorScheme = () =>
  window.matchMedia("(prefers-color-scheme: dark").matches ? "dark" : "light";

const validatedSettings = (
  input: Partial<PersistedSettings>
): PersistedSettings => ({
  themeName: kThemeNames.has(input.themeName)
    ? input.themeName
    : getBrowserColorScheme(),
  fontSize: kFontSizes.includes(input.fontSize) ? input.fontSize : 14,
  vimMode: !!input.vimMode,
});

export const loadSettings = (): PersistedSettings => {
  const raw = localStorage.getItem(kPersistedSettingsKey);
  if (raw) {
    try {
      const settings = JSON.parse(raw);
      if (isPersistedSettings(settings)) {
        return validatedSettings(settings);
      }
    } catch {}
  }

  return validatedSettings({});
};

interface PersistedSettingsProps extends PersistedSettings {
  onChange: (updated: PersistedSettings) => void;
}

export const SettingsEditor: React.FC<PersistedSettingsProps> = (props) => {
  const update = (value: Partial<PersistedSettings>) => {
    const updated: PersistedSettings = {
      themeName: props.themeName,
      fontSize: props.fontSize,
      vimMode: props.vimMode,
      ...value,
    };
    try {
      localStorage.setItem(kPersistedSettingsKey, JSON.stringify(updated));
    } catch {}
    props.onChange(updated);
  };

  return (
    <div
      style={{
        marginLeft: "auto",
        display: "flex",
        gap: "0.5em",
        height: "fit-content",
        alignItems: "center",
      }}
    >
      <IconButton
        style={{
          fontWeight: "bold",
          padding: 0,
          justifyContent: "center",
          fontStyle: "italic",
          fontFamily: "roman",
          color: props.vimMode ? undefined : "#19953f",
        }}
        size={props.fontSize * 2}
        title={props.vimMode ? "Disable VIM mode" : "Enable VIM mode"}
        onClick={() => update({ vimMode: !props.vimMode })}
      >
        {props.vimMode ? "Ꝟ" : "V"}
      </IconButton>
      <select
        title="Set the Theme"
        value={props.themeName}
        onChange={(e) => update({ themeName: e.target.value })}
      >
        {Array.from(kThemeNames.entries()).map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
      <select
        style={{ width: "fit-content" }}
        value={props.fontSize}
        onChange={(e) => update({ fontSize: Number(e.target.value) })}
      >
        {kFontSizes.map((el) => (
          <option key={el} value={el}>
            {el} pt
          </option>
        ))}
      </select>
    </div>
  );
};
