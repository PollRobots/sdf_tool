import React from "react";
import { ThemeContext } from "../theme-provider";
import { IconProps } from "./IconProps";

export const Unknown: React.FunctionComponent<IconProps> = (props) => {
  const theme = React.useContext(ThemeContext);
  return (
    <svg
      width={props.width}
      height={props.height}
      viewBox="0 0 32 32"
      style={props.style}
    >
      <g stroke={theme.violet} strokeWidth="2">
        <line x1={11} x2={16} y1={13} y2={13} />
        <line x1={11} x2={19} y1={17} y2={17} />
        <line x1={11} x2={19} y1={21} y2={21} />
      </g>
    </svg>
  );
};
