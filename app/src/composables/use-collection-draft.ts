import { useUserStore } from '@/stores/user';

/** Serializable snapshot of the in-progress new-collection wizard (DR-UC02). */
export interface CollectionDraft {
	collectionName: string | null;
	singleton: boolean;
	primaryKeyFieldName: string;
	primaryKeyFieldType: 'auto_int' | 'auto_big_int' | 'uuid' | 'manual';
	/** Per system-field: only the user-editable bits (enabled toggle + column name). */
	systemFields: Record<string, { enabled: boolean; name: string }>;
}

const STORAGE_PREFIX = 'directus-new-collection-draft';

/**
 * localStorage-backed draft persistence for the new-collection wizard, keyed by user id so two
 * accounts on the same browser don't clobber each other. All access is best-effort: localStorage
 * can be unavailable (private mode, quota) and a corrupt entry should never break the wizard.
 */
export function useCollectionDraft() {
	const userStore = useUserStore();

	function storageKey(): string {
		const user = userStore.currentUser;
		const userId = user && 'id' in user ? user.id : 'anonymous';
		return `${STORAGE_PREFIX}:${userId}`;
	}

	function load(): CollectionDraft | null {
		try {
			const raw = localStorage.getItem(storageKey());
			if (!raw) return null;
			return JSON.parse(raw) as CollectionDraft;
		} catch {
			return null;
		}
	}

	function save(draft: CollectionDraft): void {
		try {
			localStorage.setItem(storageKey(), JSON.stringify(draft));
		} catch {
			// Drafting is best-effort; ignore storage failures.
		}
	}

	function clear(): void {
		try {
			localStorage.removeItem(storageKey());
		} catch {
			// no-op
		}
	}

	return { load, save, clear };
}
