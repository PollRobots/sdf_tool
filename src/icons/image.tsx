import React from "react";
import { ThemeContext } from "../theme-provider";
import { IconProps } from "./IconProps";

export const Image: React.FunctionComponent<IconProps> = (props) => {
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
        d="M 7,8 h 18 v 16 h -18 Z M 9,10 h 14 v 12 h-14 Z"
      />
      <path fill={theme.violet} d="M 9,22 l 6,-6 3,3 2,-2 3,5 Z" />
      <ellipse fill="currentColor" cx={19} cy={14} rx={2} ry={2} />
    </svg>
  );
};
