import React from "react";
import { mat4, vec3 } from "wgpu-matrix";

interface WebGPUCanvasProps {
  shader: string;
  vertexShader: string;
  fragmentShader: string;
  uniformValues: number[];
  uniformOffsets: number[];
  width: number;
  height: number;
  style?: React.CSSProperties;
  onShaderError: (error: string) => void;
}

export const WebGPUCanvas: React.FC<WebGPUCanvasProps> = (props) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const timerHandle = React.useRef<ReturnType<typeof setTimeout>>(null);
  const gpu = React.useRef<WebGpuWidget>(null);
  const [running, setRunning] = React.useState(false);
  const [fps, setFps] = React.useState(0);
  const [xAngle, setXAngle] = React.useState(15);
  const [yAngle, setYAngle] = React.useState(0);
  const [zoom, setZoom] = React.useState(0);
  const [initialPt, setInitialPt] = React.useState({
    x: 0,
    y: 0,
    xa: 0,
    ya: 0,
  });
  const [leftButton, setLeftButton] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  const timerFn = (t: number) => {
    setTick(t + 1);
  };

  React.useEffect(() => {
    if (!tick) {
      return;
    }

    if (gpu.current) {
      if (running != gpu.current.running) {
        setRunning(!running);
      }
      if (fps != Math.round(gpu.current.fps)) {
        setFps(Math.round(gpu.current.fps));
      }
    }
    timerHandle.current = setTimeout(() => timerFn(tick + 1), 250);
  }, [tick]);

  React.useEffect(() => {
    timerHandle.current = setTimeout(() => timerFn(tick), 250);
    return () => {
      if (timerHandle.current) {
        clearTimeout(timerHandle.current);
      }
    };
  }, ["once"]);

  React.useEffect(() => {
    if (!canvasRef.current || gpu.current) {
      return;
    }

    gpu.current = new WebGpuWidget(canvasRef.current);

    gpu.current
      .init(props.shader, props.vertexShader, props.fragmentShader)
      .then(() => console.log("initialized"))
      .catch((err) => {
        console.error("Initialization error:", err);
      });
  }, [canvasRef.current]);

  React.useEffect(() => {
    if (!gpu.current || !gpu.current.device || !props.shader) {
      return;
    }

    gpu.current.setUniformValues(props.uniformValues, props.uniformOffsets);
    gpu.current
      .updateShader(props.shader, props.vertexShader, props.fragmentShader)
      .then((shaderError) => {
        if (shaderError) {
          props.onShaderError(shaderError.message);
        }
      })
      .catch((err) => console.error("Error updating shader:", err));
  }, [props.shader]);

  React.useEffect(() => {
    if (!gpu.current) {
      return;
    }
    gpu.current.setUniformValues(props.uniformValues, props.uniformOffsets);
  }, [props.uniformValues]);

  React.useEffect(() => {
    if (gpu.current) {
      gpu.current.cameraSettings(xAngle, yAngle, zoom);
    }
  }, [gpu, yAngle, xAngle, zoom]);

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
        height: "fit-content",
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
      <div>
        <input
          type="range"
          className="vertical"
          min={5}
          max={85}
          value={xAngle}
          onChange={(e) => setXAngle(e.target.valueAsNumber || 0)}
          style={{
            height: props.style
              ? props.style.height || props.height
              : props.height,
          }}
        />
        <input
          type="range"
          className="vertical"
          min={-1}
          max={1}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(e.target.valueAsNumber || 0)}
          style={{
            height: props.style
              ? props.style.height || props.height
              : props.height,
          }}
        />
      </div>
      <input
        type="range"
        min={-180}
        max={180}
        value={yAngle}
        onChange={(e) => setYAngle(e.target.valueAsNumber || 0)}
        style={{
          width: "100%",
        }}
      />

      <div
        style={{
          gridArea: "3/1/4/3",
          display: "flex",
          gap: "0.5em",
          width: "fit-content",
          alignItems: "center",
        }}
      >
        <button
          disabled={running}
          onClick={() => {
            if (gpu.current) {
              gpu.current.start();
            }
          }}
        >
          start
        </button>
        <button
          disabled={!running}
          onClick={() => {
            if (gpu.current) {
              gpu.current.stop();
            }
          }}
        >
          stop
        </button>
        <span>{fps} FPS</span>
      </div>
    </div>
  );
};

