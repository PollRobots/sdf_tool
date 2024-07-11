import { Vector } from "./dsl";

const parseWgslConstVector = (vec: string): Vector => {
  const m = vec.match(/^vec3\<f32\>\(([^)]*)\)$/);
  if (!m) {
    throw new Error(`${vec} is not a const vector`);
  }
  var parts = m[1].split(",").map((el) => Number(el));
  if (parts.length != 3 || parts.some(isNaN)) {
    throw new Error(`${vec} is not a const vector`);
  }

  return {
    x: parts[0],
    y: parts[1],
    z: parts[2],
  };
};

// fn sdfRotate(pos: vec3<f32>, axis: vec3<f32>, angle: f32) -> vec3<f32> {
//     var u = normalize(axis);
//     var c = cos(angle);
//     var ic = 1 - c;
//     var su = sin(angle) * u;

//     var mat = mat3x3<f32>(
//         ic * u.x * u + vec3<f32>(c, su.z, - su.y),
//         ic * u.y * u + vec3<f32>(-su.z, c, su.x),
//         ic * u.z * u + vec3<f32>(su.y, -su.x, c)
//     );

//     return mat * pos;
// }

const f = (v: number) => Number(v.toFixed(4));

export const generateConstRotationMatrix = (
  axis: string,
  angle: number
): string[] => {
  const axis_vec = parseWgslConstVector(axis);
  const length = Math.sqrt(
    axis_vec.x * axis_vec.x + axis_vec.y * axis_vec.y + axis_vec.z * axis_vec.z
  );
  const u: Vector = {
    x: axis_vec.x / length,
    y: axis_vec.y / length,
    z: axis_vec.z / length,
  };

  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ic = 1 - c;
  const su: Vector = { x: u.x * s, y: u.y * s, z: u.z * s };

  // prettier-ignore
  return [
    "  const rot = mat3x3<f32>(",
    `    vec3<f32>(${f(ic * u.x * u.x +    c)}, ${f(ic * u.x * u.y + su.z)}, ${f(ic * u.x * u.z - su.y)}),`,
    `    vec3<f32>(${f(ic * u.y * u.x - su.z)}, ${f(ic * u.y * u.y +    c)}, ${f(ic * u.y * u.z + su.x)}),`,
    `    vec3<f32>(${f(ic * u.z * u.x + su.y)}, ${f(ic * u.z * u.y - su.x)}, ${f(ic * u.z * u.z +    c)}));`,
  ];
};

export const generateConstAxisRotationMatrix = (
  axis: string,
  angle: string
): string[] => {
  const axis_vec = parseWgslConstVector(axis);
  const length = Math.sqrt(
    axis_vec.x * axis_vec.x + axis_vec.y * axis_vec.y + axis_vec.z * axis_vec.z
  );
  const u: Vector = {
    x: axis_vec.x / length,
    y: axis_vec.y / length,
    z: axis_vec.z / length,
  };

  const c = `  let c = cos(${angle});`;
  const s = `  let s = sin(${angle});`;
  const ic = `  let ic = 1 - c;`;

  const m = (a: string, b: number): string => {
    b = f(b);
    if (Math.abs(b) < 1e-10) {
      return "0";
    } else if (Math.abs(b - 1) < 1e-10) {
      return a;
    } else {
      return `${a} * ${b}`;
    }
  };

  const add = (op: "+" | "-", a: string, b: string): string => {
    if (op === "+" && a === "ic" && b === "c") {
      return "1";
    } else if (a === "0" && b === "0") {
      return "0";
    } else if (a === "0") {
      return op === "+" ? b : `-${b}`;
    } else if (b === "0") {
      return a;
    } else {
      return `${a} ${op} ${b}`;
    }
  };

  // prettier-ignore
  return [
    c, s, ic,
    "  let rot = mat3x3<f32>(",
    `    vec3<f32>(${add('+', m('ic', u.x * u.x),         'c')}, ${add('+', m('ic', u.x * u.y), m('s', u.z))}, ${add('-', m('ic', u.x * u.z), m('s', u.y))}),`,
    `    vec3<f32>(${add('-', m('ic', u.y * u.x), m('s', u.z))}, ${add('+', m('ic', u.y * u.y),         'c')}, ${add('+', m('ic', u.y * u.z), m('s', u.x))}),`,
    `    vec3<f32>(${add('+', m('ic', u.z * u.x), m('s', u.y))}, ${add('-', m('ic', u.z * u.y), m('s', u.x))}, ${add('+', m('ic', u.z * u.z),         'c')}));`,
  ];
};

export const generateConstAngleRotationMatrix = (
  axis: string,
  angle: number
): string[] => {
  const c = Math.cos(angle);
  const ic = 1 - c;

  return [
    `  let u = normalize(${axis});`,
    `  let su = u * ${Math.sin(angle)}`,
    "  let rot = mat3x3<f32>(",
    `    ${ic} * u.x * u + vec3<f32>(${c}, su.z, -su.y),`,
    `    ${ic} * u.y * u + vec3<f32>(-su.z, ${c}, su.x),`,
    `    ${ic} * u.z * u + vec3<f32>(su.y, -su.x, ${c});`,
  ];
};
