import React from "react";
import { WebGPUCanvas } from "./web-gpu-canvas";
import shader from "./shader.wgsl";

export const App: React.FC = () => {
  return (
    <div>
      <h1>SDF Tool</h1>
      <WebGPUCanvas
        width={600}
        height={480}
        shader={shader}
        vertexShader="vertex_main"
        fragmentShader="frag_main"
      />
    </div>
  );
};
