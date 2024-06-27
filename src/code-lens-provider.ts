import monaco from "monaco-editor";

export class CodeLensProvider implements monaco.languages.CodeLensProvider {
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly captureId: string;
  private getValues: () => string[];

  constructor(editor: monaco.editor.IStandaloneCodeEditor) {
    this.editor = editor;
    this.captureId = editor.addCommand(0, () => this.captureCommand());
  }

  updateValueGetter(callback: () => string[]) {
    this.getValues = callback;
  }

  provideCodeLenses(
    model: monaco.editor.ITextModel,
    token: monaco.CancellationToken
  ): monaco.languages.ProviderResult<monaco.languages.CodeLensList> {
    if (!this.getValues) {
      return null;
    }
    return {
      lenses: [
        {
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 1,
          },
          id: "Capture New",
          command: {
            id: this.captureId,
            title: "Capture interactive values",
            tooltip:
              "Insert the current interactive values into the document so that they can be restored when the file is loaded",
          },
        },
      ],
      dispose: () => {},
    };
  }

  captureCommand() {
    if (!this.getValues) {
      return;
    }
    const lines = this.getValues();
    if (lines.length == 0) {
      return;
    }
    lines.unshift(
      "#|start-interactive-values",
      `  Captured at ${new Date().toLocaleString()}`
    );
    lines.push("end-interactive-values|#");

    this.editor.focus();

    const model = this.editor.getModel();

    const startMatch = model.findMatches(
      "#|start-interactive-values",
      true,
      false,
      true,
      null,
      false,
      1
    );
    const endMatch = model.findMatches(
      "end-interactive-values|#",
      true,
      false,
      true,
      null,
      false,
      1
    );
    if (startMatch.length == 1 && endMatch.length == 1) {
      const start = startMatch[0].range;
      const end = endMatch[0].range;

      this.editor.executeEdits("code-lens", [
        {
          range: {
            startLineNumber: start.startLineNumber,
            startColumn: start.startColumn,
            endLineNumber: end.endLineNumber,
            endColumn: end.endColumn,
          },
          text: lines.join("\n"),
          forceMoveMarkers: true,
        },
      ]);
      return;
    }
    lines.push("\n");
    this.editor.executeEdits("code-lens", [
      {
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        },
        text: lines.join("\n"),
        forceMoveMarkers: true,
      },
    ]);
  }
}
