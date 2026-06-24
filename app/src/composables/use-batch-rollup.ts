import { computed, ref } from 'vue';

/** Per-item lifecycle state for a bulk action (DR-UC06). */
export type BatchItemState = 'pending' | 'saving' | 'saved' | 'error';

/**
 * Tracks the per-item outcome of a bulk action keyed by primary key, plus aggregated tallies for
 * the rollup header. The state map is replaced (not mutated in place) on each update so Vue picks
 * up the change reactively.
 */
export function useBatchRollup() {
	const states = ref<Map<string | number, BatchItemState>>(new Map());

	/** Seed every key as pending (called when the drawer opens or before a re-run). */
	function init(keys: (string | number)[]) {
		const next = new Map<string | number, BatchItemState>();
		for (const key of keys) next.set(key, 'pending');
		states.value = next;
	}

	function set(key: string | number, state: BatchItemState) {
		const next = new Map(states.value);
		next.set(key, state);
		states.value = next;
	}

	function get(key: string | number): BatchItemState {
		return states.value.get(key) ?? 'pending';
	}

	function reset() {
		states.value = new Map();
	}

	const total = computed(() => states.value.size);
	const savedCount = computed(() => [...states.value.values()].filter((s) => s === 'saved').length);
	const errorCount = computed(() => [...states.value.values()].filter((s) => s === 'error').length);
	const inFlight = computed(() => [...states.value.values()].some((s) => s === 'saving'));
	const settled = computed(
		() => total.value > 0 && [...states.value.values()].every((s) => s === 'saved' || s === 'error'),
	);
	const errorKeys = computed(() =>
		[...states.value.entries()].filter(([, s]) => s === 'error').map(([key]) => key),
	);

	return { states, init, set, get, reset, total, savedCount, errorCount, inFlight, settled, errorKeys };
}
