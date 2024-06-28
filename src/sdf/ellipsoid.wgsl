fn sdfEllipsoid(pos: vec3<f32>, center: vec3<f32>, radii: vec3<f32>) -> f32 {
  var p = pos - center;

  var k0 = length(p / radii);
  var k1 = length(p / (radii * radii));
  return k0 * (k0 - 1.0) / k1;
}
