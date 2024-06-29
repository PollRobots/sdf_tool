// The code in this file is derived from the colorspace.js library
// https://github.com/boronine/colorspaces.js

// Copyright (C) 2016 by Alexei Boronine
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// All Math on this page comes from http://www.easyrgb.com
const dot_product = (a: number[], b: number[]): number =>
  a.reduce((accum, el, i) => accum + el * b[i], 0);

// Rounds number to a given number of decimal places
const round = (num: number, places: number): number => {
  const m = Math.pow(10, places);
  return Math.round(num * m) / m;
};

// Returns whether given color coordinates fit within their valid range
const within_range = (vector: number[], ranges: [number, number][]): boolean =>
  vector.every((v, i) => {
    // Round to three decimal places to avoid rounding errors
    // e.g. R_rgb = -0.0000000001
    const rounded = round(v, 3);
    return rounded >= ranges[i][0] && rounded <= ranges[i][1];
  });

// The D65 standard illuminant
const ref_X = 0.95047;
const ref_Y = 1.0;
const ref_Z = 1.08883;
const ref_U = (4 * ref_X) / (ref_X + 15 * ref_Y + 3 * ref_Z);
const ref_V = (9 * ref_Y) / (ref_X + 15 * ref_Y + 3 * ref_Z);

// CIE L*a*b* constants
const lab_e = 0.008856;
const lab_k = 903.3;

// Used for Lab and Luv conversions
const f = (t: number): number => {
  if (t > lab_e) {
    return Math.pow(t, 1 / 3);
  } else {
    return 7.787 * t + 16 / 116;
  }
};
const f_inv = (t: number): number => {
  if (Math.pow(t, 3) > lab_e) {
    return Math.pow(t, 3);
  } else {
    return (116 * t - 16) / lab_k;
  }
};

export type Colorspace =
  | "CIEXYZ"
  | "CIExyY"
  | "CIELAB"
  | "CIELCH"
  | "CIELUV"
  | "CIELCHuv"
  | "sRGB"
  | "hex";
export type ColorTuple = [number, number, number];
export type ColorValue = ColorTuple | string;

type ConverterFunction = (value: ColorValue) => ColorValue;

// This map will contain our conversion functions
// conv[from][to] = (tuple) -> ...
const conv: Record<string, Record<string, ConverterFunction>> = {
  CIEXYZ: {},
  CIExyY: {},
  CIELAB: {},
  CIELCH: {},
  CIELUV: {},
  CIELCHuv: {},
  sRGB: {},
  hex: {},
};

conv["CIEXYZ"]["sRGB"] = (tuple: ColorValue) => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE XYZ format`);
  const m = [
    [3.2406, -1.5372, -0.4986],
    [-0.9689, 1.8758, 0.0415],
    [0.0557, -0.204, 1.057],
  ];
  const from_linear = (c: number) => {
    if (c <= 0.0031308) {
      return 12.92 * c;
    } else {
      return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    }
  };
  const _R = from_linear(dot_product(m[0], tuple));
  const _G = from_linear(dot_product(m[1], tuple));
  const _B = from_linear(dot_product(m[2], tuple));
  return [_R, _G, _B];
};

conv["sRGB"]["CIEXYZ"] = (tuple: ColorValue) => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in sRGB format`);
  const _R = tuple[0];
  const _G = tuple[1];
  const _B = tuple[2];
  const to_linear = (c: number) => {
    const a = 0.055;
    if (c > 0.04045) {
      return Math.pow((c + a) / (1 + a), 2.4);
    } else {
      return c / 12.92;
    }
  };
  const m = [
    [0.4124, 0.3576, 0.1805],
    [0.2126, 0.7152, 0.0722],
    [0.0193, 0.1192, 0.9505],
  ];
  const rgbl = [to_linear(_R), to_linear(_G), to_linear(_B)];
  const _X = dot_product(m[0], rgbl);
  const _Y = dot_product(m[1], rgbl);
  const _Z = dot_product(m[2], rgbl);
  return [_X, _Y, _Z];
};

conv["CIEXYZ"]["CIExyY"] = (tuple: ColorValue) => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE XYZ format`);
  const _X = tuple[0];
  const _Y = tuple[1];
  const _Z = tuple[2];
  const sum = _X + _Y + _Z;
  if (sum === 0) {
    return [0, 0, _Y];
  }
  return [_X / sum, _Y / sum, _Y];
};

conv["CIExyY"]["CIEXYZ"] = (tuple: ColorValue) => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE xyZ format`);
  const _x = tuple[0];
  const _y = tuple[1];
  const _Y = tuple[2];
  if (_y === 0) {
    return [0, 0, 0];
  }
  const _X = (_x * _Y) / _y;
  const _Z = ((1 - _x - _y) * _Y) / _y;
  return [_X, _Y, _Z];
};

