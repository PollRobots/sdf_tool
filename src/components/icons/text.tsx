import React from "react";
import { ThemeContext } from "../theme-provider";
import { IconProps } from "./IconProps";

export const Text: React.FunctionComponent<IconProps> = (props) => {
  const theme = React.useContext(ThemeContext);
  return (
    <svg
      width={props.width}
      height={props.height}
      viewBox="0 0 32 32"
      style={props.style}
    >
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M 8,7 h 12 l 4,4 v 14 h -16 v -18Z M 10,9 h 9 v 3 h 3 v 11 h -12 v -14 Z"
      />
      <g stroke={theme.violet} strokeWidth="2">
        <line x1={11} x2={16} y1={13} y2={13} />
        <line x1={11} x2={19} y1={17} y2={17} />
        <line x1={11} x2={19} y1={21} y2={21} />
      </g>
    </svg>
  );
};
