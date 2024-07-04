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

## How are SDF's represented

This tool uses a custom DSL (Domain Specific Language) to specify an SDF. That
is then translated into WGSL, the shading language used by WebGPU, and rendered
in a simple scene.

The DSL is a simple lisp-like language with primitives for common SDFs and
operations on SDFs, see the [DSL](dsl) documentation for more details.
