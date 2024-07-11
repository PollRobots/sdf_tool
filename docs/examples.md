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

To interactively change the radius of the sphere, use the **edit** button on the
example to copy the code into the editor.

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

## Building a more complex model

### Starting small

Taking the simple sphere from above,

```example
(define pi (radians 180))
(define eye-color (sph) (saturate-xyz (/ (yyy sph) pi)))
(translate-y 2
  (color (eye-color (cartesian-spherical :pos))
    (sphere #<0> 1)))
```

This adds some color, the `eye-color` lambda is called with the spherical
coordinates of the position. The spherical coordinates are the radius,
inclination θ, and azimuth φ.

The inclination is the angle from the y-axis, from
0 -> π. Where 0 will be the top of the sphere, and π will be the bottom.

The `eye-color` lambda divides the inclination (in the y component of a spherical coordinate vector) by π and uses that as the color value on all three
channels, giving black at the top, and white at the bottom.

### Making a pupil

```example
#|start-interactive-values
  pupil = 0.15 [0:0.5:0.001]
end-interactive-values|#

(define pi (radians 180))
(define eye-color (sph)
  (saturate-xyz
    (smoothcase (/ (yyy sph) pi)
      ((:pupil) (rgb-xyz #<0.05>))
      ((:pupil) (rgb-xyz #<1>))
    )))
(translate-y 2
  (rotate-x (/ pi -2)
  (color (eye-color (cartesian-spherical :pos))
    (sphere #<0> 1))))
```

This rotates the sphere around the x-axis by -π/2 to face the camera, and uses
the `smoothcase` special form to interpolate a color from the normalized inclination.
`smoothcase` will use `smoothstep` to blend between case values when necessary.

### Adding an iris

```example
#|start-interactive-values
  rgb-iris.x = 0.576 [0:1:0.01]
  rgb-iris.y = 0.38 [0:1:0.01]
  rgb-iris.z = 0.102 [0:1:0.01]
  iris = 0.25 [0:0.5:0.001]
  pupil = 0.125 [0:0.5:0.001]
end-interactive-values|#

(define pi (radians 180))
(define eye-color (sph)
    (saturate-xyz
        (smoothcase (/ (yyy sph) pi)
            (((- :pupil 0.01)) #<0.05>)
            ((:pupil :iris) (rgb-xyz :#<rgb-iris>))
            (((+ :iris 0.01)) (rgb-xyz #<1>))
            ((1) (rgb-xyz #<1 0 0>))
        )))
(translate-y 2
  (rotate-x (/ pi -2)
  (color (eye-color (cartesian-spherical :pos))
    (sphere #<0> 1))))
```

This adds an iris band, and blends the color from white at the edge of the iris
to red at the back of the eye.

### Texturing the iris

```example
#|start-interactive-values
  rgb-iris.x = 0.576 [0:1:0.01]
  rgb-iris.y = 0.38 [0:1:0.01]
  rgb-iris.z = 0.102 [0:1:0.01]
  iris = 0.25 [0:0.5:0.001]
  pupil = 0.125 [0:0.5:0.001]
end-interactive-values|#

(define pi (radians 180))
(define noise (x) (+ (perlin x 1) (perlin x 2) (perlin x 4)))
(define eye-color (sph)
    (saturate-xyz
        (smoothcase (/ (yyy sph) pi)
            (((- :pupil 0.01)) #<0.05>)
            ((:pupil :iris)
              (mix (rgb-xyz :#<rgb-iris>)
                   (* 2 (rgb-xyz :#<rgb-iris>))
                   (smoothstep -0.1 0.6
                              (noise (* sph #<(+ 1 (* 5 :pupil)) (/ (+ 0.1 :pupil)) 20>)))))
            (((+ :iris 0.01)) (rgb-xyz #<1>))
            ((1) (rgb-xyz #<1 0 0>))
        )))
(translate-y 2
  (rotate-x (/ pi -2)
  (color (eye-color (cartesian-spherical :pos))
    (sphere #<0> 1))))
```

