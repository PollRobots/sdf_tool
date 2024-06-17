# DSL for SDF

lisp like syntax

## Primitives

- `/[a-zA-Z0-9_+\-*\/<>=]+/` &mdash; identifier
- `#<a b c>` &mdash; vector of numbers a, b, and c.
- `/[+-]((\d+)|(\d+\.\d+(e[+-]?\d+)?))|(\d+e[+-]?\d+)/` &mdash; number

## Grouping operations

In all of these, the optional `k` parameter is a smoothing factor between 0 and 1

- `(union [k] ...)` &mdash; union of two or more children
- `(intersect [k] ...)` &mdash; intersection of two or more children
- `(difference [k] a b)` &mdash; Difference between shape `a` and `b` (i.e. shape `a` with shape `b` cut away)

## Transformations

These functions work on shapes and on vectors

- `(scale s ...)` &mdash; all children uniformly scaled by `s`
- `(translate v ...)` &mdash; all children translated by the vector `v`
- `(translate-x x ...)` &mdash; sugar for `(translate <x, 0, 0> ...)`
- `(translate-y y ...)` &mdash; sugar for `(translate <0, y, 0> ...)`
- `(translate-z z ...)` &mdash; sugar for `(translate <0, 0, z> ...)`
- `(rotate a Θ ...)` &mdash; rotate all children around axis `a` by angle `Θ`
- `(rotate-x Θ ...)` &mdash; sugar for `(rotate <1, 0, 0> Θ ...)`
- `(rotate-y Θ ...)` &mdash; sugar for `(rotate <0, 1, 0> Θ ...)`
- `(rotate-z Θ ...)` &mdash; sugar for `(rotate <0, 0, 1> Θ ...)`

## Mode

- `(smooth k ...)` &mdash; all child operations share the smoothfactor `k`, unless overridden.
- `(discrete ...)` &mdash; sugar for `(smooth 0 ...)`

## Primitives

- `(ellipsoid p r)` &mdash; ellipse centered on the vector `p`, `r` is a vector for an ellipsoid, with components representing axis radii
- `(sphere p r)` &mdash; sugar for `(ellipse p <r, r, r>)`

## lisp like

- `(define name exp)`
- `(if test conseq alt)`
- `(proc exp ...)`
- `(lambda symbols exp)` &mdash; `symbols` is a list of symbols.
- `(let init exp)` &mdash; `init` is of the form `((symbol exp) ...)` and let expands to `((lambda symbols exp) values ...)` where`symbols` is the list of symbols from the `init` elements and `values` is the list of `exp` from `init`
- `(begin exp ...)` &mdash; evaluates each expression in turn, returns the value of the last expression.

## math

- `(+ ...)`
- `(- ...)`
- `(* ...)`
- `(/ ...)`
- `(dot a b)`
- `(cross a b)`
- `(length vec)`
- `(normalize vec)`
- `(abs a)`
- `(floor a)`
- `(ceil a)`
- `(pow a b)`
- `(sqrt a)`
- `(< ...)`
- `(<= ...)`
- `(> ...)`
- `(>= ...)`
- `(eq ...)`
- `(neq ...)`
- `(min ...)`
- `(minv vec)` &mdash; sugar for `(min (x vec) (y vec) (z vec))`
- `(max ...)`
- `(maxv vec)` &mdash; sugar for `(max (x vec) (y vec) (z vec))`
- `(x vec)`
- `(y vec)`
- `(z vec)`
- `(xyz vec)` &mdash; swizzle vec to combination of proc name (i.e. defined for
  all 27 of `/[xyz][xyz][xyz]/`)
- `(splat a)` &mdash; splat number `a` into a vector
- `(trig a [b])` &mdash; trig function over `a`, `trig` is one of `/sin|cos|tan|asin|acos|atan|atan2`
- `(radians a)`
- `(degress a)`
