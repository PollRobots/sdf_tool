import React from "react";
import { IconButton } from "./icon-button";
import { Image } from "./icons/image";
import {
  extractViewParameters,
  findUniformValues,
  generateShader,
  isGenerationSuccess,
  makeShader,
  readDefaultUniformValues,
} from "../make-wgsl";
import { WebGpuWidget } from "./web-gpu-canvas";
import template from "../shader.wgsl";
import { Vector } from "../dsl";
import { Edit } from "./icons/edit";

interface ExampleProps {
  code: string;
  onAddToEditor: (code: string) => void;
  colorize: (code: string) => Promise<string>;
}

const kDefaultView: Vector = { x: 15, y: 0, z: 0.45 };

export const Example: React.FC<ExampleProps> = (props) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [generating, setGenerating] = React.useState(false);
  const [preview, setPreview] = React.useState<ImageBitmap>(null);
  const [code, setCode] = React.useState(filterCode(props.code));

  React.useEffect(() => {
    props.colorize(code).then((c) => setCode(c));
  }, ["once"]);

  React.useEffect(() => {
    if (!preview || !canvasRef.current) {
      return;
    }
    const canvas = canvasRef.current;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(preview, 0, 0);
  }, [preview, canvasRef.current]);

  const generate = () => {
    setGenerating(true);
    const uniforms = readDefaultUniformValues(props.code, new Map());
    const viewParams = extractViewParameters(uniforms);
    const view = viewParams ? { ...kDefaultView, ...viewParams } : kDefaultView;
    const generated = generateShader(props.code);
    if (isGenerationSuccess(generated)) {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const gpu = new WebGpuWidget(canvas);
      gpu.cameraSettings(view.x, view.y, view.z);
      gpu.setUniformValues(
        generated.uniformNames.map((el) => {
          const uniform = uniforms.get(el);
          return uniform ? uniform.value : 0;
        }),
        generated.uniformOffsets
      );
      gpu
        .init(
          makeShader(
            template,
            generated.generated,
            generated.uniformOffsets.length == 0
              ? 0
              : Math.max(...generated.uniformOffsets) + 4
          ),
          "vertex_main",
          "frag_main"
        )
        .then(() => {
          gpu.stop();
          requestAnimationFrame((t) => {
            gpu.frame(t);
            requestAnimationFrame(() => {
              createImageBitmap(canvas).then((img) => {
                setGenerating(false);
                setPreview(img);
              });
            });
          });
        })
        .catch((err) => {
          console.error("Generating preview:", "gpu.init:", err);
          setGenerating(false);
        });
    } else {
      setGenerating(false);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gridTemplateRows: "2em 1fr 1fe",
        columnGap: "0.5em",
        height: "fit-content",
      }}
    >
      <code
        style={{ gridArea: "1/1/3/4" }}
        dangerouslySetInnerHTML={{ __html: code }}
      />
      <IconButton
        style={{ gridArea: "1/2/2/3" }}
        size="2em"
        title="Add to editor"
        onClick={() => props.onAddToEditor(props.code)}
      >
        <Edit />
      </IconButton>
      <IconButton
        style={{ gridArea: "1/3/2/4" }}
        size="2em"
        title="Render"
        disabled={generating || !!preview}
        onClick={() => generate()}
      >
        <Image />
      </IconButton>
      {!!preview ? (
        <canvas
          style={{ gridArea: "3/1/4/4", maxWidth: "100%" }}
          ref={canvasRef}
          width="640"
          height="360"
        />
      ) : null}
    </div>
  );
};

const filterCode = (code: string): string => {
  const [start, end] = findUniformValues(code);
  if (start < 0 || end < 0) {
    return code;
  }

  if (start > 0) {
    return `${code.substring(0, start)}${code.substring(end)}`;
  }
  return code.substring(end);
};
