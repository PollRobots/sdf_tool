import React from "react";

export interface Uniform {
  value: number;
  min: number;
  max: number;
  step: number;
  logarithmic: boolean;
}

export const kDefaultUniform: Uniform = {
  value: 0,
  min: 0,
  max: 1,
  step: 0.01,
  logarithmic: false,
};

interface UniformProps extends Uniform {
  name: string;
  onChange: (update: Uniform) => void;
}

export const UniformEditor: React.FC<UniformProps> = (props) => {
  const [working, setWorking] = React.useState(props.value.toString());
  const [showProps, setShowProps] = React.useState(false);
  const [error, setError] = React.useState("");

  const update = (change: Partial<Uniform>) => {
    const updated: Uniform = {
      value: props.value,
      min: props.min,
      max: props.max,
      step: props.step,
      logarithmic: props.logarithmic,
      ...change,
    };

    props.onChange(updated);
  };

  const updateValue = (value: string): void => {
    const n = Number(value);
    if (isNaN(n)) {
      setError(`${value} is not a number`);
    } else {
      if (n < props.min) {
        setError(`${value} is less than ${props.min}`);
      } else if (n > props.max) {
        setError(`${value} is greater than ${props.max}`);
      } else {
        setError("");
      }
      update({ value: n });
    }
    setWorking(value);
  };

  return (
    <div
      style={{
        display: "grid",
        columnGap: "0.5em",
        gridTemplateColumns: `2em auto 3em ${showProps ? "auto" : "2em"}`,
        gridTemplateRows: "auto auto",
        alignItems: "center",
      }}
    >
      <div style={{ fontWeight: "bolder" }}>{props.name}:</div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => updateValue(e.target.value)}
      />
      <input
        type="text"
        value={working}
        placeholder={`Value for ${props.name}`}
        onChange={(e) => updateValue(e.target.value)}
      />
      {showProps ? (
        <UniformSettingsEditor
          min={props.min}
          max={props.max}
          step={props.step}
          logarithmic={props.logarithmic}
          onChange={(v) => {
            update(v);
            setShowProps(false);
          }}
          onCancel={() => setShowProps(false)}
        />
      ) : (
        <button
          style={{ padding: 0, aspectRatio: 1.2 }}
          onClick={() => setShowProps(true)}
        >
          &hellip;
        </button>
      )}
      <div style={{ gridArea: "2/1/3/5", fontSize: "smaller", color: "red" }}>
        {error}
      </div>
    </div>
  );
};

interface UniformSettings {
  min: number;
  max: number;
  step: number;
  logarithmic: boolean;
}

interface UniformSettingsProps extends UniformSettings {
  onChange: (updated: UniformSettings) => void;
  onCancel: () => void;
}

const kPresetsMap: Map<string, UniformSettings> = new Map([
  ["k", { min: 0, max: 0.2, step: 0.001, logarithmic: false }],
  ["theta", { min: -180, max: 180, step: 1, logarithmic: false }],
  ["one", { min: 0, max: 1, step: 0.01, logarithmic: false }],
  ["two", { min: 0, max: 2, step: 0.01, logarithmic: false }],
  ["five", { min: 0, max: 5, step: 0.01, logarithmic: false }],
  ["ten", { min: 0, max: 10, step: 0.1, logarithmic: false }],
  ["twenty", { min: 0, max: 20, step: 0.1, logarithmic: false }],
  ["fifty", { min: 0, max: 50, step: 0.1, logarithmic: false }],
  ["hundred", { min: 0, max: 100, step: 1, logarithmic: false }],
  ["pm_one", { min: -1, max: 1, step: 0.01, logarithmic: false }],
  ["pm_two", { min: -2, max: 2, step: 0.01, logarithmic: false }],
  ["pm_five", { min: -5, max: 5, step: 0.01, logarithmic: false }],
  ["pm_ten", { min: -10, max: 10, step: 0.1, logarithmic: false }],
  ["pm_twenty", { min: -20, max: 20, step: 0.1, logarithmic: false }],
  ["pm_fifty", { min: -50, max: 50, step: 0.1, logarithmic: false }],
  ["pm_hundred", { min: -100, max: 100, step: 1, logarithmic: false }],
]);

const makeUniform = (settings: UniformSettings, value: number): Uniform => {
  if (!settings) {
    settings = kDefaultUniform;
  }
  return {
    value:
      value == 0
        ? 0 >= settings.min && 0 <= settings.max
          ? 0
          : (settings.min + settings.max) / 2
        : value,
    ...settings,
  };
};

