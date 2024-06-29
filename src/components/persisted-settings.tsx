import React from "react";

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
  const update = (value: PersistedSettings) => {
    try {
      localStorage.setItem(kPersistedSettingsKey, JSON.stringify(value));
    } catch {}
    props.onChange(value);
  };

  return (
    <div
      style={{
        gridArea: "1/1/2/2",
        justifySelf: "end",
        display: "grid",
        gap: "0.25em",
        height: "fit-content",
        gridTemplateColumns: "auto auto",
      }}
    >
      Theme:
      <select
        value={props.themeName}
        onChange={(e) =>
          update({
            themeName: e.target.value,
            fontSize: props.fontSize,
          })
        }
      >
        {Array.from(kThemeNames.entries()).map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
      Font size:
      <select
        style={{ width: "fit-content" }}
        value={props.fontSize}
        onChange={(e) =>
          update({
            themeName: props.themeName,
            fontSize: Number(e.target.value),
          })
        }
      >
        {kFontSizes.map((el) => (
          <option key={el} value={el}>
            {el}
          </option>
        ))}
      </select>
    </div>
  );
};
