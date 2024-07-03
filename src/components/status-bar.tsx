import React from "react";
import { IStatusBar, ModeChangeEvent, StatusBarInputOptions } from "vim-monaco";
import { ThemeContext } from "./theme-provider";

interface StatusBarProps {
  filename: string;
  onMount: (statusBar: IStatusBar) => void;
  focusEditor: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = (props) => {
  const theme = React.useContext(ThemeContext);
  const [visible, setVisibility] = React.useState(false);
  const [modeText, setModeText] = React.useState("");
  const [notification, setNotification] = React.useState("");
  const [keyInfo, setKeyInfo] = React.useState("");
  const [secondary, setSecondary] =
    React.useState<StatusBarSecondaryProps>(null);

  const toggleVisibility = (visible: boolean) => setVisibility(visible);
  const showNotification = (message: string) => setNotification(message);
  const setMode = (ev: ModeChangeEvent) => {
    switch (ev.mode) {
      case "visual":
        switch (ev.subMode) {
          case "linewise":
            setModeText("--VISUAL LINE--");
            break;
          case "blockwise":
            setModeText("--VISUAL BLOCK--");
            break;
          default:
            setModeText("--VISUAL--");
        }
        break;
      case "normal":
        setModeText("");
        break;
      default:
        setModeText(`--${ev.mode.toUpperCase()}--`);
    }
  };
  const setKeyBuffer = (key: string) => {
    setKeyInfo(key);
  };
  const setSecStatic = (message: string) => {
    setSecondary({
      mode: "static",
      staticMessage: message,
      prefix: "",
      desc: "",
      options: {},
      close: closeInput,
    });
    return closeInput;
  };
  const setSecPrompt = (
    prefix: string,
    desc: string,
    options: StatusBarInputOptions
  ) => {
    setSecondary({
      mode: "input",
      staticMessage: "",
      prefix: prefix,
      desc: desc,
      options: options,
      close: closeInput,
    });
    return closeInput;
  };
  const closeInput = () => {
    setSecondary(null);
    props.focusEditor();
  };
  const clear = () => {};

  React.useEffect(() => {
    props.onMount({
      toggleVisibility: toggleVisibility,
      showNotification: showNotification,
      setMode: setMode,
      setKeyBuffer: setKeyBuffer,
      startDisplay: setSecStatic,
      startPrompt: setSecPrompt,
      closeInput: closeInput,
      clear: clear,
    });
  }, []);

  React.useEffect(() => {
    if (notification !== "") {
      setTimeout(() => setNotification(""), 50000);
    }
  }, [notification]);

  const haveMultilineNotification = notification.includes("\n");
  const notificationLines = haveMultilineNotification
    ? notification.split("\n").length
    : 0;

  const notificationStyle: React.CSSProperties = haveMultilineNotification
    ? {
        whiteSpace: "pre-line",
        position: "relative",
        bottom: "1.25em",
        marginTop: `-${notificationLines * 1.25}em`,
        boxShadow: `0 0.25em 0.5em ${theme.base00}`,
        background: theme.boldBackground,
        zIndex: 100,
      }
    : {};

  return (
    <div
      style={{
        display: visible ? "grid" : "none",
        fontFamily: '"Fira Code Variable",  monospace',
        borderTop: "1px solid #888",
        padding: "0.1em",
        gap: "1em",
        minHeight: "1.25em",
        gridTemplateColumns: "auto auto 1fr auto auto",
      }}
    >
      <div>[{props.filename || "No Name"}]</div>
      <div>{modeText}</div>
      {secondary ? <StatusBarSecondary {...secondary} /> : <div />}
      <div style={notificationStyle}>{notification}</div>
      <div>{keyInfo}</div>
    </div>
  );
};

interface StatusBarSecondaryProps {
  mode: "static" | "input";
  staticMessage: string;
  prefix: string;
  desc: string;
  options: StatusBarInputOptions;
  close: () => void;
}

const StatusBarSecondary: React.FC<StatusBarSecondaryProps> = (props) => {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (inputRef.current) {
      if (props.options.selectValueOnOpen) {
        inputRef.current.select();
      }
      inputRef.current.focus();
    }
  }, [inputRef.current]);

  return props.mode == "static" ? (
    <div>{props.staticMessage}</div>
  ) : (
    <div
      style={{
        display: "grid",
        gap: "0.5em",
        fontFamily: '"Fira Code Variable",  monospace',
        gridTemplateColumns: "auto 1fr auto",
      }}
    >
      <div>{props.prefix}</div>
      <input
        style={{
          border: "none",
          background: "none",
          outline: "none",
          marginLeft: "-0.5em",
          paddingLeft: 0,
          fontFamily: '"Fira Code Variable", monospace',
        }}
        ref={inputRef}
        type="text"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        onKeyUp={(evt) => {
          if (props.options.onKeyUp) {
            props.options.onKeyUp(
              evt.nativeEvent,
              inputRef.current.value,
              props.close
            );
          }
        }}
        onBlur={() => {
          if (props.options.closeOnBlur) {
            props.close();
          }
        }}
        onKeyDown={(evt) => {
          if (props.options.onKeyDown) {
            if (
              props.options.onKeyDown(
                evt.nativeEvent,
                inputRef.current.value,
                props.close
              )
            ) {
              return;
            }
          }

          if (
            evt.key === "Escape" ||
            (props.options.closeOnEnter !== false && evt.key === "Enter")
          ) {
            inputRef.current.blur();
            evt.stopPropagation();
            props.close();
          }

          if (evt.key === "Enter" && props.options.onClose) {
            evt.stopPropagation();
            evt.preventDefault();
            props.options.onClose(inputRef.current.value);
          }
        }}
      />
      <div style={{ color: "#888" }}>{props.desc}</div>
    </div>
  );
};