This uses 3 octaves of perlin noise to add some variety to the iris color.

The `mix` function is used to blend between the base iris color and a brighter
version of the same color. The mix factor is chosen using the `smoothstep`
function.

The smoothstep function operates on the result of calling `noise` with the
spherical coordinates of the current position scaled to produce a result that is
reactive to changes in the pupil size.

- The x-component (which is the radius in the spherical coordinate system) is
  scaled by a small amount based on the :pupil interactive value. This allows the
  noise pattern to evolve a little as the pupil size changes, without being too
  extreme.
- The y-component (which is the inclination or θ) is scaled inversely
  proportional to the pupil size. This allows the radial features of the noise to
  stay somewhat constant from the edge of the pupil.
- The z-component (which is the azimuth or φ) is scaled by a fixed large number,
  this causes the noise to have a radial appearance

### Adding an eye-lid

```example
#|start-interactive-values
  rgb-iris.x = 0.576 [0:1:0.01]
  rgb-iris.y = 0.38 [0:1:0.01]
  rgb-iris.z = 0.102 [0:1:0.01]
  rgb-skin.x = 0.941 [0:1:0.01]
  rgb-skin.y = 0.796 [0:1:0.01]
  rgb-skin.z = 0.698 [0:1:0.01]
  eyelid-angle = 30 [-180:180:1]
  iris = 0.25 [0:0.5:0.001]
  pupil = 0.125 [0:0.5:0.001]
end-interactive-values|#

(define pi (radians 180))
(define noise (x) (+ (perlin x 1) (perlin x 2) (perlin x 4)))
(define eye-color (sph)
    (saturate-xyz
        (smoothcase (/ (yyy sph) pi)
            (((- :pupil 0.01)) #<0.05>)
            ((:pupil :iris)
              (mix (rgb-xyz :#<rgb-iris>)
                   (* 2 (rgb-xyz :#<rgb-iris>))
                   (smoothstep -0.1 0.6
                              (noise (* sph #<(+ 1 (* 5 :pupil)) (/ (+ 0.1 :pupil)) 20>)))))
            (((+ :iris 0.01)) (rgb-xyz #<1>))
            ((1) (rgb-xyz #<1 0 0>))
        )))
(translate-y 2
  (union
    (rotate-x (/ pi -2)
      (color (eye-color (cartesian-spherical :pos))
        (sphere #<0> 1)))
    (color (rgb-xyz :#<rgb-skin>)
      (intersect 0.01
        (sphere #<0> 1.02)
        (translate #<0 -0.5 -1> (rotate-x (radians :eyelid-angle)
          (plane #<0 -1 0> 0)))))))
```

The eyelid is created by intersecting a sphere that is a little larger than the
eyeball with a plane. The plane is translated to create an origin of rotation
behind and lower than the center of the eye. The eyelid can be interactively
rotated to blink the eye.

The intersection has a small smoothing factor applied to created a rounded edge.

### Two eyes

