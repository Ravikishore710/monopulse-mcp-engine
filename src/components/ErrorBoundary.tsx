import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected UI rendering error'
    };
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="border border-[#DC2626] bg-[#111827] p-6 rounded-lg space-y-3 text-xs font-mono"
        >
          <div className="text-[#DC2626] font-semibold">
            {this.props.fallbackTitle || 'Workbench Panel Isolation Boundary Triggered'}
          </div>
          <p className="text-[#9CA3AF]">{this.state.errorMessage}</p>
          <button
            onClick={this.handleReset}
            className="px-3.5 py-1.5 bg-[#2563EB] text-white rounded-md hover:bg-blue-500 transition-colors cursor-pointer"
          >
            Recover Panel View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
