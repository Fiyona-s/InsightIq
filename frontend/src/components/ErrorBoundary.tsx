import { Component, type ErrorInfo, type ReactNode } from "react";

/** Catches a crash inside one page so the rest of the app (rail, Menu, other pages) keeps working. Plain words and one button. */
export default class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Page error", error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="error-boundary" role="alert">
        <h2>This page ran into a problem</h2>
        <p>Your data and saved work are not affected. Try again, or open another page from the left.</p>
        <button type="button" className="button button-default" onClick={() => this.setState({ failed: false })}>Try again</button>
      </section>
    );
  }
}