```example
#|start-interactive-values
  view.z = 0
  eye-pos.x = 1.3 [1:2:0.01]
  eye-pos.y = 2 [0:5:0.01]
  eye-pos.z = 0 [0:2:0.01]
  rgb-iris.x = 0.576 [0:1:0.01]
  rgb-iris.y = 0.38 [0:1:0.01]
  rgb-iris.z = 0.102 [0:1:0.01]
  rgb-skin.x = 0.941 [0:1:0.01]
  rgb-skin.y = 0.796 [0:1:0.01]
  rgb-skin.z = 0.698 [0:1:0.01]
  eyelid-angle = 30 [-180:180:1]
  iris = 0.25 [0:0.5:0.001]
  pupil = 0.125 [0:0.5:0.001]
end-interactive-values|#

(define pi (radians 180))
(define noise (x) (+ (perlin x 1) (perlin x 2) (perlin x 4)))
(define eye-color (sph)
    (saturate-xyz
        (smoothcase (/ (yyy sph) pi)
            (((- :pupil 0.01)) #<0.05>)
            ((:pupil :iris)
              (mix (rgb-xyz :#<rgb-iris>)
                   (* 2 (rgb-xyz :#<rgb-iris>))
                   (smoothstep -0.1 0.6
                              (noise (* sph #<(+ 1 (* 5 :pupil)) (/ (+ 0.1 :pupil)) 20>)))))
            (((+ :iris 0.01)) (rgb-xyz #<1>))
            ((1) (rgb-xyz #<1 0 0>))
        )))

(reflect #<1 0 0>
  (translate-x (max 1.1 :eye-pos.x)
    (translate #<0 :eye-pos.y :eye-pos.z>
	  (union
	    (rotate-x (/ pi -2)
	      (color (eye-color (cartesian-spherical :pos))
	        (sphere #<0> 1)))
	    (color (rgb-xyz :#<rgb-skin>)
	      (intersect 0.01
	        (sphere #<0> 1.02)
	        (translate #<0 -0.5 -1> (rotate-x (radians :eyelid-angle)
	          (plane #<0 -1 0> 0)))))))))
```

This uses the interactive vector `:#<eye-pos>` to position the eye. It handles the x component separately to ensure that it is never less than `1.1`, this is to ensure that the entire object is always on the positive side of x.

The `reflect` modifier then reflects the entire eye in the x-axis, creating two
eyes.

### Position within a face

```example
#|start-interactive-values
  view.x = 0
  view.z = 0.6
  eye-pos.x = 0.24 [0:2:0.01]
  eye-pos.y = -0.05 [-1:1:0.01]
  eye-pos.z = 0.69 [0:2:0.01]
  rgb-iris.x = 0.576 [0:1:0.01]
  rgb-iris.y = 0.38 [0:1:0.01]
  rgb-iris.z = 0.102 [0:1:0.01]
  rgb-skin.x = 0.941 [0:1:0.01]
  rgb-skin.y = 0.796 [0:1:0.01]
  rgb-skin.z = 0.698 [0:1:0.01]
  eye-size = 0.15 [0:1:0.01]
  eyelid-angle = 23 [-180:180:1]
  iris = 0.25 [0:0.5:0.001]
  pupil = 0.125 [0:0.5:0.001]
end-interactive-values|#

(define pi (radians 180))
(define noise (x) (+ (perlin x 1) (perlin x 2) (perlin x 4)))
(define eye-color (sph)
    (saturate-xyz
        (smoothcase (/ (yyy sph) pi)
            (((- :pupil 0.01)) #<0.05>)
            ((:pupil :iris)
              (mix (rgb-xyz :#<rgb-iris>)
                   (* 2 (rgb-xyz :#<rgb-iris>))
                   (smoothstep -0.1 0.6
                              (noise (* sph #<(+ 1 (* 5 :pupil)) (/ (+ 0.1 :pupil)) 20>)))))
            (((+ :iris 0.01)) (rgb-xyz #<1>))
            ((1) (rgb-xyz #<1 0 0>))
        )))

(translate-y 1
(union
  ; eyes
	(reflect #<1 0 0>
	  (translate-x (max (* 1.1 :eye-size) :eye-pos.x)
	    (translate #<0 :eye-pos.y :eye-pos.z>
          (scale :eye-size
		  (union
		    (rotate-x (/ pi -2)
		      (color (eye-color (cartesian-spherical :pos))
		        (sphere #<0> 1)))
		    (color (rgb-xyz :#<rgb-skin>)
		      (intersect 0.01
		        (sphere #<0> 1.02)
		        (translate #<0 -0.5 -1> (rotate-x (radians :eyelid-angle)
		          (plane #<0 -1 0> 0))))))))))
  ; head
  (color (rgb-xyz :#<rgb-skin>)
    (difference 0.1
      (asymmetric-ellipsoid #<0> #<0.8 1 0.7> #<0.8 0.9 0.9>)
      ; eye-sockets
      (union
        (sphere (* 1.2 :#<eye-pos>) (* :eye-size 0.5))
        (sphere (* 1.2 :#<eye-pos> #<-1 1 1>) (* :eye-size 0.5)))))))
```

