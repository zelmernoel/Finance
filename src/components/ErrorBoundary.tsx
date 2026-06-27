import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="border border-gray-200 rounded-lg p-6 text-center text-gray-500">
            <p className="font-medium text-gray-700 mb-1">Dieser Bereich konnte nicht geladen werden.</p>
            <p className="text-sm">{this.state.error?.message}</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