class WebGpuWidget {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: GPUCanvasContext;
  device?: GPUDevice;
  pipeline?: GPURenderPipeline;
  running = false;
  uniformValues: number[] = [];
  uniformOffsets: number[] = [];
  uniformBufferSize: number = 0;
  uniformBuffer?: GPUBuffer;
  uniformBindGroup?: GPUBindGroup;
  x: number = 0;
  y: number = 0;
  zoom: number = 0;
  multiplier: number = 1;
  sampler: number = 0;
  fps: number = 0;
  fc: number = 0;
  fs: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("webgpu") as unknown as GPUCanvasContext;
  }

  async init(shaderSrc: string, vertex: string, fragment: string) {
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter!.requestDevice();

    await this.updateShader(shaderSrc, vertex, fragment);

    const devicePixelRatio = window.devicePixelRatio;
    this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * devicePixelRatio;

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    this.ctx.configure({
      device: this.device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });

    this.running = false;
    this.start();
  }

  setUniformValues(values: number[], offsets: number[]) {
    this.uniformValues = [...values];
    this.uniformOffsets = [...offsets];
  }

  async updateShader(
    shaderSrc: string,
    vertex: string,
    fragment: string
  ): Promise<GPUError> {
    this.device.pushErrorScope("validation");
    try {
      const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
      const shader = this.device.createShaderModule({ code: shaderSrc });
      const compilationInfo = await shader.getCompilationInfo();
      const errors = compilationInfo.messages
        .filter((el) => el.type !== "info")
        .map((el) => {
          if (el.lineNum == 0) {
            return el.message;
          }
          const line = shaderSrc.split("\n")[el.lineNum - 1];
          return `Line ${el.lineNum}:${el.linePos} ${el.type}: ${el.message}
${line}
${"^".padStart(el.linePos)}`;
        });
      if (errors.length != 0) {
        return new GPUValidationError(errors.join("\n\n"));
      }

      const pipeline = await this.device.createRenderPipelineAsync({
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

      const maxOffset =
        this.uniformOffsets.length == 0
          ? 0
          : this.uniformOffsets.reduce((ac, el) => Math.max(ac, el));

      const uniformBufferSize = 2 * 4 * 4 + 4 * ((maxOffset + 4 + 15) & ~0xf);
      const uniformBuffer = this.device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const uniformBindGroup = this.device!.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: uniformBuffer,
            },
          },
        ],
      });

      const error = await this.device.popErrorScope();
      if (error) {
        return error;
      } else {
        this.pipeline = pipeline;
        this.uniformBufferSize = uniformBufferSize;
        this.uniformBuffer = uniformBuffer;
        this.uniformBindGroup = uniformBindGroup;
        return null;
      }
    } catch (err) {
      const error = await this.device.popErrorScope();
      if (error) {
        return error;
      }
      throw err;
    }
  }

  start() {
    if (!this.running) {
      this.running = true;
      requestAnimationFrame((n) => this.frame(n));
    }
  }

  stop() {
    this.running = false;
  }

  frame(timestamp: number) {
    if (!this.uniformBindGroup) {
      this.running = false;
      return;
    }

    if (this.fc >= 10) {
      this.fps = (this.fc * 1000) / (timestamp - this.fs);
      this.fc = 0;
      this.fs = timestamp;
    } else {
      this.fc++;
    }

    const uniformData = new ArrayBuffer(this.uniformBufferSize);

    const floats = new Float32Array(uniformData);
    floats[0] = this.canvas.width;
    floats[1] = this.canvas.height;
    floats[4] = this.x;
    floats[5] = this.y;
    floats[6] = this.zoom;

    this.uniformValues.forEach(
      (el, i) => (floats[8 + this.uniformOffsets[i]] = el)
    );

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
      requestAnimationFrame((n) => this.frame(n));
    }
  }

  cameraSettings(x: number, y: number, zoom: number) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    if (!this.running) {
      requestAnimationFrame((n) => this.frame(n));
    }
  }
}
