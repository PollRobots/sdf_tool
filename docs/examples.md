# Examples

## The Basics

A simple sphere, radius 1, with a center at `(0, 1, 0)`

```example
(sphere #<0 1 0> 1)
```

---

The same sphere, but with the radius, and offset from the ground plane,
controlled interactively by the same value.

```example
#|start-interactive-values
  r = 1 [0:2:0.01]
end-interactive-values|#

(sphere #<0 :r 0> :r)
```

---

A sphere with a color specified.

```example
(color (rgb-xyz #<1 0 0>)
    (sphere #<0 1 0> 1))
```

_Internally this tool uses the CIE XYZ color space, so it is convenient to use
`(rgb-xyz)` to convert from the more familiar sRGB colors. See the
[color](color) documentation for more information._

---

Two spheres

```example
(union
  (color (rgb-xyz #<1 0 0>)
      (sphere #<-1 1 0> 1))
  (color (rgb-xyz #<0 0 1>)
      (sphere #<1 1 0> 1)))
```

---

The same two spheres, but smoothly blended, with the blend amount and the
offsets allong the x-axis controlled interactively.

```example
#|start-interactive-values
  k = 0.2 [0:0.25:0.001]
  off = 1 [-2:2:0.01]
end-interactive-values|#

(union :k
  (color (rgb-xyz #<1 0 0>)
      (sphere #<(- :off) 1 0> 1))
  (color (rgb-xyz #<0 0 1>)
      (sphere #<:off 1 0> 1)))
```
