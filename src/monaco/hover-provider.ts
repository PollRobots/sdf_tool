import monaco from "monaco-editor";
import { tokenize } from "../read";
import { Env } from "../env";
import { addBuiltins } from "../builtins";
import { isDocumentedObject, isSpecial } from "../dsl";
import { kSpecialDoc } from "../special-doc";

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

    const getRange = (ident: string, offset: number): monaco.IRange => {
      const start = model.getPositionAt(offset);
      const end = model.getPositionAt(offset + ident.length);
      return {
        startColumn: start.column,
        startLineNumber: start.lineNumber,
        endColumn: end.column,
        endLineNumber: end.lineNumber,
      };
    };

    try {
      for (const token of tokenize(src)) {
        if (token.type === "identifier") {
          if (
            token.offset <= offset &&
            offset < token.offset + (token.value as string).length
          ) {
            const ident = token.value as string;
            if (isSpecial(ident)) {
              const doc = kSpecialDoc.get(ident);
              if (!doc) {
                return null;
              }
              return {
                range: getRange(ident, token.offset),
                contents: cleanDoc(doc),
              };
            }
            const def = this.env.get(ident);
            if (!isDocumentedObject(def)) {
              return null;
            }
            return {
              range: getRange(ident, token.offset),
              contents: cleanDoc(def.value.docs),
            };
          }
        }
      }
    } catch (err) {}
  }
}

export const cleanDoc = (docs: string[]): monaco.IMarkdownString[] =>
  docs.map((el) => {
    if (el.startsWith("```example")) {
      return { value: "```" + el.substring(10) };
    }
    return { value: el };
  });
