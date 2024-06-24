import sphere from "./sdf/sphere.wgsl";

const kShapeFunctions = new Map<string, string>([["sdfSphere", sphere]]);

export const getShapeFn = (name: string): string => {
  const def = kShapeFunctions.get(name);
  if (!def) {
    throw new Error(`No function defined for ${name}`);
  }
  return def;
};
