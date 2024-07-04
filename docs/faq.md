# FAQ

## What is an SDF?

A Signed Distance Field (or function) &mdash; a way of describing an object by
saying for any arbitray point, how far the point is from the surface. 0 means on
the surface, a positive number means outside the object, and a negative number
means inside the object.

The simplest example of this is for a sphere, the SDF for a sphere is the
distance from the point to the center of the sphere, less the radius of the
sphere.

## Why SDF?

For this project, because I wanted to. In general, they provide an interesting
approach to rendering image which is amenable to computation on the GPU (within
a shader), which is what this tool does.

## How are SDF's represented?

This tool uses a custom DSL (Domain Specific Language) to specify an SDF. That
is then translated into WGSL, the shading language used by WebGPU, and rendered
in a simple scene.

The DSL is a simple lisp-like language with primitives for common SDFs and
operations on SDFs, see the [DSL](dsl) documentation for more details.

**Example:**

```
#|start-interactive-values
  Captured at 7/3/2024, 9:37:30 PM
  rgb-box.x = 0 [0:1:0.01]
  rgb-box.y = 0 [0:1:0.01]
  rgb-box.z = 1 [0:1:0.01]
  rgb-cone.x = 1 [0:1:0.01]
  rgb-cone.y = 0 [0:1:0.01]
  rgb-cone.z = 0 [0:1:0.01]
  rgb-sphere.x = 0 [0:1:0.01]
  rgb-sphere.y = 1 [0:1:0.01]
  rgb-sphere.z = 0 [0:1:0.01]
  box-theta = 0 [-180:180:1]
  k = 0.1 [0:0.2:0.001]
  off = 2 [0:5:0.01]
end-interactive-values|#

(union :k
    (color (rgb-xyz :#<rgb-sphere>)
        (sphere #<0 1 0> 1))
    (color (rgb-xyz :#<rgb-box>)
        (translate-x :off (rotate-y (radians :box-theta)
            (box #<0 1 0> #<0.8 1 0.8>))))
    (color (rgb-xyz :#<rgb-cone>)
        (cone #<(- :off) 2 0> (radians 27) 2)))
```

Copy paste this into the editor and see the results. Play around with the
interactive values and see how they change the model in realtime.

# Acknowledgments

It is pretty much impossible to play with SDFs without recognizing the contribution that Inigo Quillez has made in this space.

I could not have built this tool without using his [website](https://iquilezles.org/), in particular the [distance functions](https://iquilezles.org/articles/distfunctions/) article, and of course [shadertoy](https://shadertoy.com). The basic scene used in the rendering window is a WGSL interpretation of the [Raymarching - Primitives](https://www.shadertoy.com/view/Xds3zN) example.

The code editor is [Monaco](https://microsoft.github.io/monaco-editor), and the vim mode is implemented using a [package](https://npmjs.com/vim-monaco) that I ported to TypeScript from the [monaco-vim](https://npmjs.com/monaco-vim) package.

The DSL was probably somewhat inspired by the classic Peter Norvig
[lispy](https://norvig.com/lispy.html) article, although I have tinkered with
lisps and schemes a lot over the last decade or so.

Four of the six themes are, of course, derived from Ethan Schoonover's [Solarized](https://ethanschoonover.com/solarized/)
