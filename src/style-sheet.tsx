import { Theme } from "./monaco/theme";

export const updateStyleSheet = (theme: Theme) => {
  const styles: string[] = [];
  styles.push(`
    body {
        background-color: ${theme.background};
        color: ${theme.foreground};
    }
    `);
  styles.push(`
        select {
            background-color: ${theme.background};
            color: ${theme.foreground};
            border-color: ${theme.base00};
        }
        `);
  styles.push(`
    button {
        background-color: ${theme.background};
        color: ${theme.foreground};
        border: 1px solid ${theme.base00};
        cursor: pointer;
        padding: 4px 1em 4px 1em;
        border-radius: 0.25em;
    }
    button:active {
        background-color: ${theme.boldBackground};
    }
    button:active:hover {
        padding: 5px 1em 3px 1em;
        box-shadow: 0 1px 2px inset ${theme.foreground};
    }
    button:disabled {
        cursor: default;
        background-color: ${theme.background};
        opacity: 0.7;
    }
`);
  const thumbHeight = "1.5rem";
  const thumbWidth = "0.75rem";
  const trackSize = "0.375rem";
  styles.push(`
    input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        cursor: pointer;
        height: ${thumbHeight};
    }
    input.vertical[type="range"] {
        width: ${thumbHeight};
    }
    input[type="range"]:focus {
        outline: none;
    }
    input[type="range"]::-webkit-slider-runnable-track {
        background: ${theme.base00};
        height: ${trackSize};
        border-radius: calc(${trackSize} / 2);
    }
    input.vertical[type="range"]::-webkit-slider-runnable-track {
        height: unset;
        width: ${trackSize};
    }
    input[type="range"]::-moz-range-track {
        background: ${theme.base00};
        height: ${trackSize};
        border-radius: calc(${trackSize} / 2);
    }
    input.vertical[type="range"]::-moz-range-track {
        height: unset;
        width: ${trackSize};
    }
    input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        background: radial-gradient(closest-side, ${theme.blue} 50%,${theme.base00});
        margin-top: calc((${trackSize} - ${thumbHeight})/2);
        width: ${thumbWidth};
        height: ${thumbHeight};
        clip-path: polygon(-50% 50%, 50% 100%, 150% 50%, 50% 0);
    }
    input.vertical[type="range"]::-webkit-slider-thumb {
        width: ${thumbHeight};
        height: ${thumbWidth};
        clip-path: polygon(0 50%, 50% 150%, 100% 50%, 50% -50%);
        margin-right: calc((${trackSize} - ${thumbHeight})/2);
    }
    input[type="range"]:focus::-webkit-slider-thumb {
        outline: 2px solid ${theme.boldForeground};
        outline-offset: 0.125rem;
        background: ${theme.blue};
        border-radius: calc(min(${thumbWidth}, ${thumbHeight}) / 2);
        clip-path: unset;
    }
`);
  styles.push(`
    input[type="text"] {
        background-color: ${theme.boldBackground};
        color: ${theme.foreground};
        padding: 0.25em 0.5em;
        border: 2px solid ${theme.base00};
        border-radius: 4px;
    }
`);
  new CSSStyleSheet()
    .replace(styles.join("\n"))
    .then((sheet) => {
      document.adoptedStyleSheets = [sheet];
    })
    .catch((err) => {
      console.error(`Error replacing stylesheet: ${err}`);
    });
};
