fn sdfSphere(
    pos: vec3<f32>,
    transform: mat4x4<f32>,
    k: f32,
    c: vec3<f32>,
    r: f32
) -> f32 {
    return length(pos * transform - c) - r;
}
