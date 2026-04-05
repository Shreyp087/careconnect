import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('CareConnect UI error:', error);
  }

  handleRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-900">Something went wrong</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The page hit an unexpected problem. Refresh and we&apos;ll try to get you back on
            track.
          </p>
          <button
            type="button"
            onClick={this.handleRefresh}
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-sky-600"
          >
            Refresh
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
