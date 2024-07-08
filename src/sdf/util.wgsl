fn cartesianToSpherical(p: vec3<f32>) -> vec3<f32> {
    var r = length(p);

    return vec3<f32>(
        r,
        acos(p.y / r), // theta
        atan2(p.z, p.x), // phi
    );
}

fn sphericalToCartesian(s: vec3<f32>) -> vec3<f32> {
    var sin_theta = sin(s.y);

    return vec3<f32>(
        s.x * sin_theta * cos(s.z),
        s.x * cos(s.y),
        s.x * sin_theta * sin(s.z),
    );
}