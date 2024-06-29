import React from "react";
import { ThemeContext } from "../theme-provider";
import { IconProps } from "./IconProps";

export const Switch: React.FunctionComponent<IconProps> = (props) => {
  const theme = React.useContext(ThemeContext);
  return (
    <svg width={props.width} height={props.height} viewBox="0 0 64 64">
      <g fillRule="evenodd" fill="currentColor">
        <path d="M 30 29 v -20 h 34 v 20 h -30 v -4 h 26 v -12 h -26 v 16" />
        <path d="M 0 52 v -20 h 34 v 20 h -30 v -4 h 26 v -12 h -26 v 16" />
        <path d="M 36,42 l 6,-6 v 4 c 7,0 10,-3 10,-10 c 0,10 -8,14 -10,14 v 4" />
        <path
          d="M 36,42 l 6,-6 v 4 c 7,0 10,-3 10,-10 c 0,10 -8,14 -10,14 v 4"
          transform="rotate(180 31 31)"
        />
        <g fill={theme.violet}>
          <rect x="38" y="17" width="18" height="4" />
          <rect x="8" y="40" width="18" height="4" />
        </g>
      </g>
    </svg>
  );
};
