fn sdfTorus(pos: vec3<f32>, center: vec3<f32>, major: f32, minor: f32) -> f32 {
  var p = pos - center;
  var q = vec2<f32>(length(p.xz) - major, p.y);
  return length(q) - minor;
}
