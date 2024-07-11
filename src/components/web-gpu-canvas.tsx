import React from "react";
import seedrandom from "seedrandom";
import { saveFilePickerComplete } from "../util";
import { Vector } from "../dsl";
import { ThemeContext } from "./theme-provider";
import { Pause, Play, Rewind, Spin } from "./icons/icons";
import { IconButton } from "./icon-button";
import { Image } from "./icons/image";

interface WebGPUCanvasProps {
  shader: string;
  vertexShader: string;
  fragmentShader: string;
  uniformValues: number[];
  uniformOffsets: number[];
  width: number;
  height: number;
  view: Vector;
  style?: React.CSSProperties;
  onShaderError: (error: string) => void;
  onViewChange: (update: Vector) => void;
}

interface MouseDragPoint {
  x: number;
  y: number;
  xa: number;
  ya: number;
}

const kDefaultMouseDragPoint: MouseDragPoint = { x: 0, y: 0, xa: 0, ya: 0 };

export const WebGPUCanvas: React.FC<WebGPUCanvasProps> = (props) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const timerHandle = React.useRef<ReturnType<typeof setTimeout>>(null);
  const view = React.useRef<Vector>(props.view);
  const gpu = React.useRef<WebGpuWidget>(null);
  const [running, setRunning] = React.useState(false);
  const [fps, setFps] = React.useState(0);
  const [time, setTime] = React.useState(0);
  const [spinning, setSpinning] = React.useState(false);
  const [initialPt, setInitialPt] = React.useState(kDefaultMouseDragPoint);
  const [leftButton, setLeftButton] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const theme = React.useContext(ThemeContext);

  const changeView = (value: Partial<Vector>) =>
    props.onViewChange({
      ...view.current,
      ...value,
    });

  React.useEffect(() => {
    view.current = props.view;
  }, [props.view]);

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
      if (spinning != gpu.current.isSpinning()) {
        setSpinning(!spinning);
      }
      if (fps != Math.round(gpu.current.fps)) {
        setFps(Math.round(gpu.current.fps));
      }
      if (time != gpu.current.time) {
        setTime(gpu.current.time);
      }
    }
    timerHandle.current = setTimeout(() => timerFn(tick + 1), 50);
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
      gpu.current.cameraSettings(
        view.current.x,
        view.current.y,
        view.current.z
      );
    }
  }, [gpu, view.current]);

  const mouseDown = (evt: React.MouseEvent) => {
    if (evt.button != 0) {
      return;
    }
    setInitialPt({
      x: evt.clientX,
      y: evt.clientY,
      xa: view.current.x,
      ya: view.current.y,
    });
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

    const xa = Math.min(Math.max(0, Math.round(initialPt.xa - dxa)), 85);

    changeView({ x: xa, y: ya });
  };
  const mouseUp = (evt: React.MouseEvent) => {
    if (evt.button != 0) {
      return;
    }
    setLeftButton(false);
  };
  const wheel = (evt: WheelEvent) => {
    if (evt.deltaY != 0) {
      const wheelDelta = Number((evt as any).wheelDelta);
      if (!isNaN(wheelDelta)) {
        const delta = evt.deltaY / Math.max(1, Math.abs(wheelDelta));
        changeView({
          z: Math.min(Math.max(-1, view.current.z - delta / 50), 1),
        });
      } else if (Math.abs(evt.deltaY) > 100) {
        changeView({
          z: Math.min(Math.max(-1, view.current.z - evt.deltaY / 10000), 1),
        });
      } else if (Math.abs(evt.deltaY) > 10) {
        changeView({
          z: Math.min(Math.max(-1, view.current.z - evt.deltaY / 1000), 1),
        });
      } else {
        changeView({
          z: Math.min(Math.max(-1, view.current.z - evt.deltaY / 100), 1),
        });
      }
    }
    evt.preventDefault();
    evt.stopPropagation();
  };

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const listener = (evt: WheelEvent) => wheel(evt);

    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, [canvasRef.current]);

  const capture = () => {
    const gpuCanvas = canvasRef.current;
    if (!gpuCanvas) {
      return;
    }
    gpuCanvas.toBlob(
      (blob) =>
        saveFilePickerComplete([blob], "capture.jpg")
          .then()
          .catch(() => {}),
      "image/jpeg",
      0.95
    );
  };

  const canvasStyle = { ...props.style };
  const outerStyle: React.CSSProperties = canvasStyle
    ? { border: canvasStyle.border, gridArea: canvasStyle.gridArea }
    : {};
  if (canvasStyle) {
    canvasStyle.border = undefined;
    canvasStyle.gridArea = undefined;
  }

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
        gridArea: props.style ? props.style.gridArea : undefined,
      }}
    >
      <div
        style={{
          ...outerStyle,
          display: "grid",
          gridTemplateRows: "auto 2em",
          margin: 0,
          padding: 0,
          gap: 0,
        }}
      >
        <canvas
          ref={canvasRef}
          style={canvasStyle}
          width={props.width}
          height={props.height}
          onMouseDown={(e) => mouseDown(e)}
          onMouseUp={(e) => mouseUp(e)}
          onMouseMove={(e) => mouseMove(e)}
          onMouseOut={(e) => setLeftButton(false)}
        />
        <div
          style={{
            background: theme.boldBackground,
            display: "grid",
            gridTemplateColumns: "auto auto 2em auto 1fr auto auto",
            fontSize: "150%",
            alignItems: "center",
            gap: "0.125em",
            padding: "0 0.125em",
          }}
        >
          <IconButton
            size="1em"
            title="Reset time"
            onClick={() => {
              if (gpu.current) {
                gpu.current.resetTime();
              }
            }}
          >
            <Rewind />
          </IconButton>
          <IconButton
            size="1em"
            title={running ? "Pause" : "Play"}
            onClick={() => {
              if (gpu.current) {
                if (running) {
                  gpu.current.stop();
                } else {
                  gpu.current.start();
                }
              }
            }}
          >
            {running ? <Pause /> : <Play />}
          </IconButton>
          <div style={{ fontSize: "50%" }}>{time.toFixed(2)}</div>
          <div style={{ fontSize: "50%" }}>{fps} fps</div>
          <div />
          <IconButton
            size="1em"
            title={spinning ? "Stop spinning" : "Start spinning"}
            onClick={() => {
              if (gpu.current) {
                gpu.current.setSpinning(!spinning);
              } else {
                setSpinning(!spinning);
              }
            }}
            style={{
              color: spinning ? theme.red : undefined,
            }}
          >
            <Spin
              style={{
                transform: `rotate3d(1, 0, 0, ${60 - 0.5 * props.view.x}deg)`,
              }}
            />
          </IconButton>
          <IconButton
            size="1em"
            title="Capture Image"
            onClick={() => capture()}
          >
            <Image />
          </IconButton>
        </div>
      </div>
      <div style={{ display: "flex" }}>
        <input
          type="range"
          className="vertical"
          min={1}
          max={89}
          value={view.current.x}
          onChange={(e) => changeView({ x: e.target.valueAsNumber || 0 })}
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
          value={view.current.z}
          onChange={(e) => changeView({ z: e.target.valueAsNumber || 0 })}
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
        value={view.current.y}
        onChange={(e) => changeView({ y: e.target.valueAsNumber || 0 })}
        style={{
          width: "100%",
        }}
      />
    </div>
  );
};

