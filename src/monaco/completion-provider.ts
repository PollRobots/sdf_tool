import monaco from "monaco-editor";
import { kDslIdentifierRe } from "../read";
import { Env } from "../env";
import { addBuiltins } from "../builtins";
import { DocumentedValue, DslEvalError, isDocumentedObject } from "../dsl";
import { cleanDoc } from "./hover-provider";

export class CompletionProvider
  implements monaco.languages.CompletionItemProvider
{
  private readonly matcher: RegExp;
  private readonly env: Env;
  private readonly keys: string[];

  constructor() {
    this.matcher = new RegExp(`\\(\\s*${kDslIdentifierRe.source.substring(1)}`);
    this.env = new Env();
    addBuiltins(this.env);
    const allKeys = Array.from(this.env.keys).sort();
    this.keys = allKeys.filter((key) => {
      const def = this.env.get(key);
      return def && isDocumentedObject(def) && def.value.insertText;
    });
  }

  provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.CompletionContext,
    token: monaco.CancellationToken
  ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
    const textUntilPosition = model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });
    const match = textUntilPosition.match(this.matcher);
    if (!match) {
      return {
        suggestions: [],
      };
    }
    const identifier = match[0].substring(1).trimStart();
    const start = position.delta(0, -identifier.length);
    const range: monaco.IRange = {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    };

    return {
      suggestions: this.keys.map((key) => ({
        label: key,
        kind: window.monaco.languages.CompletionItemKind.Function,
        insertText: (this.env.get(key).value as DocumentedValue).insertText!,
        insertTextRules:
          window.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range: range,
      })),
    };
  }
  resolveCompletionItem?(
    item: monaco.languages.CompletionItem,
    token: monaco.CancellationToken
  ): monaco.languages.ProviderResult<monaco.languages.CompletionItem> {
    const name = typeof item.label === "string" ? item.label : item.label.label;
    const def = this.env.get(name);
    if (!isDocumentedObject(def)) {
      return item;
    }

    return {
      ...item,
      documentation: {
        value: cleanDoc(def.value.docs)
          .map((el) => el.value)
          .join("\n\n"),
      },
    };
  }
}
