fn sdfDisk(pos: vec3<f32>, normal: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
  var p = pos - center;
  return max(abs(dot(p, normalize(normal))),
             length(p) - radius);
}
