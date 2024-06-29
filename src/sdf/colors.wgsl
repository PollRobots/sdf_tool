const kRgbToXyzMat = mat3x3<f32>(
  vec3<f32>(0.4124, 0.2126, 0.0193),
  vec3<f32>(0.3576, 0.7152, 0.1192),
  vec3<f32>(0.1805, 0.0722, 0.9505));

fn colRgbToXyz(rgb: vec3<f32>) -> vec3<f32> {
  return kRgbToXyzMat * rgb;
}

fn colSRgbToXyz(sRgb: vec3<f32>) -> vec3<f32> {
  var rgb = select(sRgb / 12.92,
               pow((sRgb + 0.055) / 1.055, vec3<f32>(2.4)),
               sRgb > vec3<f32>(0.04045));
  return kRgbToXyzMat * rgb;
}

const kXyzToRgbMat = mat3x3<f32>(
  vec3<f32>(3.2046, -0.9689, 0.0577),
  vec3<f32>(-1.5372, 1.8758, -0.2040),
  vec3<f32>(-0.4986, 0.0415, 1.0570));

fn colXyzToSRgb(xyz: vec3<f32>) -> vec3<f32> {
  var rgb = kXyzToRgbMat * xyz;

  rgb = select(rgb * 12.92,
               1.055 * (pow(rgb, vec3<f32>(1/2.4)) - 0.055),
               rgb > vec3<f32>(0.0031308));

  return rgb;
}

const kReferenceD65 = vec3<f32>(0.950489, 1.00, 1.08884);

const kXyzToLabMat = mat4x3<f32>(
  vec3<f32>(0, 500, 0),
  vec3<f32>(116, -500, 200),
  vec3<f32>(0, 0, -200),
  vec3<f32>(-16, 0, 0));

fn colXyzToCIELab(xyz: vec3<f32>) -> vec3<f32> {
  var s = xyz / kReferenceD65;

  const d3 = (6.0 * 6.0 * 6.0) / (29.0 * 29.0 * 29.0);
  const i3d2 = (29.0 * 29.0) / (6.0 * 6.0 * 3);

  s = select(s * i3d2 + vec3<f32>(4.0/29.0),
             pow(s, vec3<f32>(1/3)),
             s > vec3<f32>(d3));

  return kXyzToLabMat * vec4<f32>(s, 1);
}

const kLabToXyzMat = mat4x3<f32>(
  vec3<f32>(1.0/116.0),
  vec3<f32>(0, 1.0/500.0, 0),
  vec3<f32>(0, 0, -1.0/200.0),
  vec3<f32>(16.0/116.0));

fn colCIELabToXyz(lab: vec3<f32>) -> vec3<f32> {
  var xyz = kLabToXyzMat * vec4<f32>(lab, 1);

  const d = vec3<f32>(6.0/29.0);
  const t3d2 = vec3<f32>((3.0 * 6.0 * 6.0) / (29.0 * 29.0));

  xyz = select(t3d2 * (xyz - vec3<f32>(4.0/29.0)),
               xyz * xyz * xyz,
               xyz > d);

  return xyz * kReferenceD65;
}

fn colCIELabToLch(lab: vec3<f32>) -> vec3<f32> {
  var h = degrees(atan2(lab.z, lab.y));
  h = select(h + 360, h, h >= 0);

  return vec3<f32>(
    lab.x,
    length(lab.yz),
    h);
}

fn colCIELchToLab(lch: vec3<f32>) -> vec3<f32> {
  var h = radians(lch.z);
  return vec3<f32>(lch.x, lch.y * cos(h), lch.y * sin(h));
}
