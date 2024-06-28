fn sdfAsymmetricEllipsoid(pos: vec3<f32>, center: vec3<f32>, r1: vec3<f32>, r2: vec3<f32>) -> f32 {
  var p = pos - center;
  var radii = select(r1, r2, p > vec3<f32>(0));

  var k0 = length(p / radii);
  var k1 = length(p / (radii * radii));
  return k0 * (k0 - 1.0) / k1;
}
