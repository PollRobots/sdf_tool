import React, { CSSProperties } from "react";
import Markdown, { Components } from "react-markdown";
import color from "../../docs/color.md";
import combinators from "../../docs/combinators.md";
import dsl from "../../docs/dsl.md";
import faq from "../../docs/faq.md";
import how_to from "../../docs/how-to.md";
import modifiers from "../../docs/modifiers.md";
import shapes from "../../docs/shapes.md";
import transforms from "../../docs/transforms.md";
import utility from "../../docs/utility.md";
import examples from "../../docs/examples.md";
import { Env } from "../env";
import { addBuiltins } from "../builtins";
import { isDocumentedObject } from "../dsl";
import { IconButton } from "./icon-button";
import { Example } from "./example";

interface DocumentationProps {
  style: CSSProperties;
  onClose: () => void;
  onAddToEditor: (fragment: string) => void;
  colorize: (code: string) => Promise<string>;
}

const kTopics = new Map([
  ["faq", { title: "FAQ", body: faq }],
  ["dsl", { title: "DSL", body: dsl }],
  ["howto", { title: "UI Overview", body: how_to }],
  ["shapes", { title: "Shapes", body: shapes }],
  ["transforms", { title: "Transforms", body: transforms }],
  ["combinators", { title: "Combinators", body: combinators }],
  ["modifiers", { title: "Modifiers", body: modifiers }],
  ["color", { title: "Color", body: color }],
  ["utility", { title: "Utilities", body: utility }],
  ["examples", { title: "Examples", body: examples }],
]);

const makeEnv = () => {
  const env = new Env();
  addBuiltins(env);
  return env;
};

export const Documentation: React.FC<DocumentationProps> = (props) => {
  const [doc, setDoc] = React.useState("howto");
  const env = React.useRef(makeEnv());

  const colorize = async (fragment: string) => {
    const html = await props.colorize(fragment);
    return <code dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const markdownComponents: Partial<Components> = {
    p: (props) => <div className="para">{props.children}</div>,
    img: (props) => {
      if (!props.alt || !props.src || !props.src.endsWith(".doc")) {
        return null;
      }
      const name = props.src.slice(0, props.src.length - 4);
      const def = env.current.get(name);
      if (!isDocumentedObject(def)) {
        return null;
      }
      const docs = def.value.docs;
      return (
        <Markdown
          children={`### ${props.alt}\n\n${docs.join("\n\n")}`}
          components={markdownComponents}
        />
      );
    },
    code: (p) => {
      if (p.className === "language-example") {
        return (
          <Example
            code={p.children.toString()}
            onAddToEditor={props.onAddToEditor}
            colorize={props.colorize}
          />
        );
      } else {
        return (
          <Colorized code={p.children.toString()} colorize={props.colorize} />
        );
      }
    },
    a: (props) => {
      if (props.href.startsWith("https")) {
        return <a className="doc-link" {...props} target="_blank" />;
      } else {
        return (
          <span
            className="doc-link"
            onClick={() => {
              if (kTopics.has(props.href)) {
                setDoc(props.href);
              }
            }}
          >
            {props.children}
          </span>
        );
      }
    },
  };

  return (
    <div style={props.style}>
      <div
        style={{
          display: "grid",
          gap: "0.5em",
          gridTemplateColumns: "auto auto 1fr auto",
          alignItems: "center",
          padding: "0.2em",
        }}
      >
        Topics:
        <select value={doc} onChange={(e) => setDoc(e.target.value)}>
          {Array.from(kTopics.keys())
            .sort()
            .map((el) => (
              <option value={el} key={el}>
                {kTopics.get(el).title}
              </option>
            ))}
        </select>
        <div />
        <IconButton
          size="1.3em"
          title="Close"
          style={{ fontWeight: "bold", padding: 0, justifyContent: "center" }}
          onClick={() => props.onClose()}
        >
          ×
        </IconButton>
      </div>
      <div
        className="doc"
        style={{ maxHeight: "calc(95vh - 1.3em)", overflowY: "auto" }}
      >
        <Markdown
          children={kTopics.get(doc).body}
          components={markdownComponents}
        />
      </div>
    </div>
  );
};

const Colorized: React.FC<{
  code: string;
  colorize: (frag: string) => Promise<string>;
}> = (props) => {
  const [html, setHtml] = React.useState<string>(null);

  React.useEffect(() => {
    props.colorize(props.code).then((h) => {
      if (h.endsWith("<br/>")) {
        setHtml(h.substring(0, h.length - 5));
      } else {
        setHtml(h);
      }
    });
  }, [props.code]);

  return html ? (
    <code dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <code>{props.code}</code>
  );
};
