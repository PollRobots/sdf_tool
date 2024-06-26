fn sdfSphere(
    pos: vec3<f32>,
    c: vec3<f32>,
    r: f32
) -> f32 {
    return length(pos- c) - r;
}
