import React from "react";

interface ErrorBoundaryProps {
  style: React.CSSProperties;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorDetails: any;
}

export class ErrorBoundary extends React.Component<
  React.PropsWithChildren<ErrorBoundaryProps>,
  ErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren<ErrorBoundaryProps>) {
    super(props);
    this.state = { hasError: false, errorDetails: {} };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, errorDetails: error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("Caught:", error);
    if (errorInfo.componentStack) {
      console.error("  Stack:", errorInfo.componentStack);
    }
    if (errorInfo.digest) {
      console.error("  Digest:", errorInfo.digest);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={this.props.style}>
          <h2>Error</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {this.state.errorDetails.toString()}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}
