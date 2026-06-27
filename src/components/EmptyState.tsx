interface EmptyStateProps {
  message?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 border-2 border-gray-200 dark:border-gray-700 rounded-full flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <p className="text-gray-500 dark:text-gray-400 mb-3">{message ?? 'Noch keine Daten vorhanden.'}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="text-sm font-medium underline underline-offset-2 hover:opacity-80"
          style={{ color: '#4A6FA5' }}
        >
          {action.label} →
        </button>
      )}
    </div>
  );
}
