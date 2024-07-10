# FAQ

## What is this?

This is a tool for exploring using SDFs for rendering with a focus
on interactivity.

## What is an SDF?

A Signed Distance Field (or function) &mdash; a way of describing an object by
being able to compute, for any arbitray point, how far the point is from the surface. 0 means on
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
operations on SDFs, see the [Examples](examples) and [DSL](dsl) documentation
for more details.

**Example:**

```example
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

You can use the **edit** button to copy paste this into the editor. Play around
with the interactive values and see how they change the model in realtime.

## Where is the code?

The source code for this can be found on
[GitHub](https://github.com/pollrobots/sdf_tool). It is licensed under the MIT
license. With a reasonably recent node install it should be possible to clone the repo, run `npm ci` and `npm run start` to start a local instance.

This tool is build in [TypeScript](https://www.typescriptlang.org) and
[WGSL](https://www.w3.org/TR/WGSL/), using [React](https://react.dev) and
packaged with [webpack](https://webpack.js.org). It also uses the following
packages

- [mime](https://npmjs.com/mime) &mdash; to guess mime types when opening or saving files.
- [monaco-editor](https://npmjs.com/monaco-editor) &mdash; the Monaco Editor
- [seedrandom](https://npmjs.com/seedrandom) &mdash; to repeatably generate a noise texture.
- [react-markdown](https://npmjs.com/react-markdown) &mdash; to render documentation.
- [vim-monaco](https://npmjs.com/vim-monaco) &mdash; to provide a VIM mode
- [wgpu-matrix](https://npmjs.com/wgpu-matrix) &mdash; for&hellip; _erm_ &hellip;matrices

Where there are tests, they are written using [mocha](https://npmjs.com/mocha)
and [chai](https://npmjs.com/chai)

The code editing font is "Fira Code" from [fontsource](https://npmjs.com/@fontsource-variable/fira-code)

# Acknowledgments

It is pretty much impossible to play with SDFs without recognizing the contribution that Inigo Quillez has made in this space.

I could not have built this tool without using his [website](https://iquilezles.org/), in particular the [distance functions](https://iquilezles.org/articles/distfunctions/) article, and of course [shadertoy](https://shadertoy.com). The basic scene used in the rendering window is a WGSL interpretation of the [Raymarching - Primitives](https://www.shadertoy.com/view/Xds3zN) example.

The DSL was probably somewhat inspired by the classic Peter Norvig
[lispy](https://norvig.com/lispy.html) article, although I have tinkered with
lisps and schemes a lot over the last decade or so.

Four of the six themes are, of course, derived from Ethan Schoonover's [Solarized](https://ethanschoonover.com/solarized/)