conv["CIEXYZ"]["CIELAB"] = (tuple: ColorValue) => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE xyZ format`);
  const _X = tuple[0];
  const _Y = tuple[1];
  const _Z = tuple[2];
  const fx = f(_X / ref_X);
  const fy = f(_Y / ref_Y);
  const fz = f(_Z / ref_Z);
  const _L = 116 * fy - 16;
  const _a = 500 * (fx - fy);
  const _b = 200 * (fy - fz);
  return [_L, _a, _b];
};

conv["CIELAB"]["CIEXYZ"] = (tuple: ColorValue) => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE LAB format`);
  const _L = tuple[0];
  const _a = tuple[1];
  const _b = tuple[2];
  const var_y = (_L + 16) / 116;
  const var_z = var_y - _b / 200;
  const var_x = _a / 500 + var_y;
  const _X = ref_X * f_inv(var_x);
  const _Y = ref_Y * f_inv(var_y);
  const _Z = ref_Z * f_inv(var_z);
  return [_X, _Y, _Z];
};

conv["CIEXYZ"]["CIELUV"] = (tuple: ColorValue) => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE XYZ format`);
  const _X = tuple[0];
  const _Y = tuple[1];
  const _Z = tuple[2];
  const var_U = (4 * _X) / (_X + 15 * _Y + 3 * _Z);
  const var_V = (9 * _Y) / (_X + 15 * _Y + 3 * _Z);
  const _L = 116 * f(_Y / ref_Y) - 16;
  // Black will create a divide-by-zero error
  if (_L === 0) {
    return [0, 0, 0];
  }
  const _U = 13 * _L * (var_U - ref_U);
  const _V = 13 * _L * (var_V - ref_V);
  return [_L, _U, _V];
};

conv["CIELUV"]["CIEXYZ"] = (tuple: ColorValue) => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE XYZ format`);
  const _L = tuple[0];
  const _U = tuple[1];
  const _V = tuple[2];
  // Black will create a divide-by-zero error
  if (_L === 0) {
    return [0, 0, 0];
  }
  const var_Y = f_inv((_L + 16) / 116);
  const var_U = _U / (13 * _L) + ref_U;
  const var_V = _V / (13 * _L) + ref_V;
  const _Y = var_Y * ref_Y;
  const _X = 0 - (9 * _Y * var_U) / ((var_U - 4) * var_V - var_U * var_V);
  const _Z = (9 * _Y - 15 * var_V * _Y - var_V * _X) / (3 * var_V);
  return [_X, _Y, _Z];
};

const scalar_to_polar = (tuple: ColorValue): ColorValue => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE LAB or LUV format`);
  const _L = tuple[0];
  const var1 = tuple[1];
  const var2 = tuple[2];
  const _C = Math.pow(Math.pow(var1, 2) + Math.pow(var2, 2), 1 / 2);
  const _h_rad = Math.atan2(var2, var1);
  let _h = (_h_rad * 360) / 2 / Math.PI;
  if (_h < 0) {
    _h = 360 + _h;
  }
  return [_L, _C, _h];
};
conv["CIELAB"]["CIELCH"] = scalar_to_polar;
conv["CIELUV"]["CIELCHuv"] = scalar_to_polar;

const polar_to_scalar = (tuple: ColorValue): ColorValue => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in CIE LCH or Huv format`);
  const _L = tuple[0];
  const _C = tuple[1];
  const _h = tuple[2];
  const _h_rad = (_h / 360) * 2 * Math.PI;
  const var1 = Math.cos(_h_rad) * _C;
  const var2 = Math.sin(_h_rad) * _C;
  return [_L, var1, var2];
};
conv["CIELCH"]["CIELAB"] = polar_to_scalar;
conv["CIELCHuv"]["CIELUV"] = polar_to_scalar;

// Represents sRGB [0-1] values as [0-225] values. Errors out if value
// out of the range
const sRGB_prepare = (tuple: number[]): number[] => {
  tuple = tuple.map((n) => round(n, 3));
  if (tuple.some((n) => n < 0 || n > 1)) {
    throw new Error("Illegal sRGB value");
  }

  return tuple.map((ch) => Math.round(ch * 255));
};

