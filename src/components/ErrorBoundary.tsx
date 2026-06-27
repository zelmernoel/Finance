import React from 'react';
import { ACCENT } from '../utils';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  fullPage?: boolean;
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
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    if (this.props.fullPage) {
      return (
        <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto mb-5">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Etwas ist schiefgelaufen
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Die App konnte nicht geladen werden.
            </p>
            {this.state.error && (
              <p className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 rounded px-3 py-2 mb-5 font-mono break-all">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-semibold text-white rounded"
              style={{ backgroundColor: ACCENT }}
            >
              Seite neu laden
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center text-gray-500 dark:text-gray-400">
        <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">
          Dieser Bereich konnte nicht geladen werden.
        </p>
        <p className="text-sm">{this.state.error?.message}</p>
      </div>
    );
  }
}
