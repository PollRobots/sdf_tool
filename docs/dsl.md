# DSL

The DSL is a simple lisp like language and borrows a subset of lisp/scheme syntax.

## Values

There are two literal value types, _numbers_ and _vectors_.

**Numbers** are single floating point values. And are represented using common notation, i.e.

```lisp
1
1.0
-8.2
1.7e-5
```

**Vectors** are triplets of numbers represented using a `#<x y z>` notation
&mdash; although this is a reader macro that expands to `(vec x y z)`, which is
also valid. A vector specified with only a single value will be _splatted_ to
create a vector where each component is that value, the origin can therefore be
represented as `#<0>`.

```scheme
#<0>
#<1 0 0>        ; a normal vector in the direction of the x-axis
#<9.2, 3.7, -4>
#<1.2>          ; These two vectors are equivalent
#<1.2 1.2 1.2>  ;
```

All numeric operations will work on vectors in a component-wise fashion, so for example:

```scheme
(+ #<1 2 3> #<4 5 6>)
```

is equivalent to (although much more efficient than):

```scheme
(let ((a #<1 2 3>) (b #<4 5 6>))
  (vec (+ (get-x a) (get-x b))
       (+ (get-y a) (get-y b))
       (+ (get-z a) (get-z b))))
```

This also means that multiplying two vectors is the component-wise scalar multiplication of the two vectors. If you need a dot product or cross product, then you need to use `(dot a b)` or `(cross a b)`

### Type promotion

In general numbers will be promoted to vectors as necessary, so adding a vector
to a number will cause the number to be splatted into the vector before the
operation is evaluated.

## Interactive values

Values can be specified as interactive, this means that their value is not known
until the shader is evaluated. There are two forms for this.

- colon-keyword &mdash; i.e. `:k` or `:offset` &mdash; these are single numerical values.
- colon-vector-keyword &mdash; i.e. `:#<t>` &mdash; this will create three
  implicit colon-keywords, `:t.x`, `:t.y`, and `:t.z` which will be grouped
  together in the interaction panel. This is equivalent to `(vec :t.x :t.y :t.z)`.
  You can reference individual elements of a vector interactive value directly,
  i.e. you can write `:t.y` you don't need to write `(vec-y :#<t>)`

There are threww predefined colon-keyword values `:pos`, `:col`, and `:time`.
These cannot be controlled interactively. And despite being represented using
colon-keyword format `:pos` and `:col` are vectors not numbers.

- **pos** is a vector representing the current position at which the SDF is
  being evaluated &mdash; subject to any current scale, translation, and
  rotation operations.
- **col** is a vector representing the current color. This vector represents the
  color in CIE XYZ colorspace. See the [color](color) documentation for more
  information.
- **time** is a number representing a time in seconds. This can be paused and
  reset to zero using the UI.

## Shapes

Shapes are functions that return a numeric value that is understood to be an evaluation of a signed distance field at the current `:pos`.

Internally this is represented as a separate type. To write your own distance
functions you can promote a numeric value to an SDF using `(num-sdf d)`.

So the SDF for a sphere centered at `(0.6, 1, 0.2)` and radius `0.8`

```example
(num-sdf
  (- (length (- :pos
                #<0.6 1 0.2>))
     0.8))
```

The length of the vector from `pos` to the center, less the radius.

But for common sdf's you don't need to write that, instead

```example
(sphere #<0.6 1 0.2> 0.8)
```

is already defined. See [shapes](shapes) for the complete set of supported shapes.

## Transformations

The coordinate system can be transformed in the expected ways, operations are
provided to scale, translate and rotate.

For exmple the sphere above can be specified as a unit sphere at the origin, and scaled and translated for an equivalent result:

```example
(translate #<0.6 1 0.2>
    (scale 0.8
      (sphere #<0> 1)))
```

**Note:** only uniform scaling is supported, non-uniform scaling interferes with
the correctness of the SDF algorithms.

See [transforms](transforms) for the complete set of supported transformations.

## Combinations

Evaluating individual SDFs is rarely interesting. Combining SDFs opens up a huge
variety of options.

The lens formed by the intersection of two spheres can be created by:

```example
(intersect
    (sphere #<-0.5 1 0> 1)
    (sphere #<0.5 1 0> 1))
```

Combinators are defined for union, intersection, and difference, each of which supports an optional smoothing factor to smoothly blend the resulting shape.

See [combinators](combinators) for the complete set of supported combinators.

## Modifiers

There are some other convenient manipulations of shapes that are supported. For exampled an entire branch of a shape can be removed from the function by using
`(hide)` &mdash; This is useful when building complex functions and you want to focus on only one part of it.

For example, this will only show the sphere on the positive-x side.

```example
(union
    (hide sphere #<-0.5 1 0> 1)
    (sphere #<0.5 1 0> 1))
```

**Note:** `hide` works best with union, and to a lesser extent difference, it will cause an intersection to generate a hidden field (i.e. an arbitrarily large SDF)

See [modifiers](modifiers) for the complete set of modifiers.

## Colors

A color can be specified for a shape using the `(color)` function. The
combinators select the relevant color depending on which of their child
functions contributes to the sdf at the current position. If smoothing is
applied, then the color is smoothed using a formula compatible with the way the
SDFs are smoothed.

See [colors](colors) for the color function and color conversion functions

## Utility Functions

The DSL provides a variety of utility functions, in addition to standard mathematical operators and trig functions

These include `(smoothstep)`, `(mix)`, `(clamp)` etc.

See [utility functions](utility) for the complete list of functions
