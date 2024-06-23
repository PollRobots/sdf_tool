export interface NamedColors {
  yellow: string;
  orange: string;
  red: string;
  magenta: string;
  violet: string;
  blue: string;
  cyan: string;
  green: string;
}

export interface BaseColors extends NamedColors {
  base03: string;
  base02: string;
  base01: string;
  base00: string;
  base0: string;
  base1: string;
  base2: string;
  base3: string;
}

export interface Theme extends BaseColors {
  name: string;
  foreground: string;
  background: string;
  boldForeground: string;
  boldBackground: string;
}