conv["sRGB"]["hex"] = (tuple: ColorValue): ColorValue => {
  if (typeof tuple === "string")
    throw new Error(`${tuple} is not in sRGB format`);
  tuple = sRGB_prepare(tuple) as [number, number, number];

  return `#${tuple.map((ch) => ch.toString(16).padStart(2, "0")).join("")}`;
};

conv["hex"]["sRGB"] = (hex: ColorValue): ColorValue => {
  if (typeof hex !== "string") throw new Error(`${hex} is not in hex format`);
  if (hex.charAt(0) === "#") {
    hex = hex.substring(1, 7);
  }
  const r = hex.substring(0, 2);
  const g = hex.substring(2, 4);
  const b = hex.substring(4, 6);
  return [r, g, b].map((n) => parseInt(n, 16) / 255) as [
    number,
    number,
    number
  ];
};

export const converter = (
  from: Colorspace,
  to: Colorspace
): ConverterFunction => {
  // The goal of this function is to find the shortest path
  // between `from` and `to` on this tree:
  //
  //         - CIELAB - CIELCH
  //  CIEXYZ - CIELUV - CIELCHuv
  //         - sRGB - hex
  //         - CIExyY
  //
  // Topologically sorted nodes (child, parent)
  const tree: [Colorspace, Colorspace][] = [
    ["CIELCH", "CIELAB"],
    ["CIELCHuv", "CIELUV"],
    ["hex", "sRGB"],
    ["CIExyY", "CIEXYZ"],
    ["CIELAB", "CIEXYZ"],
    ["CIELUV", "CIEXYZ"],
    ["sRGB", "CIEXYZ"],
  ];
  // Recursively generate path. Each recursion makes the tree
  // smaller by elimination a leaf node. This leaf node is either
  // irrelevant to our conversion (trivial case) or it describes
  // an endpoint of our conversion, in which case we add a new
  // step to the conversion and recurse.
  const path = (
    tree: [Colorspace, Colorspace][],
    from: Colorspace,
    to: Colorspace
  ): ConverterFunction => {
    if (from === to) {
      return (t: ColorValue) => t;
    }
    const child = tree[0][0];
    const parent = tree[0][1];
    // If we start with hex (a leaf node), we know for a fact that
    // the next node is going to be sRGB (others by analogy)
    if (from === child) {
      // We discovered the first step, now find the rest of the path
      // and return their composition
      const p = path(tree.slice(1), parent, to);
      return (t) => p(conv[child][parent](t));
    }
    // If we need to end with hex, we know for a fact that the node
    // before it is going to be sRGB (others by analogy)
    if (to === child) {
      // We found the last step, now find the rest of the path and
      // return their composition
      const p = path(tree.slice(1), from, parent);
      return (t) => conv[parent][child](p(t));
    }
    // The current tree leaf is irrelevant to our path, ignore it and
    // recurse
    return path(tree.slice(1), from, to);
  };

  // Main conversion function
  return path(tree, from, to);
};

export function make_color(space: "hex", value: string): Color;
export function make_color(space: Colorspace, value: ColorValue): Color;
export function make_color(space: Colorspace, value: ColorValue): Color {
  if (space === "hex") {
    if (typeof value !== "string") {
      throw new Error("hex colors must be provided as strings.");
    }
    return new Color(space, value);
  } else {
    if (typeof value === "string") {
      throw new Error(`${space} colors must be provided as tuples.`);
    }
    return new Color(space, value);
  }
}

class Color {
  readonly colorspace: Colorspace;
  readonly value: ColorValue;

  constructor(space: "hex", tuple: string);
  constructor(space: Colorspace, tuple: ColorTuple);
  constructor(space: Colorspace, tuple: ColorValue) {
    this.colorspace = space;
    this.value = tuple;
  }

  as(target: "hex"): string;
  as(target: Colorspace): ColorTuple;
  as(target: Colorspace): ColorValue {
    return converter(this.colorspace, target)(this.value);
  }

  is_displayable(): boolean {
    const val = converter(this.colorspace, "sRGB")(this.value) as [
      number,
      number,
      number
    ];
    return within_range(val, [
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
  }

  is_visible(): boolean {
    const val = converter(this.colorspace, "CIEXYZ")(this.value) as [
      number,
      number,
      number
    ];
    return within_range(val, [
      [0, ref_X],
      [0, ref_Y],
      [0, ref_Z],
    ]);
  }
}
