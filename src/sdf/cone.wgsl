fn sdfCone(pos: vec3<f32>, center: vec3<f32>, angle: f32, height: f32) -> f32 {
  var p = pos - center;
  var q = height * vec2<f32>(tan(angle), -1);

  var w = vec2<f32>(length(p.xz), p.y);
  var a = w - q * saturate(dot(w, q) / dot(q, q));
  var b = w - vec2<f32>(q.x * saturate(w.x / q.x), q.y);
  var k = sign(q.y);
  var d = min(dot(a, a), dot(b, b));
  var s = max(k * (w.x * q.y - w.y * q.x), k * (w.y - q.y));
  return sqrt(d) * sign(s);
}