export class WebGpuWidget {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: GPUCanvasContext;
  device?: GPUDevice;
  noiseTexture?: GPUTexture;
  pipeline?: GPURenderPipeline;
  running = false;
  uniformValues: number[] = [];
  uniformOffsets: number[] = [];
  uniformBufferSize: number = 0;
  uniformBuffer?: GPUBuffer;
  uniformBindGroup?: GPUBindGroup;
  x: number = 0;
  y: number = 0;
  time: number = 0;
  lastFrame: number = 0;
  zoom: number = 0;
  spinning: boolean = false;
  spinStart: CSSNumberish = document.timeline.currentTime;
  multiplier: number = 1;
  sampler: number = 0;
  fps: number = 0;
  fc: number = 0;
  fs: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("webgpu", {
      preserveDrawingBuffer: true,
    }) as unknown as GPUCanvasContext;
  }

  async init(shaderSrc: string, vertex: string, fragment: string) {
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter!.requestDevice();

    this.noiseTexture = this.createNoise(256);

    await this.updateShader(shaderSrc, vertex, fragment);

    const devicePixelRatio = window.devicePixelRatio;
    if (this.canvas.clientWidth && this.canvas.clientHeight) {
      this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
      this.canvas.height = this.canvas.clientHeight * devicePixelRatio;
    }

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
          {
            binding: 1,
            resource: this.noiseTexture.createView(),
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
    this.spinStart = document.timeline.currentTime;
    if (!this.running) {
      this.running = true;
      requestAnimationFrame((n) => this.frame(n));
    }
  }

  stop() {
    this.running = false;
    this.lastFrame = 0;
  }

  frame(timestamp: number) {
    if (!this.uniformBindGroup) {
      this.running = false;
      return;
    }

    if (this.fc >= 10) {
      this.fps = (this.fc * 1000) / (timestamp - this.fs);
      this.fc = 1;
      this.fs = timestamp;
    } else {
      this.fc++;
    }

    if (this.running) {
      if (this.lastFrame > 0) {
        this.time += (timestamp - this.lastFrame) / 1000;
      }
      this.lastFrame = timestamp;
    }

    const uniformData = new ArrayBuffer(this.uniformBufferSize);

    const floats = new Float32Array(uniformData);
    floats[0] = this.canvas.width;
    floats[1] = this.canvas.height;
    floats[2] = this.time;
    floats[4] = this.x;
    floats[5] = this.y;
    floats[6] = this.zoom;
    floats[7] = this.spinning ? (timestamp - Number(this.spinStart)) / 1000 : 0;

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
    if (this.y != y) {
      this.spinning = false;
      this.y = y;
    }
    this.zoom = zoom;
    if (!this.running) {
      requestAnimationFrame((n) => this.frame(n));
    }
  }

  isSpinning() {
    return this.spinning;
  }

  setSpinning(enabled: boolean) {
    this.spinning = enabled;
    if (this.spinning) {
      this.start();
    }
  }

  createNoise(size: number): GPUTexture {
    const imageData = new ImageData(size, size);
    const rawImage = imageData.data;
    const rng = seedrandom("785593ed-2275-4910-9f8d-55b8f184161e");
    const words = new Uint32Array(rawImage.buffer);
    for (let i = 0; i < words.length; i++) {
      words[i] = rng.int32();
    }
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);
    const img = canvas.transferToImageBitmap();

    const texture = this.device.createTexture({
      size: [img.width, img.height, 1],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.device.queue.copyExternalImageToTexture(
      { source: img },
      { texture: texture },
      [img.width, img.height]
    );

    return texture;
  }

  resetTime() {
    this.time = 0;
    this.lastFrame = 0;
  }
}
