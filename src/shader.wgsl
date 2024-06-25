struct Uniforms {
    resolution: vec4<f32>,
    rotation: vec4<f32>,
    //UNIFORM-VALUES//
}

@binding(0) @group(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

const CORNERS = array<vec4<f32>, 3> (
    vec4<f32>(-1, -3, 0, 1),
    vec4<f32>(3, 1, 0, 1),
    vec4<f32>(-1, 1, 0, 1),
);

@vertex
fn vertex_main(
@builtin(vertex_index) index : u32
) -> VertexOutput {
    return VertexOutput(
        CORNERS[index],
        (CORNERS[index].xy + vec2<f32>(1)) * 0.5,
    );
}

//MAP-FUNCTION//

fn colormap(pos: vec3<f32>) -> vec4<f32> {
    return vec4<f32>(map(pos), 0.3, 0, 0);
}

fn raycast(ro:vec3<f32>, rd:vec3<f32>) -> vec4<f32> {
    var res = vec4<f32>(-1);

    var tmin = 1.0;
    var tmax = 20.0;

    var tp1 = (0.0 - ro.y) / rd.y;
    if (tp1 > 0) {
        tmax = min(tmax, tp1);
        res = vec4<f32>(tp1, 0.5, 0.5, 0.5);
    }

    var t = tmin;
    for (var i = 0; i < 70 && t < tmax; i++) {
        var h = colormap(ro + rd * t);
        if (abs(h.x) < 1e-4 * t) {
            return vec4<f32>(t, h.y, h.z, h.w);
        }
        t += h.x;
    }
    return res;
}

const EPSILON = vec2<f32>(1, -1) * 0.5773 * 0.0005;

fn calcSoftShadow(ro: vec3<f32>, rd: vec3<f32>, mint: f32, tmax: f32) -> f32
{
    var tp = (0.8 - ro.y) /rd.y;
    var ltmax = tmax;
    if (tp > 0) {
        ltmax = min(ltmax, tp);
    }

    var res = 1.0;
    var t = mint;
    for (var i = 0; i < 24; i++) {
        var h = map(ro+rd*t);
        var s = clamp(8.0* h / t, 0, 1);
        res = min(res, s);
        t += clamp(h, 0.01, 0.2);
        if (res < 0.004 || t>ltmax) {
            break;
        }
    }
    res = clamp(res, 0, 1);
    return res * res * (3.0 - 2 * res);
}

fn calcNormal(pos: vec3<f32>) -> vec3<f32> {
    return normalize(EPSILON.xyy * map(pos + EPSILON.xyy) +
                     EPSILON.yyx * map(pos + EPSILON.yyx) +
                     EPSILON.yxy * map(pos + EPSILON.yxy) +
                     EPSILON.xxx * map(pos + EPSILON.xxx));
}

fn calcAO(pos: vec3<f32>, nor: vec3<f32>) -> f32 {
    var occ: f32 = 0;
    var sca: f32 = 0;
    for (var i = 0; i < 5; i++) {
        var h = 0.01 + 0.12*f32(1) / 4;
        var d = map(pos + h * nor);
        occ += (h - d) * sca;
        sca *= 0.95;
        if (occ > 0.35) {
            break;
        }
    }
    return saturate(1 - 3 * occ) * (0.5 + 0.5 * nor.y);
}

fn render(ro: vec3<f32>, rd:vec3<f32>, rdx: vec3<f32>, rdy: vec3<f32>) -> vec3<f32> {
    var col = vec3<f32>(0.7, 0.7, 0.9) - max(rd.y, 0) * 0.3;

    var res = raycast(ro, rd);
    var t = res.x;

    if (t > 0) {
        var pos = ro + t * rd;

        col  = res.yzw;
        var nor = vec3<f32>(0, 1, 0);
        var ks:f32 = 1;
        if (pos.y < 1e-4) {
            //var i = smoothstep(vec2<f32>(0.45), vec2<f32>(0.55), 2 * abs(fract(3 * pos.xz) * 0.5 - 0.5));
            //col = 0.15 +  (0.5 - 0.5 * (i.x + i.y)) * vec3<f32>(0.05);
            var dpdx = 2 * ro.y * (rd/rd.y - rdx/rdx.y);
            var dpdy = 2 * ro.y * (rd/rd.y - rdy/rdy.y);

            var w = abs(dpdx.xz) + abs(dpdy.xz) + 0.001;
            var i = 2 * (abs(fract((2 * pos.xz - 0.5 * w) * 0.5) - 0.5) -
                         abs(fract((2 * pos.xz + 0.5 * w) * 0.5) - 0.5)) / w;
            var f = 0.5 - 0.5 * i.x * i.y;
            col = 0.15 + f * vec3<f32>(0.04);
            ks = 0.4;
        } else {
            nor = calcNormal(pos);
        }

        var occ = calcAO(pos, nor);
        var rf = reflect(rd, nor);
        var lin = vec3<f32>(0);

        // sun
        {
            const lig = normalize(vec3(0.5, 0.4, 0.6));
            var ha = normalize(lig - rd);
            var dif = clamp(dot(nor, lig), 0, 1);
            dif *= calcSoftShadow(pos, lig, 0.02, 2.5);

            var spe = pow(saturate(dot(nor, ha)), 16);
            spe *= dif;
            spe *= 0.04 + 0.96 * pow(saturate(1 - dot(ha, lig)), 5);

            lin += col * 2 * dif * vec3<f32>(1.3, 1., 0.7);
            lin += 2 * spe * vec3<f32>(1.3, 1, 0.7) * ks;
        }
        // sky
        {
            var dif = sqrt(saturate(0.5 * 0.5 * nor.y));
            dif *= occ;
            var spe = smoothstep(-0.2, 0.2, rf.y);
            spe *= dif;
            spe *= 0.04 + 0.96*pow(saturate(1 + dot(nor, rd)), 5);
            spe *= calcSoftShadow(pos, rf, 0.02, 2.5);
            lin += col * 0.6 * dif * vec3<f32>(0.4, 0.6, 1.15);
            lin += 2 * spe * vec3<f32>(0.4, 0.6, 1.3) * ks;
        }
        // back
        {
            var dif = saturate(dot(nor, normalize(vec3<f32>(0.5, 0,0.6)))) * saturate(1  - pos.y);
            dif *= occ;
            lin += col * 0.55 * dif * 0.25;
        }
        // sss?
        {
            var dif = pow(saturate(1 + dot(nor, rd)), 2);
            dif *= occ;
            lin += col * 0.25 * dif;
        }

        col = lin;
        // fog
        col = mix(col, vec3<f32>(0.7, 0.7, 0.9), 1.0 - exp(-0.0001 * t *t *t));
    }
    return col;
}

fn setCamera(ro: vec3<f32>, ta: vec3<f32>, cr: f32) -> mat3x3<f32> {
    var cw = normalize(ta - ro);
    var cp = vec3<f32>(sin(cr), cos(cr), 0.0);
    var cu = normalize(cross(cw, cp)) ;
    var cv = cross(cu, cw);

    return mat3x3<f32>(cu, cv, cw);
}

@fragment
fn frag_main(
    frag: VertexOutput
) -> @location(0) vec4<f32> {
    var cx = radians(clamp(uniforms.rotation.x, 1, 89));
    var cy = radians(uniforms.rotation.y);
    const CAMERA_DISTANCE = 5.0;
    var cam_height = CAMERA_DISTANCE * sin(cx);
    var cam_hdist = CAMERA_DISTANCE * cos(cx);

    var ta = vec3<f32>(0, 0, 0);
    var ro = ta + vec3<f32>(cam_hdist * sin(cy), cam_height, cam_hdist * cos(cy));
    var ca = setCamera(ro, ta, 0.0);

    var fragCoord = frag.uv * uniforms.resolution.xy;
    var p = (2.0 * fragCoord - uniforms.resolution.xy) / uniforms.resolution.y;

    const fl:f32 = 1;
    var rd = ca * normalize(vec3<f32>(p, fl));
    var px = (2 * (fragCoord + vec2<f32>(1,0)) - uniforms.resolution.xy) / uniforms.resolution.y;
    var py = (2 * (fragCoord + vec2<f32>(0,1)) - uniforms.resolution.xy) / uniforms.resolution.y;
    var rdx = ca * normalize(vec3<f32>(px, fl));
    var rdy = ca * normalize(vec3<f32>(py, fl));

    var col = render(ro, rd, rdx, rdy);
    col = pow(col, vec3<f32>(0.4545));
    return vec4<f32>(col, 1);
}
