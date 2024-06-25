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

export const generateConstRotationMatrix = (
  axis: string,
  angle: number
): string[] => {
  const axis_vec = parseWgslConstVector(axis);
  const length = Math.sqrt(
    axis_vec.x * axis_vec.x + axis_vec.y * axis_vec.y + axis_vec.z
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
    `    vec3<f32>(${ic * u.x * u.x +    c}, ${ic * u.x * u.y + su.z}, ${ic * u.x * u.z - su.y}),`,
    `    vec3<f32>(${ic * u.y * u.x - su.z}, ${ic * u.y * u.y +    c}, ${ic * u.y * u.z + su.x}),`,
    `    vec3<f32>(${ic * u.z * u.x + su.y}, ${ic * u.z * u.y - su.x}, ${ic * u.z * u.z +    c}));`,
  ];
};

export const generateConstAxisRotationMatrix = (
  axis: string,
  angle: string
): string[] => {
  const axis_vec = parseWgslConstVector(axis);
  const length = Math.sqrt(
    axis_vec.x * axis_vec.x + axis_vec.y * axis_vec.y + axis_vec.z
  );
  const u: Vector = {
    x: axis_vec.x / length,
    y: axis_vec.y / length,
    z: axis_vec.z / length,
  };

  const c = `  var c = cos(${angle});`;
  const s = `  var s = sin(${angle});`;
  const ic = `  var ic = 1 - c;`;

  const m = (a: string, b: number): string => {
    if (Math.abs(b) < 1e-10) {
      return "0";
    } else if (Math.abs(b - 1) < 1e-10) {
      return a;
    } else {
      return `a * ${b}`;
    }
  };

  // prettier-ignore
  return [
    c, s, ic,
    "  var rot = mat3x3<f32>(",
    `    vec3<f32>(${m('ic', u.x * u.x)} +              c, ${m('ic', u.x * u.y)} + ${m('s', u.z)}, ${m('ic', u.x * u.z)} - ${m('s', u.y)}),`,
    `    vec3<f32>(${m('ic', u.y * u.x)} - ${m('s', u.z)}, ${m('ic', u.y * u.y)} +              c, ${m('ic', u.y * u.z)} + ${m('s', u.x)}),`,
    `    vec3<f32>(${m('ic', u.z * u.x)} + ${m('s', u.y)}, ${m('ic', u.z * u.y)} - ${m('s', u.x)}, ${m('ic', u.z * u.z)} +              c));`,
  ];
};

export const generateConstAngleRotationMatrix = (
  axis: string,
  angle: number
): string[] => {
  const c = Math.cos(angle);
  const ic = 1 - c;

  return [
    `  var u = normalize(${axis});`,
    `  var su = u * ${Math.sin(angle)}`,
    "  var rot = mat3x3<f32>(",
    `    ${ic} * u.x * u + vec3<f32>(${c}, su.z, -su.y),`,
    `    ${ic} * u.y * u + vec3<f32>(-su.z, ${c}, su.x),`,
    `    ${ic} * u.z * u + vec3<f32>(su.y, -su.x, ${c});`,
  ];
};
