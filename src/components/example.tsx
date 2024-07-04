import React from "react";
import { IconButton } from "./icon-button";
import { Image } from "./icons/image";

interface ExampleProps {
  code: string;
  onAddToEditor: (code: string) => void;
}

export const Example: React.FC<ExampleProps> = (props) => {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gridTemplateRows: "2em 1fr 1fe",
        columnGap: "0.5em",
        height: "fit-content",
      }}
    >
      <code style={{ gridArea: "1/1/3/4" }}>{props.code}</code>
      <IconButton
        style={{
          gridArea: "1/2/2/3",
          fontWeight: "bold",
          padding: 0,
          justifyContent: "center",
        }}
        size="2em"
        title="Add to editor"
        onClick={() => props.onAddToEditor(props.code)}
      >
        +
      </IconButton>
      <IconButton style={{ gridArea: "1/3/2/4" }} size="2em" title="Render">
        <Image />
      </IconButton>
    </div>
  );
};
