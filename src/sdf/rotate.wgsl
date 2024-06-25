fn sdfRotate(pos: vec3<f32>, axis: vec3<f32>, angle: f32) -> vec3<f32> {
    var u = normalize(axis);
    var c = cos(angle);
    var ic = 1 - c;
    var su = sin(angle) * u;

    var mat = mat3x3<f32>(
        ic * u.x * u + vec3<f32>(c, su.z, - su.y),
        ic * u.y * u + vec3<f32>(-su.z, c, su.x),
        ic * u.z * u + vec3<f32>(su.y, -su.x, c)
    );

    return mat * pos;
}