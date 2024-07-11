import React from "react";
import { ThemeContext } from "../theme-provider";
import { IconProps } from "./IconProps";

export const Pause: React.FunctionComponent<IconProps> = (props) => {
  return (
    <svg width={props.width} height={props.height} viewBox="0 0 32 32">
      <path
        fill="currentColor"
        d="M 4,4 h 8 v 24 h -8 Z M 18,4 h 8 v 24 h -8 Z"
      />
    </svg>
  );
};

export const Play: React.FunctionComponent<IconProps> = (props) => {
  return (
    <svg width={props.width} height={props.height} viewBox="0 0 32 32">
      <path fill="currentColor" d="M 6,4 l 19,11 -19 11 Z" />
    </svg>
  );
};

export const Rewind: React.FunctionComponent<IconProps> = (props) => {
  return (
    <svg width={props.width} height={props.height} viewBox="0 0 32 32">
      <path
        fill="currentColor"
        d="M 2,4 h 6 v 24 h -6 Z
         M 8,16 l 12,-12 v 24 Z
         M 20,16 l 12,-12 v 24 Z"
      />
    </svg>
  );
};

export const Spin: React.FunctionComponent<IconProps> = (props) => {
  const theme = React.useContext(ThemeContext);
  return (
    <svg
      style={props.style}
      width={props.width}
      height={props.height}
      viewBox="0 0 32 32"
    >
      <g>
        <path
          fill="currentColor"
          d="M 11,4 H 4 L 6.0644531,6.1367188 C 3.4610153,8.7592233 2.0000079,12.304676 2,16 c 0,7.731986 6.2680135,14 14,14 1.22065,-1.9e-4 2.428267,-0.179221 3.601562,-0.492188 l -1.02539,-3.847656 C 17.73583,25.884793 16.869877,25.999461 16,26 10.477153,26 6,21.522847 6,16 6.0003537,13.365196 7.0405517,10.836996 8.8945312,8.9648438 L 11,11 Z"
          id="path1083"
        />
        <path
          fill={theme.violet}
          d="m 16,2 c -1.22102,1.021e-4 -2.428053,0.179175 -3.601562,0.4921875 L 13.425781,6.34375 C 14.259345,6.12094 15.117447,6.0023078 15.980469,6 H 16 c 5.522847,0 10,4.477153 10,10 -4.01e-4,2.652011 -1.05423,5.195258 -2.929688,7.070312 L 21,21 v 7 h 7 L 25.900391,25.900391 C 28.525791,23.274515 30.000475,19.713213 30,16 30,8.2680135 23.731986,2 16,2 Z"
        />
      </g>
    </svg>
  );
};