This adds scale and positioning to the eyes, and an asymmetric ellipsoid for the
basic head shape.

A `difference` with a smoothing factor is used to _carve out_ two eye sockets.
The `reflect` modifier is not used for the eye sockets because it will interact
with the smoothing function on the difference combinator to create a
discontinuity.

The eye socket scale and position is derived from the eye scale and position,
modified to adjust the influence on the general head shape.

### Add a nose

```example
#|start-interactive-values
  view.x = 0
  view.z = 0.6
  eye-pos.x = 0.24 [0:2:0.01]
  eye-pos.y = -0.05 [-1:1:0.01]
  eye-pos.z = 0.69 [0:2:0.01]
  nose-pos.y = -0.15 [-1:1:0.01]
  nose-pos.z = 0.85 [0:1:0.01]
  rgb-iris.x = 0.576 [0:1:0.01]
  rgb-iris.y = 0.38 [0:1:0.01]
  rgb-iris.z = 0.102 [0:1:0.01]
  rgb-skin.x = 0.941 [0:1:0.01]
  rgb-skin.y = 0.796 [0:1:0.01]
  rgb-skin.z = 0.698 [0:1:0.01]
  eye-size = 0.15 [0:1:0.01]
  eyelid-angle = 23 [-180:180:1]
  iris = 0.25 [0:0.5:0.001]
  nose-angle = 17 [0:50:0.1]
  nose-scale = 0.09 [0:0.2:0.001]
  pupil = 0.125 [0:0.5:0.001]
end-interactive-values|#

(define pi (radians 180))
(define noise (x) (+ (perlin x 1) (perlin x 2) (perlin x 4)))
(define eye-color (sph)
    (saturate-xyz
        (smoothcase (/ (yyy sph) pi)
            (((- :pupil 0.01)) #<0.05>)
            ((:pupil :iris)
              (mix (rgb-xyz :#<rgb-iris>)
                   (* 2 (rgb-xyz :#<rgb-iris>))
                   (smoothstep -0.1 0.6
                              (noise (* sph #<(+ 1 (* 5 :pupil)) (/ (+ 0.1 :pupil)) 20>)))))
            (((+ :iris 0.01)) (rgb-xyz #<1>))
            ((1) (rgb-xyz #<1 0 0>))
        )))

(translate-y 1
(union
  ; eyes
	(reflect #<1 0 0>
	  (translate-x (max (* 1.1 :eye-size) :eye-pos.x)
	    (translate #<0 :eye-pos.y :eye-pos.z>
        (scale :eye-size
          (union
            (rotate-x (/ pi -2)
              (color (eye-color (cartesian-spherical :pos))
                (sphere #<0> 1)))
            (color (rgb-xyz :#<rgb-skin>)
              (intersect 0.01
                (sphere #<0> 1.02)
                (translate #<0 -0.5 -1> (rotate-x (radians :eyelid-angle)
                  (plane #<0 -1 0> 0))))))))))
  ; head
  (color (rgb-xyz :#<rgb-skin>)
    (difference 0.1
      (union 0.05
        (asymmetric-ellipsoid #<0> #<0.8 1 0.7> #<0.8 0.9 0.9>)
        ; nose
        (translate :#<nose-pos> (scale :nose-scale
          (rotate-x (radians :nose-angle)
            (union 0.1
              (sphere #<0.6 -1.5 -0.3> 0.7)
              (sphere #<-0.6 -1.5 -0.3> 0.7)
              (sphere #<0 -1.5 0> 0.75)
              (ellipsoid #<0> #<1 2 1>))))))
      ; eye-sockets
      (union
        (sphere (* 1.2 :#<eye-pos>) (* :eye-size 0.5))
        (sphere (* 1.2 :#<eye-pos> #<-1 1 1>) (* :eye-size 0.5)))))))
```

