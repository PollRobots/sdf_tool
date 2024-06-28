import { isVectorName } from "./dsl";
import { GenerateContext, GenerateContextLog, UniformInfo } from "./generate";

export class GenerateContextImpl implements GenerateContext {
  log: GenerateContextLog;
  dependencies: Set<string>;

  private haveOffsets = false;
  private readonly uniformsInfo: UniformInfo[];

  constructor(
    log: GenerateContextLog,
    dependencies: Set<string>,
    uniforms: string[]
  ) {
    this.log = log;
    this.dependencies = dependencies;
    this.uniformsInfo = uniforms.map((el) => ({
      name: el,
      isVector: isVectorName(el),
    }));
  }

  get uniforms(): string[] {
    return this.uniformsInfo.map((el) => el.name);
  }

  get offsets(): number[] {
    return this.uniformsInfo.map((el) => {
      if (el.isVector) {
        return (
          el.offset * 4 +
          (el.name.endsWith("x") ? 0 : el.name.endsWith("y") ? 1 : 2)
        );
      }
      return el.offset;
    });
  }

  getUniformCode(ident: string, failForUnknown?: boolean): string {
    let index = this.uniformsInfo.findIndex((el) => el.name === ident);
    if (index < 0) {
      if (failForUnknown) {
        throw new Error(`Unknown uniform value ${ident}`);
      }
      index = this.uniforms.length;
      this.uniformsInfo.push({ name: ident, isVector: isVectorName(ident) });
      this.haveOffsets = false;
    }
    return `{%${ident}%}`;
  }

  calculateOffsets() {
    this.uniformsInfo.sort((a, b) => {
      if (a.isVector && b.isVector) {
        return a.name.localeCompare(b.name);
      } else if (a.isVector) {
        return -1;
      } else if (b.isVector) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    let offset = 0;
    const vectorOffsets = new Map<string, number>();

    this.uniformsInfo
      .filter((el) => el.isVector)
      .forEach((el) => {
        const vectorName = el.name.substring(0, el.name.lastIndexOf("."));
        if (vectorOffsets.has(vectorName)) {
          el.offset = vectorOffsets.get(vectorName);
        } else {
          el.offset = offset;
          vectorOffsets.set(vectorName, offset);
          offset++;
        }
      });
    offset *= 4;

    this.uniformsInfo
      .filter((el) => !el.isVector)
      .forEach((el) => {
        el.offset = offset;
        offset++;
      });

    this.haveOffsets = true;
  }

  applyUniforms(lines: string[]) {
    if (!this.haveOffsets) {
      this.calculateOffsets();
    }
    for (let i = 0; i < lines.length; i++) {
      lines[i] = lines[i]
        .replaceAll(
          /vec3\<f32\>\(\s*{%([^%]+)%},\s*{%([^%]+)%},\s*{%([^%]+)%}\s*\)/g,
          (match, a, b, c) => {
            if (!isVectorName(a) || !isVectorName(b) || !isVectorName(c)) {
              return match;
            }
            const aVectorName = a.substring(0, a.lastIndexOf("."));
            const bVectorName = b.substring(0, b.lastIndexOf("."));
            const cVectorName = c.substring(0, c.lastIndexOf("."));
            if (aVectorName !== bVectorName || bVectorName !== cVectorName) {
              return match;
            }
            const uniform = this.uniformsInfo.find((el) => el.name === a);
            if (!uniform) {
              return match;
            }
            return `uniforms.values[${uniform.offset}].${a.charAt(
              a.length - 1
            )}${b.charAt(b.length - 1)}${c.charAt(c.length - 1)}`;
          }
        )
        .replaceAll(/{%([^%]+)%}/g, (match, ident) => {
          const uniform = this.uniformsInfo.find((el) => el.name === ident);
          if (!uniform) {
            return match;
          }
          if (uniform.isVector) {
            return `uniforms.values[${uniform.offset}].${uniform.name.charAt(
              uniform.name.length - 1
            )}`;
          } else {
            const index = uniform.offset;
            return `uniforms.values[${Math.floor(index / 4)}][${index % 4}]`;
          }
        });
    }
  }
}
