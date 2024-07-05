fn tmod(x: vec2<f32>) -> vec2<f32> {
  return x - kTextureSize * floor(x / kTextureSize);
}


fn randomGradient(pt: vec3<f32>) -> vec3<f32> {
  var spt = tmod(pt.xy + 101 * pt.z);

  var t = textureLoad(noiseTexture, vec2<u32>(spt), 0);

  return t.xyz * 2 - 1;
}

fn dotGridGradient(corner: vec3<f32>, pt: vec3<f32>) -> f32 {
  return dot(corner - pt, randomGradient(corner));
}

fn perlin3(p: vec3<f32>, octave: f32) -> f32 {
  var pt = p * octave;
  var p0 = floor(pt);
  var p1 = p0 + 1;

  var frac = pt - p0;

  // gradients for the corners where z is 0
  var gvv0 = vec4<f32>(
    dotGridGradient(select(p0, p1, vec3<bool>(false, false, false)), pt),
    dotGridGradient(select(p0, p1, vec3<bool>(true, false, false)), pt),
    dotGridGradient(select(p0, p1, vec3<bool>(false, true, false)), pt),
    dotGridGradient(select(p0, p1, vec3<bool>(true, true, false)), pt));
  // gradients for the corners where z is true
  var gvv1 = vec4<f32>(
    dotGridGradient(select(p0, p1, vec3<bool>(false, false, true)), pt),
    dotGridGradient(select(p0, p1, vec3<bool>(true, false, true)), pt),
    dotGridGradient(select(p0, p1, vec3<bool>(false, true, true)), pt),
    dotGridGradient(select(p0, p1, vec3<bool>(true, true, true)), pt));

  frac = smoothstep(vec3<f32>(0), vec3<f32>(1), frac);

  // mix w.r.t. z fraction
  var gvvm = mix(gvv0, gvv1, frac.z);
  // xy components represent y = 0, zw components represet z = 1
  // mix w.r.t. y fraction
  var gvmm = mix(gvvm.xy, gvvm.zw, frac.y);

  // mix w.r.t. x fraction
  return mix(gvmm.x, gvmm.y, frac.x) / octave;
}
