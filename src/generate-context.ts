import {
  DslGeneratorError,
  Generated,
  GeneratedType,
  Lambda,
  isVectorName,
  kEmptyList,
} from "./dsl";
import { Env } from "./env";
import {
  GenerateContext,
  GenerateContextLog,
  GeneratedLambda,
  UniformInfo,
  generate,
  indent,
} from "./generate";

export class GenerateContextImpl implements GenerateContext {
  log: GenerateContextLog;
  dependencies: Set<string>;
  readonly builtins: Set<string>;

  private haveOffsets = false;
  private readonly uniformsInfo: UniformInfo[];
  private readonly lambdas: Map<Lambda, GeneratedLambda> = new Map();
  private readonly names: Set<string> = new Set();
  private readonly digests = new Map<string, string>();

  constructor(
    log: GenerateContextLog,
    dependencies: Set<string>,
    uniforms: string[],
    builtins?: Iterable<string>
  ) {
    this.log = log;
    this.dependencies = dependencies;
    this.uniformsInfo = uniforms.map((el) => ({
      name: el,
      isVector: isVectorName(el),
    }));
    this.builtins = new Set(builtins);
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

  getName(hint: string, requireNumber?: boolean, identifier?: string): string {
    if (identifier) {
      const elf = digest(identifier);
      if (elf && this.digests.has(elf)) {
        return this.digests.get(elf);
      }
    }

    if (!this.names.has(hint) && !requireNumber) {
      return hint;
    }

    for (let i = 0; i <= this.names.size; i++) {
      const test = `${hint}_${i + this.names.size}`;
      if (!this.names.has(test)) {
        return test;
      }
    }
    throw new Error(`Cannot name ${hint}`);
  }

  addFunction(
    name: string,
    code: string[],
    type: GeneratedType,
    identifier?: string
  ) {
    if (identifier) {
      const elf = digest(identifier);
      if (this.digests.has(elf)) {
        return;
      }
      this.digests.set(elf, name);
    }
    this.names.add(name);
    this.lambdas.set(
      {
        symbols: [],
        body: kEmptyList,
        closure: undefined,
      },
      { name: name, code: code.join("\n"), type: type }
    );
  }

  getLambda(l: Lambda): GeneratedLambda | undefined {
    return this.lambdas.get(l);
  }

  private setLambdaName(hint: string): string {
    const name = `lambda_${hint}`;
    return this.getName(name);
  }

  setLambda(l: Lambda, hint: string, args: GeneratedType[]): GeneratedLambda {
    const name = this.setLambdaName(hint);

    const lines = [`fn ${name}(`, "  p: vec3<f32>,", "  col: vec3<f32>,"];
    lines.push(
      ...args
        .map((arg) => {
          const t = mapTypeToWgsl(arg);
          if (!t) {
            throw new DslGeneratorError(
              `Unexpected argument type ${arg}`,
              l.body.offset,
              1
            );
          }
          return t;
        })
        .map((t, i) => `  ${l.symbols[i]}: ${t},`)
    );

    const lambdaEnv = new Env(l.closure);
    l.symbols.forEach((sym, i) => {
      lambdaEnv.set(sym, {
        type: "generated",
        value: {
          type: args[i],
          code: sym,
        } as Generated,
        offset: l.body.offset,
        length: 1,
      });
    });

    const body = generate(l.body, lambdaEnv, this);
    const returnType = mapTypeToWgsl(body.type) || "vec4<f32>";

    lines.push(`) -> ${returnType} {`);
    if (body.type === "void") {
      lines.push("  var res: f32 = 1e5;");
      lines.push(...indent(body.code));
      lines.push("  return vec4<f32>(col, res);");
    } else {
      lines.push(`  return ${body.code};`);
    }
    lines.push("}");

    const generated = {
      name: name,
      type: body.type,
      code: lines.join("\n"),
    };
    this.names.add(name);
    this.lambdas.set(l, generated);
    return generated;
  }

  get generatedLambdas(): GeneratedLambda[] {
    return Array.from(this.lambdas.keys())
      .sort()
      .map((name) => this.lambdas.get(name));
  }
}

const mapTypeToWgsl = (type: GeneratedType): string | undefined => {
  switch (type) {
    case "float":
      return "f32";
    case "sdf":
    case "vec":
      return "vec3<f32>";
    default:
      return;
  }
};

const digest = (input: string): string => {
  const elfhash = new TextEncoder().encode(input).reduce((accum, ch) => {
    accum = (accum << 4) + ch;
    const x = accum & 0xf0000000;
    if (x != 0) {
      accum = accum ^ (x >> 24);
    }
    return accum & ~x;
  }, 0);
  return elfhash.toString(16).padStart(8, "0");
};
