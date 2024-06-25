import sphere from "./sdf/sphere.wgsl";
import union from "./sdf/union.wgsl";
import intersection from "./sdf/intersection.wgsl";
import difference from "./sdf/difference.wgsl";
import rotate from "./sdf/rotate.wgsl";

const kShapeFunctions = new Map<string, string>([
  ["sdfSphere", sphere],
  ["sdfUnion", union],
  ["sdfIntersection", intersection],
  ["sdfDifference", difference],
  ["sdfRotate", rotate],
]);

export const getShapeFn = (name: string): string => {
  const def = kShapeFunctions.get(name);
  if (!def) {
    throw new Error(`No function defined for ${name}`);
  }
  return def;
};
