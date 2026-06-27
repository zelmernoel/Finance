import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { createLocalStorageAdapter } from '../lib/localStorageAdapter';
import { createSupabaseAdapter } from '../lib/supabaseAdapter';
import type { StorageAdapter } from '../lib/storage';

/**
 * Returns a StorageAdapter scoped to the given budgetId.
 * - If a user is logged in → SupabaseAdapter
 * - Otherwise → LocalStorageAdapter (guest mode)
 */
export function useStorage(budgetId: string | null): StorageAdapter | null {
  const { user } = useAuth();

  return useMemo(() => {
    if (!budgetId) return null;
    return user
      ? createSupabaseAdapter(user.id, budgetId)
      : createLocalStorageAdapter(budgetId);
  }, [user, budgetId]);
}
