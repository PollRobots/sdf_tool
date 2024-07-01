import monaco from "monaco-editor";
import { IStatusBar, StatusBar } from "./statusbar";
import CMAdapter from "./cm_adapter";
import { initVimAdapter } from "./keymap_vim";

export const makeDomStatusBar = (
  parent: HTMLElement,
  setFocus?: () => void
): IStatusBar => {
  return new StatusBar(parent, setFocus);
};

export function initVimMode(
  editor: monaco.editor.IStandaloneCodeEditor,
  statusBar?: IStatusBar
) {
  initVimAdapter();
  const vimAdapter = new CMAdapter(editor);

  if (!statusBar) {
    return vimAdapter;
  }

  let keyBuffer = "";

  vimAdapter.on("vim-mode-change", (mode) => {
    statusBar.setMode(mode);
  });

  vimAdapter.on("vim-keypress", (key) => {
    if (key === ":") {
      keyBuffer = "";
    } else {
      keyBuffer += key;
    }
    statusBar.setKeyBuffer(keyBuffer);
  });

  vimAdapter.on("vim-command-done", () => {
    keyBuffer = "";
    statusBar.setKeyBuffer(keyBuffer);
  });

  vimAdapter.on("dispose", function () {
    statusBar.toggleVisibility(false);
    statusBar.closeInput();
    statusBar.clear();
  });

  vimAdapter.setStatusBar(statusBar);

  return vimAdapter;
}