This adds a nose, which is a `union` of three spheres to define the shape of the
end of the nose, and an ellipsoid for the rest of the nose. This is smoothly
combined with the rest of the head.

### Add cheeks

```example
#|start-interactive-values
  view.x = 0
  view.z = 0.6
  cheek-pos.x = 0.25 [0:1:0.01]
  cheek-pos.y = -0.35 [-1:1:0.01]
  cheek-pos.z = 0.48 [0:1:0.01]
  eye-pos.x = 0.24 [0:2:0.01]
  eye-pos.y = -0.05 [-1:1:0.01]
  eye-pos.z = 0.69 [0:2:0.01]
  nose-pos.y = -0.15 [-1:1:0.01]
  nose-pos.z = 0.85 [0:1:0.01]
  rgb-iris.x = 0.576 [0:1:0.01]
  rgb-iris.y = 0.38 [0:1:0.01]
  rgb-iris.z = 0.102 [0:1:0.01]
  rgb-skin.x = 0.941 [0:1:0.01]
  rgb-skin.y = 0.796 [0:1:0.01]
  rgb-skin.z = 0.698 [0:1:0.01]
  blush = 1 [0:1:0.01]
  cheek-size = 0.16 [0:0.2:0.001]
  eye-size = 0.15 [0:1:0.01]
  eyelid-angle = 23 [-180:180:1]
  iris = 0.25 [0:0.5:0.001]
  nose-angle = 17 [0:50:0.1]
  nose-scale = 0.09 [0:0.2:0.001]
  pupil = 0.125 [0:0.5:0.001]
end-interactive-values|#

(define pi (radians 180))
(define noise (x) (+ (perlin x 1) (perlin x 2) (perlin x 4)))
(define eye-color (sph)
    (saturate-xyz
        (smoothcase (/ (yyy sph) pi)
            (((- :pupil 0.01)) #<0.05>)
            ((:pupil :iris)
              (mix (rgb-xyz :#<rgb-iris>)
                   (* 2 (rgb-xyz :#<rgb-iris>))
                   (smoothstep -0.1 0.6
                              (noise (* sph #<(+ 1 (* 5 :pupil)) (/ (+ 0.1 :pupil)) 20>)))))
            (((+ :iris 0.01)) (rgb-xyz #<1>))
            ((1) (rgb-xyz #<1 0 0>))
        )))

(translate-y 1
(union
  ; eyes
	(reflect #<1 0 0>
	  (translate-x (max (* 1.1 :eye-size) :eye-pos.x)
	    (translate #<0 :eye-pos.y :eye-pos.z>
        (scale :eye-size
		      (union
            (rotate-x (/ pi -2)
              (color (eye-color (cartesian-spherical :pos))
                (sphere #<0> 1)))
            (color (rgb-xyz :#<rgb-skin>)
              (intersect 0.01
                (sphere #<0> 1.02)
                (translate #<0 -0.5 -1> (rotate-x (radians :eyelid-angle)
                  (plane #<0 -1 0> 0))))))))))
  ; head
  (color (rgb-xyz :#<rgb-skin>)
    (difference 0.1
      (union 0.05
        (asymmetric-ellipsoid #<0> #<0.8 1 0.7> #<0.8 0.9 0.9>)
        ; nose
        (translate :#<nose-pos> (scale :nose-scale
          (rotate-x (radians :nose-angle)
            (union 0.1
              (sphere #<0.6 -1.5 -0.3> 0.7)
              (sphere #<-0.6 -1.5 -0.3> 0.7)
              (sphere #<0 -1.5 0> 0.75)
              (ellipsoid #<0> #<1 2 1>)))))
        ; cheeks
        (color (mix (rgb-xyz :#<rgb-skin>)
                    (rgb-xyz #<1 0 0>)
                    :blush)
          (reflect #<-1 0 0>
            (sphere :#<cheek-pos> :cheek-size))))
      ; eye-sockets
      (union
        (sphere (* 1.2 :#<eye-pos>) (* :eye-size 0.5))
        (sphere (* 1.2 :#<eye-pos> #<-1 1 1>) (* :eye-size 0.5)))))))
```

