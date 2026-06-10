import React from "react";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("PayWatch UI crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page-grid">
          <div className="panel">
            <div className="error-banner">
              <strong>Dashboard failed to render</strong>
              <p>{this.state.error?.message || "Unknown frontend error"}</p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
