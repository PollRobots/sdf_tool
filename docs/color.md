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

---

## Conversion Functions

This tool processes color internally within the shader in the CIE XYZ
colorspace. This is makes the math that operates on color values easier in the
shader pipeline, because the color values are in a perceptually uniform space,
but it is harder to reason about them.

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

This converts to the CIE LCH colorspace (via CIE LAB) (where the H is a hue value in degrees),
adds 20° and then converts back.

![RGB → XYZ](rgb-xyz.doc)
![XYZ → RGB](xyz-rgb.doc)
![LAB → XYZ](lab-xyz.doc)
![XYZ → LAB](xyz-lab.doc)
![LAB → LCH](lab-lch.doc)
![LCH → LAB](lch-lab.doc)
![XYZ → LCH](xyz-lch.doc)
![LCH → XYZ](lch-xyz.doc)
