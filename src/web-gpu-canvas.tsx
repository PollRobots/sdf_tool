import React from "react";
import { mat4, vec3 } from "wgpu-matrix";

interface WebGPUCanvasProps {
  shader: string;
  vertexShader: string;
  fragmentShader: string;
  width: number;
  height: number;
  style?: React.CSSProperties;
}

export const WebGPUCanvas: React.FC<WebGPUCanvasProps> = (props) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [gpu, setGpu] = React.useState<Foo>();
  const [xAngle, setXAngle] = React.useState(15);
  const [yAngle, setYAngle] = React.useState(0);
  const [multiplier, setMultiplier] = React.useState(1);
  const [sampler, setSampler] = React.useState("nearest");
  const [initialPt, setInitialPt] = React.useState({
    x: 0,
    y: 0,
    xa: 0,
    ya: 0,
  });
  const [leftButton, setLeftButton] = React.useState(false);

  React.useEffect(() => {
    if (!canvasRef.current || gpu) {
      return;
    }

    const new_gpu = new Foo(canvasRef.current);
    setGpu(new_gpu);

    new_gpu
      .init(props.shader, props.vertexShader, props.fragmentShader)
      .then(() => console.log("initialized"))
      .catch((err) => {
        console.error("Initialization error:", err);
      });
  }, [canvasRef.current]);

  React.useEffect(() => {
    if (gpu) {
      gpu.angles(xAngle, yAngle);
    }
  }, [gpu, yAngle, xAngle]);

  const mouseDown = (evt: React.MouseEvent) => {
    if (evt.button != 0) {
      return;
    }
    setInitialPt({ x: evt.clientX, y: evt.clientY, xa: xAngle, ya: yAngle });
    setLeftButton(true);
  };
  const mouseMove = (evt: React.MouseEvent) => {
    if (!leftButton) {
      return;
    }
    const dya = (360 * (evt.clientX - initialPt.x)) / canvasRef.current!.width;
    const dxa = (180 * (evt.clientY - initialPt.y)) / canvasRef.current!.height;

    let ya = Math.round(initialPt.ya + dya);
    while (ya < -180) {
      ya += 360;
    }
    while (ya > 180) {
      ya -= 360;
    }
    setYAngle(ya);

    let xa = Math.min(Math.max(5, Math.round(initialPt.xa - dxa)), 85);
    setXAngle(xa);
  };
  const mouseUp = (evt: React.MouseEvent) => {
    if (evt.button != 0) {
      return;
    }
    setLeftButton(false);
  };

  return (
    <div
      style={{
        display: "grid",
        width: "fit-content",
        alignItems: "center",
        justifyItems: "center",
        gap: "0.5em",
        gridTemplateColumns: "auto auto",
      }}
    >
      <canvas
        ref={canvasRef}
        width={props.width}
        height={props.height}
        style={props.style}
        onMouseDown={(e) => mouseDown(e)}
        onMouseUp={(e) => mouseUp(e)}
        onMouseMove={(e) => mouseMove(e)}
        onMouseOut={(e) => setLeftButton(false)}
      />
      <input
        type="range"
        min={5}
        max={85}
        value={xAngle}
        onChange={(e) => setXAngle(e.target.valueAsNumber || 0)}
        style={{
          height: props.height,
          writingMode: "vertical-rl",
          direction: "rtl",
        }}
      />
      <input
        type="range"
        min={-180}
        max={180}
        value={yAngle}
        onChange={(e) => setYAngle(e.target.valueAsNumber || 0)}
        style={{ width: props.width }}
      />

      <div
        style={{
          gridArea: "3/1/4/3",
          display: "grid",
          gap: "0.5em",
          width: "fit-content",
          gridTemplateColumns: "5em 5em 5em 5em",
        }}
      >
        <button
          disabled={!gpu || gpu.running}
          onClick={() => {
            if (gpu) {
              gpu.start();
            }
          }}
        >
          start
        </button>
        <button
          disabled={!gpu || !gpu.running}
          onClick={() => {
            if (gpu) {
              gpu.stop();
            }
          }}
        >
          stop
        </button>
        <input
          type="number"
          value={multiplier}
          min={1}
          max={4}
          onChange={(e) => {
            const value = Number(e.target.value) || 1;
            setMultiplier(Math.min(Math.max(1, value), 4));
          }}
        />
        <select
          value={sampler}
          onChange={(e) =>
            setSampler(e.target.value === "nearest" ? "nearest" : "linear")
          }
        >
          <option>nearest</option>
          <option>linear</option>
        </select>
      </div>
    </div>
  );
};

class Foo {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: GPUCanvasContext;
  device?: GPUDevice;
  pipeline?: GPURenderPipeline;
  running = false;
  uniformBufferSize: number = 0;
  uniformBuffer?: GPUBuffer;
  uniformBindGroup?: GPUBindGroup;
  x: number = 0;
  y: number = 0;
  multiplier: number = 1;
  sampler: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("webgpu") as GPUCanvasContext;
  }

  async init(shaderSrc: string, vertex: string, fragment: string) {
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter!.requestDevice();

    const devicePixelRatio = window.devicePixelRatio;
    this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * devicePixelRatio;

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    this.ctx.configure({
      device: this.device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });

    const shader = this.device.createShaderModule({ code: shaderSrc });

    this.pipeline = await this.device.createRenderPipelineAsync({
      layout: "auto",
      vertex: {
        module: shader,
        entryPoint: vertex,
      },
      fragment: {
        module: shader,
        entryPoint: fragment,
        targets: [
          {
            format: presentationFormat,
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    this.uniformBufferSize = 2 * 4 * 4;
    this.uniformBuffer = this.device.createBuffer({
      size: this.uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.uniformBindGroup = this.device!.createBindGroup({
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.uniformBuffer!,
          },
        },
      ],
    });

    this.running = false;
    this.start();
  }

  start() {
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.frame());
    }
  }

  stop() {
    this.running = false;
  }

  frame() {
    if (!this.uniformBindGroup) {
      this.running = false;
      return;
    }

    const uniformData = new ArrayBuffer(this.uniformBufferSize);

    const floats = new Float32Array(uniformData);
    floats[0] = this.canvas.width;
    floats[1] = this.canvas.height;
    floats[4] = this.x;
    floats[5] = this.y;

    this.device?.queue.writeBuffer(
      this.uniformBuffer!,
      0,
      uniformData,
      0,
      uniformData.byteLength
    );

    const encoder = this.device?.createCommandEncoder()!;
    const textureView = this.ctx.getCurrentTexture().createView();

    const passDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: [0.5, 0.5, 0.5, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const pass = encoder.beginRenderPass(passDescriptor)!;

    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, this.uniformBindGroup!);
    pass.draw(3);
    pass.end();

    this.device?.queue.submit([encoder.finish()]);
    if (this.running) {
      requestAnimationFrame(() => this.frame());
    }
  }

  get xAngle() {
    return this.x;
  }

  set xAngle(value: number) {
    this.x = value;
    if (this.running) {
      this.frame();
    }
  }

  get yAngle() {
    return this.y;
  }

  set yAngle(value: number) {
    this.y = value;
    if (this.running) {
      this.frame();
    }
  }

  angles(x: number, y: number) {
    this.x = x;
    this.y = y;
    if (this.running) {
      this.frame();
    }
  }
}