This creates cheeks by adding two spheres just below the surface of the skin,
the cheek color is modulated with the :blush interactive value between the skin
color and red. This combined with the smoothing will add a red tint to the
cheeks.

### Chin and Lips

```example
#|start-interactive-values
  view.x = 7
  view.y = 0
  view.z = 0.6
  cheek-pos.x = 0.21 [0:1:0.01]
  cheek-pos.y = -0.3 [-1:1:0.01]
  cheek-pos.z = 0.55 [0:1:0.01]
  chin.y = -0.75 [-1:0:0.01]
  chin.z = 0.56 [0:1:0.01]
  eye-pos.x = 0.25 [0:2:0.01]
  eye-pos.y = -0.05 [-1:1:0.01]
  eye-pos.z = 0.69 [0:2:0.01]
  lip.y = -0.532 [-1:0:0.001]
  lip.z = 0.74 [0:1:0.01]
  nose-pos.y = -0.15 [-1:1:0.01]
  nose-pos.z = 0.85 [0:1:0.01]
  rgb-iris.x = 0.608 [0:1:0.01]
  rgb-iris.y = 0.376 [0:1:0.01]
  rgb-iris.z = 0.11 [0:1:0.01]
  rgb-lip.x = 0.737 [0:1:0.01]
  rgb-lip.y = 0.447 [0:1:0.01]
  rgb-lip.z = 0.322 [0:1:0.01]
  rgb-skin.x = 0.941 [0:1:0.01]
  rgb-skin.y = 0.796 [0:1:0.01]
  rgb-skin.z = 0.698 [0:1:0.01]
  blush = 0.62 [0:1:0.01]
  cheek-size = 0.16 [0:0.2:0.001]
  chin-angle = 9 [-180:180:1]
  eye-size = 0.15 [0:1:0.01]
  eyelid-angle = 22 [-180:180:1]
  iris = 0.25 [0:0.5:0.001]
  lh = 0.045 [0:0.2:0.001]
  lk = 0.035 [0:0.2:0.001]
  nose-angle = 17 [0:50:0.1]
  nose-scale = 0.09 [0:0.2:0.001]
  pupil = 0.153 [0:0.5:0.001]
  smile = 0.019 [0:0.05:0.001]
end-interactive-values|#

(define pi (radians 180))
(define noise (x) (+ (perlin x 1) (perlin x 2) (perlin x 4)))
(define eye-color (sph)
  (saturate-xyz
    (smoothcase (/ (yyy sph) pi)
      (((- :pupil 0.01)) #<0.025>)
      ((:pupil :iris)
        (mix (rgb-xyz :#<rgb-iris>)
             (* 2 (rgb-xyz :#<rgb-iris>))
             (smoothstep -0.1 0.6
                (noise (* sph #<(+ 1 (* 5 :pupil)) (/ (+ 0.1 :pupil)) 20>)))))
      (((+ :iris 0.01)) (rgb-xyz #<1>))
      ((1) (rgb-xyz #<1 0 0>)))))
(define lip-color (lp)
    (let ((py (- (get-y lp)
                 :lip.y
                 (* 5 :smile (- 1 (cos (* (get-x lp) pi))))))
          (lh (* :lh
                 (cos (/ (* (get-x lp) pi) (* 8 :lh))))))

        (smoothcase #<py>
                    (((* -2 lh))               (rgb-xyz :#<rgb-skin>))
                    (((- lh)     (* -0.25 lh)) (rgb-xyz :#<rgb-lip>))
                    ((0)                       (* 0.5 (rgb-xyz :#<rgb-lip>)))
                    (((* 0.9 lh) lh)           (rgb-xyz :#<rgb-lip>))
                    (((* 1.5 lh))              (rgb-xyz :#<rgb-skin>)))))

(translate-y 1.5
(union
  ;eyes
	(reflect #<1 0 0>
	  (translate-x (max (* 1.1 :eye-size) :eye-pos.x)
	    (translate #<0 :eye-pos.y :eye-pos.z> (scale :eye-size
		  (union
		    (rotate-x (/ pi -2)
		      (color (eye-color (cartesian-spherical :pos))
		        (sphere #<0> 1)))
		    (color (rgb-xyz :#<rgb-skin>)
		      (intersect 0.01
		        (sphere #<0> 1.02)
		        (translate #<0 -0.5 -1> (rotate-x (radians :eyelid-angle)
		          (plane #<0 -1 0> 0))))))))))
  (color (rgb-xyz :#<rgb-skin>)
    (difference 0.1
      (union 0.04
        (asymmetric-ellipsoid #<0> #<0.75 1 0.7> #<0.75 0.9 0.9>)
        ; lips
        (color (lip-color :pos)
        (union :lk
            (sphere #<0 :lip.y :lip.z> (/ :lh 3))
            (sphere #<(* -1 :lh) :lip.y :lip.z > (/ :lh 3))
            (sphere #<(* -2 :lh) (+ :lip.y :smile) (- :lip.z 0.04)> (/ :lh 3))
            (sphere #<(* 1 :lh) :lip.y :lip.z> (/ :lh 3))
            (sphere #<(* 2 :lh) (+ :lip.y :smile) (- :lip.z 0.04)> (/ :lh 3))))
        ; nose
        (translate :#<nose-pos> (scale :nose-scale
          (rotate-x (radians :nose-angle)
            (union 0.1
              (sphere #<0.6 -1.5 -0.3> 0.7)
              (sphere #<-0.6 -1.5 -0.3> 0.7)
              (sphere #<0 -1.5 0> 0.75)
              (ellipsoid #<0> #<1 2 1>)))))
        ; cheeks
        (color (mix (rgb-xyz :#<rgb-skin>)
                     (rgb-xyz #<1 0 0>)
                     :blush)
          (reflect #<-1 0 0>
            (sphere (+ :#<cheek-pos> (* #<1 1 1> :smile)) :cheek-size)))
        ; chin
        (translate :#<chin> (rotate-x (radians :chin-angle)
            (asymmetric-ellipsoid #<0> #<0.18 0.1 0.3> #<0.18 0.2 0.15>)))
        )
      ; eye-sockets
      (union
        (sphere (* 1.25 :#<eye-pos>) (* :eye-size 0.5 (+ 1 (* 3 :smile))))
        (sphere (* 1.25 :#<eye-pos> #<-1 1 1>) (* :eye-size 0.5 (+ 1 (* 3 :smile)))))))))
```

The chin is a simple asymmetric ellipsoid that helps create a more reasonable profile.

The lips are more complicated, in terms of shape, they are a 5 small spheres set
in a a line that approximately follows the curve of the face. The `:smile`
interactive value then moves the outermost spheres up slightly. It is also used
to control the position of the cheeks, so that more of the face moves with the
smile.

The lips are colored based on the position, in the centerline of the face they
are colored between `:lh` above and below `:lip.z`, that height is then
modulated as the x-coordinate moves away from the centerline using a scaled
cosine of the x-coordinate. This gives the coloring some shape, and is also
tweaked by the `:smile` variable to make the lip color follow the movement of
the underlying geometry.