export const getDefaultUniform = (name: string, value: number = 0): Uniform => {
  if (name === "k") {
    return makeUniform(kPresetsMap.get("k"), value);
  } else if (
    name === "theta" ||
    name === "alpha" ||
    name === "beta" ||
    name === "phi"
  ) {
    return makeUniform(kPresetsMap.get("theta"), value);
  }
  for (const settings of kPresetsMap.values()) {
    if (value >= settings.min && value <= settings.max) {
      return makeUniform(settings, value);
    }
  }
  return kDefaultUniform;
};

const kPresetsNames: Map<string, string> = new Map([
  ["k", "smooth"],
  ["theta", "degrees"],
  ["one", "0 → 1"],
  ["two", "0 → 2"],
  ["five", "0 → 5"],
  ["ten", "0 → 10"],
  ["twenty", "0 → 20"],
  ["fifty", "0 → 50"],
  ["hundred", "0 → 100"],
  ["pm_one", "-1 → 1"],
  ["pm_two", "-2 → 2"],
  ["pm_five", "-5 → 5"],
  ["pm_ten", "-10 → 10"],
  ["pm_twenty", "-20 → 20"],
  ["pm_fifty", "-50 → 50"],
  ["pm_hundred", "-100 → 100"],
]);

const lookupPreset = (props: UniformSettings): string => {
  for (const [key, value] of kPresetsMap.entries()) {
    if (
      value.min === props.min &&
      value.max === props.max &&
      value.step === props.step &&
      value.logarithmic === props.logarithmic
    ) {
      return key;
    }
  }
  return "custom";
};

const UniformSettingsEditor: React.FC<UniformSettingsProps> = (props) => {
  const [preset, setPreset] = React.useState(lookupPreset(props));
  const [min, setMin] = React.useState(props.min.toString());
  const [max, setMax] = React.useState(props.max.toString());
  const [step, setStep] = React.useState(props.step.toString());

  React.useEffect(() => {
    const presetValue = kPresetsMap.get(preset);
    if (!presetValue) {
      return;
    }
    setMin(presetValue.min.toString());
    setMax(presetValue.max.toString());
    setStep(presetValue.step.toString());
  }, [preset]);

  const isValid = (): boolean => {
    return !isNaN(Number(min)) && !isNaN(Number(max)) && !isNaN(Number(step));
  };

  const commit = () => {
    const updateMin = Number(min);
    const updateMax = Number(max);
    props.onChange({
      min: Math.min(updateMin, updateMax),
      max: Math.max(updateMin, updateMax),
      step: Number(step),
      logarithmic: props.logarithmic,
    });
  };

  const discard = () => {
    props.onCancel();
  };

  return (
    <div
      style={{
        transform: "scale(0.8)",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5em",
        alignItems: "baseline",
      }}
    >
      <select value={preset} onChange={(e) => setPreset(e.target.value)}>
        <option value="custom">Custom</option>
        {Array.from(kPresetsNames.entries()).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <input
        type="text"
        style={{
          width: "2em",
          borderColor: isNaN(Number(min)) ? "red" : undefined,
        }}
        value={min}
        title="Minimum for value range"
        onChange={(e) => setMin(e.target.value)}
      />
      →
      <input
        type="text"
        value={max}
        title="Maximum for value range"
        style={{
          width: "2em",
          borderColor: isNaN(Number(max)) ? "red" : undefined,
        }}
        onChange={(e) => setMax(e.target.value)}
      />
      :
      <input
        type="text"
        value={step}
        title="Increment used for value slider"
        style={{
          width: "2em",
          borderColor: isNaN(Number(step)) ? "red" : undefined,
        }}
        onChange={(e) => setStep(e.target.value)}
      />
      <button
        style={{
          padding: 0,
          width: "2em",
          height: "2em",
          fontWeight: "bolder",
          borderWidth: 1.25,
        }}
        disabled={!isValid()}
        title="Accept these values"
        onClick={() => commit()}
      >
        ✓
      </button>
      <button
        style={{
          padding: 0,
          width: "2em",
          height: "2em",
          fontWeight: "bolder",
          borderWidth: 1.25,
        }}
        onClick={() => discard()}
        title="Cancel"
      >
        ✗
      </button>
    </div>
  );
};
