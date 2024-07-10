# How to use this tool

The screen has three main areas of interaction,

- The rendered view of the current function in the top left
- The code editor, which starts in the top right, but can be moved to the bottom left
- The interactive value panel, which starts in the bottom left but can trade places with the code editor

## The rendered view

This is controlled with 3 sliders and a few buttons. You can also interact with
it using a mouse.

- Sliders
  - The horizontal slider adjusts the camera's rotation around the vertical-axis
    A(y-axis) at the origin.
  - The left hand vertical slider adjusts the camera's angle relative to the
    horizontal plane
  - The right hand vertical slider adjusts the camera's distance from the target
    point &mdash; which is `(0, 1, 0)`
- Buttons
  - The play/pause button turns the interna; animation loop on and off. Changes to
    angles or interactive values will always cause a new frame to be rendered, so
    it isn't necessary to be running all the time, but it does allow you to gauge
    the complexity of your function if the FPS starts to drop.
  - The _spin_ button causes the camera to continuously rotate around the
    vertical axis.
  - The _capture_ button saves a picture of the current image on the rendered view.

## Code editor

This is a fairly standard code editor. It knows about the [DSL](dsl) used to
describe the SDF. It supports a VIM mode if you like that kind of thing.

Updates to the code editor are automatically applied if you stop typing for long
enough &mdash; approximately a second. This may cause the generated image to
fritz out if you are in the middle of something, but also makes the process
interactive without needing to explicitly _Run_ something.

The [FAQ](faq) has a simple example that you can cut and paste into the editor
to see the whole process in action.

## Interactive value panel

If the code you have written contains interactive values, then the sliders to
control those values will appear in this panel.

Interactive values have two forms

- colon-keyword &mdash; i.e. `:k` or `:offset` &mdash; these are single numerical values.
- colon-vector-keyword &mdash; i.e. `:#<t>` &mdash; this will create three
  implicit colon-keywords, `:t.x`, `:t.y`, and `:t.z` which will be grouped
  together in the interaction panel. This is equivalent to `(vec :t.x :t.y :t.z)`.
  You can reference individual elements of a vector interactive value directly,
  i.e. you can write `:t.y` you don't need to write `(vec-y :#<t>)` &mdash;
  although they should generate the same shader code.
  - If the name of a colon-vector-keyword begins with `rgb-` then it is assumed
    to be a color value, and is interacted with using your browser's default
    color picker.

Except for colors, interactive values are controlled through a slider and a text
box. These are used in the obvious way to change the value. This will cause a
realtime change in the rendered view. The interactive values are communicated to
the generated shader as uniform values, so changing them doesn't require
recompiling the shader.

Each slider has a properties pane accessed by clicking the `…` button to the
right of the slider, this allows you to specify the anticipated range of values,
either directly through the three input fields for minimum, maximum, and step
value, or by choosing one of the predefined property sets. These changes don't
take effect until the ✓ button is clicked.

The current values and configuration of all the interactive values can be
captured into the document by selecting the "Capture interactive values" element
in the code editor. This allows saving the values alongside the code, and when a
file is opened, the interactive values are intialized from that block if
available

### Generated code

Below the interactive values, if any, is the generated shader code that is used
by the renderer. This can be useful for diagnosing why a scene failed, or simply
for lifting a model into WGSL.
