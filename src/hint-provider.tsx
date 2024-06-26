import monaco from "monaco-editor";
import { Expression, isIdentifier, isVectorName } from "./dsl";
import { Uniform } from "./uniform";

export class HintProvider implements monaco.languages.InlayHintsProvider {
  private changeEmitter: monaco.Emitter<void> = new (
    (window as any).monaco as typeof monaco
  ).Emitter();
  private parsed: Expression[] = [];
  private uniforms: Map<string, Uniform> = new Map();

  onDidChangeInlayHints: monaco.IEvent<void>;

  constructor() {
    this.onDidChangeInlayHints = this.changeEmitter.event;
  }

  updateParsed(exprs: Expression[]) {
    this.parsed = exprs;
    this.changeEmitter.fire();
  }

  updateUniforms(uniforms: Map<string, Uniform>) {
    this.uniforms = uniforms;
    this.changeEmitter.fire();
  }

  findPlaceholders(): Expression[] {
    const placeholders: Expression[] = [];

    const pending = [...this.parsed];
    while (pending.length != 0) {
      const curr = pending.pop();
      switch (curr.type) {
        case "list":
          pending.push(...(curr.value as Expression[]));
          break;
        case "placeholder":
          const retained = curr.value as Expression;
          if (isIdentifier(retained)) {
            placeholders.push(retained);
          } else {
            pending.push(retained);
          }
          break;
      }
    }

    return placeholders;
  }

  provideInlayHints(
    model: monaco.editor.ITextModel,
    range: monaco.Range,
    token: monaco.CancellationToken
  ): monaco.languages.ProviderResult<monaco.languages.InlayHintList> {
    const start = model.getOffsetAt(range.getStartPosition());
    const end = model.getOffsetAt(range.getEndPosition());
    const m = (window as any).monaco as typeof monaco;

    const names = new Set<string>();
    const placeholders = this.findPlaceholders()
      .filter((el) => el.offset >= start || el.offset + el.length <= end)
      .filter((el) => this.uniforms.has(el.value as string))
      .filter((el) => {
        if (names.has(el.value as string)) {
          return false;
        }
        names.add(el.value as string);
        return true;
      });

    const vectorNames = new Set<string>(
      Array.from(names)
        .filter(isVectorName)
        .map((n) => n.substring(0, n.length - 2))
    );

    const findNamedPlaceholder = (name: string) =>
      placeholders.find((el) => el.value === name);

    const getPlaceholderValue = (expr: Expression) =>
      this.uniforms.get(expr.value as string).value;

    // process vectors separately
    const vectorHints: monaco.languages.InlayHint[] = Array.from(
      vectorNames
    ).map((name) => {
      const x = findNamedPlaceholder(`${name}.x`);
      const y = findNamedPlaceholder(`${name}.y`);
      const z = findNamedPlaceholder(`${name}.z`);

      const x_val = x ? getPlaceholderValue(x) : "0";
      const y_val = y ? getPlaceholderValue(y) : "0";
      const z_val = z ? getPlaceholderValue(z) : "0";

      const el = x || y || z;
      return {
        kind: m.languages.InlayHintKind.Type,
        position: model.getPositionAt(el.offset + el.length),
        label: `= #<${x_val}, ${y_val}, ${z_val}>`,
        paddingLeft: true,
      };
    });

    const hints: monaco.languages.InlayHint[] = placeholders
      .filter((el) => !isVectorName(el.value as string))
      .map((el) => ({
        kind: m.languages.InlayHintKind.Type,
        position: model.getPositionAt(el.offset + el.length),
        label: `= ${getPlaceholderValue(el)}`,
        paddingLeft: true,
      }));

    return {
      hints: [...vectorHints, ...hints],
      dispose: () => {},
    };
  }
}
