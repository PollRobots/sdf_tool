fn sdfPlane(pos: vec3<f32>, normal: vec3<f32>, offset: f32) -> f32 {
  return dot(pos, normalize(normal)) - offset;
}
