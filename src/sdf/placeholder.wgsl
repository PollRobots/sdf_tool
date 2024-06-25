fn map(pos: vec3<f32>) -> f32 {
    return length(pos - vec3<f32>(0, 1, 0)) - 1;
}
