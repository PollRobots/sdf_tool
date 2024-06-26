import monaco from "monaco-editor";
import { Expression, isIdentifier } from "./dsl";
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

    const hints: monaco.languages.InlayHint[] = placeholders.map((el) => ({
      kind: m.languages.InlayHintKind.Type,
      position: model.getPositionAt(el.offset + el.length),
      label: `= ${this.uniforms.get(el.value as string).value}`,
      paddingLeft: true,
    }));

    console.log(hints);

    return {
      hints: hints,
      dispose: () => {},
    };
  }
}
