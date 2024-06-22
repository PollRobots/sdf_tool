import React from "react";
import monaco from "monaco-editor";
import { registerLanguage } from "./monaco/language";
import * as solarized from "./monaco/solarized";
import * as solarizedContrast from "./monaco/solarized";

export interface EditorProps {
  style?: React.CSSProperties;
  theme?: string;
  defaultLanguage?: string;
  defaultValue?: string;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

const createEditor = (
  element: HTMLElement,
  options: monaco.editor.IStandaloneEditorConstructionOptions
) => {
  type CreateFn = typeof monaco.editor.create;
  const create = (window as any).monaco.editor.create as CreateFn;

  return create(element, options);
};

export const Editor: React.FC<EditorProps> = (props) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor>();

  const resizeEditor = () => {
    if (editorRef.current && ref.current) {
      editorRef.current.layout({
        width: ref.current.offsetWidth,
        height: ref.current.offsetHeight,
      });
    }
  };

  React.useEffect(() => {
    if (!editorRef.current) {
      return;
    }
    editorRef.current.updateOptions({ theme: props.theme });
  }, [props.theme]);

  React.useEffect(() => {
    if (!ref.current) {
      return;
    }
    registerLanguage();
    solarized.defineThemes();
    solarizedContrast.defineThemes();

    const editor = createEditor(ref.current, {
      language: props.defaultLanguage,
      theme: props.theme,
      value: props.defaultValue,
    });
    editorRef.current = editor;
    window.addEventListener("resize", resizeEditor);
    if (props.onMount) {
      props.onMount(editor);
    }
    return () => {
      window.removeEventListener("resize", resizeEditor);
      editorRef.current = undefined;
      editor.dispose();
    };
  }, []);

  return <div style={props.style} ref={ref}></div>;
};
