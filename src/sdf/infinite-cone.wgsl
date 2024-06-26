fn sdfInfiniteCone(pos: vec3<f32>, tip: vec3<f32>, angle: f32) -> f32 {
  var c = vec2<f32>(sin(angle), cos(angle));
  var p = pos - tip;
  var q = vec2<f32>(length(p.xz), -p.y);
  var d = length(q - c * max(dot(q, c), 0));
  return d * sign(q.x * c.y - q.y * c.x);
}
