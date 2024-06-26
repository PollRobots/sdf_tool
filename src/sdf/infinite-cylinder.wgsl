fn sdfInfiniteCylinder(pos: vec3<f32>, center: vec3<f32>, dir: vec3<f32>, radius: f32) -> f32 {
  var p = pos - center;
  return length(cross(p, p + normalize(dir))) - radius;
}
