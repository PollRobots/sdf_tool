import sphere from "./sdf/sphere.wgsl";
import union from "./sdf/union.wgsl";
import intersection from "./sdf/intersection.wgsl";
import difference from "./sdf/difference.wgsl";
import rotate from "./sdf/rotate.wgsl";
import box from "./sdf/box.wgsl";
import roundedBox from "./sdf/rounded-box.wgsl";
import torus from "./sdf/torus.wgsl";
import cone from "./sdf/cone.wgsl";
import infiniteCone from "./sdf/infinite-cone.wgsl";
import infiniteCylinder from "./sdf/infinite-cylinder.wgsl";

const kShapeFunctions = new Map<string, string>([
  ["sdfSphere", sphere],
  ["sdfUnion", union],
  ["sdfIntersection", intersection],
  ["sdfDifference", difference],
  ["sdfRotate", rotate],
  ["sdfBox", box],
  ["sdfRoundedBox", roundedBox],
  ["sdfTorus", torus],
  ["sdfCone", cone],
  ["sdfInfiniteCylinder", infiniteCylinder],
]);

export const getShapeFn = (name: string): string => {
  const def = kShapeFunctions.get(name);
  if (!def) {
    throw new Error(`No function defined for ${name}`);
  }
  return def;
};
