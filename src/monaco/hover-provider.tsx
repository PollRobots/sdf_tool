import monaco from "monaco-editor";
import { tokenize } from "../read";
import { Env } from "../env";
import { addBuiltins } from "../builtins";
import { isDocumentedObject } from "../dsl";

export class HoverProvider implements monaco.languages.HoverProvider {
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly env: Env;

  constructor(editor: monaco.editor.IStandaloneCodeEditor) {
    this.editor = editor;
    this.env = new Env();
    addBuiltins(this.env);
  }

  provideHover(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken,
    context?: monaco.languages.HoverContext<monaco.languages.Hover>
  ): monaco.languages.ProviderResult<monaco.languages.Hover> {
    var src = this.editor.getValue();
    var offset = model.getOffsetAt(position);
    try {
      for (const token of tokenize(src)) {
        if (token.type === "identifier") {
          if (
            token.offset <= offset &&
            offset < token.offset + (token.value as string).length
          ) {
            const def = this.env.get(token.value as string);
            if (!isDocumentedObject(def)) {
              return null;
            }
            const start = model.getPositionAt(token.offset);
            const end = model.getPositionAt(
              token.offset + (token.value as string).length
            );
            const res: monaco.languages.Hover = {
              range: {
                startColumn: start.column,
                startLineNumber: start.lineNumber,
                endColumn: end.column,
                endLineNumber: end.lineNumber,
              },
              contents: def.value.docs.map((el) => ({ value: el })),
            };
            return res;
          }
        }
      }
    } catch (err) {}
  }
}
