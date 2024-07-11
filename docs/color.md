# Color

![Color](color.doc)

When [combinators](combinators) are applied to shapes with different colors with
a smoothing factor that is non-zero, then the colors are also smoothed together,
for example:

```example
(union 0.15
    (color (rgb-xyz #<1 0 0>)
        (sphere #<-0.5 1 0> 1))
    (color (rgb-xyz #<0 0 1>)
        (sphere #<0.5 1 0> 1)))
```

Creates overlapping red and blue spheres and smooths them together (0.15 is a
relatively high smoothing factor), the color evenly blends as the shapes blend.

## Color space

This tool processes color internally within the shader in the CIE XYZ
colorspace. This is makes the math that operates on color values easier in the
shader pipeline, because the color values are in a linear space,
but it can be harder to reason about them.

To demonstrate this, the following example colors a cube with a blend of red →
blue from left → right. On the top half of the cube, the colors are converted
from sRGB to CIE XYZ before being blended. On the bottom half they are blended
in sRGB space, and then converted to CIE XYZ.

```example
#|start-interactive-values
  view.z = 0.55
  view.x = 0
  rgb-left.x = 1
  rgb-right.z = 1
end-interactive-values|#

(scale 2 (translate #<-0.5 0.5 0>
  (color (if (> (get-y :pos) 0)
             (mix (rgb-xyz :#<rgb-left>)
                  (rgb-xyz :#<rgb-right>)
                  (get-x :pos))
             (rgb-xyz (mix :#<rgb-left>
                            :#<rgb-right>
                            (get-x :pos))))
    (box #<0.5 0 0> #<0.5>))))
```

The blend in XYZ space (the top half) is a more uniform progression from one
color to the other, whereas in sRGB space (the bottom half) it is less uniform,
and also passes through a “muddy‟ middle ground.

You can experiment with other color blends by using the **edit** button on the
example to copy the example into the editor. The `rgb-left` and `rgb-right`
vectors are interactive.

The `mix` function performs a linear-interpolation (lerp) between the first and
second values according to the third value, which clamped between 0 and 1. The
box in the example has been positioned to ensure that the x-coordinate is 0 on
the left hand edge and 1 on the right hand edge.

## Supported Color Spaces

### sRGB

[sRGB](https://en.wikipedia.org/wiki/sRGB) is the standard color space used for
web presentation. The three color channels represent red, green, and blue, and
have ranges from 0→1. Every rgb value where each channel is between 0 and 1 is
displayable. The other colorspaces can represent colors outside of these bounds,
some of which would be considered visible, but cannot be represented on screen,
and others are outside the gamut of human vision.

### CIE XYZ

[CIE 1931 XYZ](https://en.wikipedia.org/wiki/CIEXYZ) is the color space used
internally in the shader. Colors are converted to sRGB only at the final stage
of setting the pixel value. The three color values X, Y, Z can have ranges from 0 -> (0.950489, 1, 1.08884) respectively. These limits are derived from the
D65 standard illuminant. Any color in the XYZ color space that is within these
bounds can be considered ‘visible‛, but not all of those colors will be
displayable.

### CIE L\*a\*b\*

[CIE L\*a\*b\*](https://en.wikipedia.org/wiki/CIELAB_color_space) is an
approximately perceptually uniform color space derived from CIE XYZ.

- The L\* (L-star) value is a lightness value between 0&ndash;black, and
  100&ndash;white.
- The a\* value represents a green↔red axis, with negative values adding green,
  and positive values adding red.
- The b\* value represents a blue↔yellow axis, with negative values adding blue,
  and positive values adding yellow.

The a\* and b\* values aren't formally bounded, but useful values are typically
between ±150

### CIE L\*C\*h

[CIE
L\*C\*h°](https://en.wikipedia.org/wiki/CIELAB_color_space#Cylindrical_model) is
a transformation of the CIE L\*a\*b\* color space into cylindrical polar
coordinates.

- The L\* value has the same interpretation as in LAB space, lightness between 0&ndash;black and 100&ndash;white.
- C\* is the length of the vector <a\*, b\*>, and represents chromaticity
- h° is an angle in degrees, where 0°&ndash;red, 90°&ndash;yellow,
  180°&ndash;green, 270°&ndash;blue. Note that this is similar to, but
  not the same as the H value in HSL or HSV color models.

```example
#|start-interactive-values
  view.z = 0.3
  c = 75 [0:100:1]
  l = 50 [0:100:1]
end-interactive-values|#

(union
  (color (saturate-xyz (lch-xyz #<:l :c 0>))
    (sphere #<-3 1 0> 1))
  (color (saturate-xyz (lch-xyz #<:l :c 90>))
    (sphere #<-1 1 0> 1))
  (color (saturate-xyz (lch-xyz #<:l :c 180>))
    (sphere #<1 1 0> 1))
  (color (saturate-xyz (lch-xyz #<:l :c 270>))
    (sphere #<3 1 0> 1)))
```

This shows four spheres each with the same lightness and chrominance values at
the four cardinal color directions in the L\*C\*h° color space.

## Conversion Functions

This tool processes color internally within the shader in the CIE XYZ
color space. This is makes the math that operates on color values easier in the
shader pipeline, because the color values are in a linear space, but it is
harder to reason about them.

The following conversion functions are provided which can make manipulating colors easier.

For example, to make a color `a` in XYZ space 10% lighter you could use

```
(lab-xyz (* (xyz-lab a) #<1.1 1 1>))
```

This translates the color into the CIE LAB color space, then multiplies the L
component by 1.1, and converts back to CIE XYZ

Or to adjust the hue by a fixed value without changing saturation or lightness

```
(lch-xyz (+ (xyz-lch a) #<0 0 20>))
```

This converts to the CIE LCH color space (via CIE LAB) (where the H is a hue
value in degrees), adds 20° and then converts back.

![RGB → XYZ](rgb-xyz.doc)
![XYZ → RGB](xyz-rgb.doc)
![LAB → XYZ](lab-xyz.doc)
![XYZ → LAB](xyz-lab.doc)
![LAB → LCH](lab-lch.doc)
![LCH → LAB](lch-lab.doc)
![XYZ → LCH](xyz-lch.doc)
![LCH → XYZ](lch-xyz.doc)
