fn sdfIntersection(k: f32, d1: f32, d2: f32, c1: vec3<f32>, c2: vec3<f32>) -> vec4<f32> {
    if (k <= 0) {
        return select(vec4<f32>(c2, d1), vec4<f32>(c1, d2), vec4<bool>(d1 < d2));
    }
    var k4 = k * 4.0;
    var delta = d1 - d2;
    var h = max(k4 - abs(d1 - d2), 0) / k4;

    return vec4<f32>(
        mix(c1, c2, smoothstep(-k4, k4, delta)),
        max(d1, d2) + h * h * k,
    );
}
