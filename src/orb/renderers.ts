/// <reference types="@webgpu/types" />
import { GLSL_FS, GLSL_VS, WGSL } from './shaders';

export interface OrbRenderer {
  readonly kind: 'webgpu' | 'webgl2';
  /** 20 floats: u0, u1, cA, cB, cC. */
  render(uniforms: Float32Array): void;
  destroy(): void;
}

// Un único GPUDevice compartido por todos los orbes de la página.
let devicePromise: Promise<GPUDevice | null> | null = null;

function getDevice(): Promise<GPUDevice | null> {
  if (!devicePromise) {
    devicePromise = (async () => {
      if (!('gpu' in navigator) || !navigator.gpu) return null;
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
        if (!adapter) return null;
        const device = await adapter.requestDevice();
        device.lost.then(() => {
          devicePromise = null;
        });
        return device;
      } catch {
        return null;
      }
    })();
  }
  return devicePromise;
}

export async function createWebGPURenderer(canvas: HTMLCanvasElement): Promise<OrbRenderer | null> {
  const device = await getDevice();
  if (!device) return null;
  const context = canvas.getContext('webgpu');
  if (!context) return null;

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const buffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer } }],
  });

  return {
    kind: 'webgpu',
    render(u) {
      device.queue.writeBuffer(buffer, 0, u.buffer, u.byteOffset, u.byteLength);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy() {
      buffer.destroy();
      context.unconfigure();
    },
  };
}

export function createWebGL2Renderer(canvas: HTMLCanvasElement): OrbRenderer | null {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, GLSL_VS);
  const fs = compile(gl.FRAGMENT_SHADER, GLSL_FS);
  if (!vs || !fs) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const vao = gl.createVertexArray();
  const loc = ['u0', 'u1', 'cA', 'cB', 'cC'].map((n) => gl.getUniformLocation(program, n));

  return {
    kind: 'webgl2',
    render(u) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      loc.forEach((l, i) => gl.uniform4fv(l, u.subarray(i * 4, i * 4 + 4)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteVertexArray(vao);
    },
  };
}
