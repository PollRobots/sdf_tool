fn sdfSphere(
    pos: vec3<f32>,
    transform: mat4x4<f32>,
    c: vec3<f32>,
    r: f32
) -> f32 {
    return length((vec4<f32>(pos, 1) * transform).xyz - c) - r;
}
