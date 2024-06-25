fn sdfDifference(k: f32, d1: f32, d2: f32) -> f32 {
    if k <= 0 {
        return max(d1, -d2);
    }
    var k4 = k * 4.0;
    var h = max(k4 - abs(d1 + d2), 0) / k4;
    return max(d1, -d2) + h * h * k;
}
