fn sdfRoundedBox(pos: vec3<f32>, center: vec3<f32>, size: vec3<f32>, r: f32) -> f32 {
    var q = abs(pos - center) - size + r;
    return length(max(q, vec3<f32>(0))) + min(max(q.x, max(q.y, q.z)), 0) - r;
}
