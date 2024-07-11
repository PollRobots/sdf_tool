import React from "react";
import { ThemeContext } from "../theme-provider";
import { IconProps } from "./IconProps";

export const Edit: React.FunctionComponent<IconProps> = (props) => {
  const theme = React.useContext(ThemeContext);
  return (
    <svg viewBox="0 0 32 32" width={props.width} height={props.height}>
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="m 25.817,17.183 v 11 H 3.817 V 6.183 H 14.817 v 2 H 5.817 V 26.183 H 23.817 v -9 z"
      />
      <circle
        fill="currentColor"
        cx="14.401"
        cy="22.628"
        r="2"
        transform="rotate(-45)"
      />
      <path
        fill="currentCulor"
        d="m 10.081,18.919 c 0,0 -0.398,1 -1,2.5 -0.602,1.5 0,2.111 1.5,1.5 1.5,-0.611 2.5,-1 2.5,-1 l 7.443,-7.443 -3,-3 z
           m 11.685,-11.685 3,2.9996799 1.414,-1.414 -0.003,-0.003 C 25.384,8.815 24.624,8.5 24.062,7.938 23.5,7.377 23.185,6.616 23.184,5.822 l -0.003,-0.003 z"
      />
      <path fill={theme.violet} d="m 18.231,10.769 3,3 2.828,-2.828 -3,-3 z" />
    </svg>
  );
};
