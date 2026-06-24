import type { Filter } from '@directus/types';
import { isEqual } from 'lodash';
import { nextTick, watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/** The list state projected to/from the URL query string (DR-UC09). */
export interface UrlListState {
	filter: Filter | null;
	sort: string[] | null;
	page: number | null;
}

const STATE_KEYS = ['filter', 'sort', 'page'] as const;

/** Decode filter/sort/page from a route query. Unparseable values fall back to null. */
export function decodeUrlState(query: Record<string, any>): UrlListState {
	let filter: Filter | null = null;

	if (typeof query.filter === 'string' && query.filter) {
		try {
			filter = JSON.parse(query.filter);
		} catch {
			filter = null;
		}
	}

	const sort = typeof query.sort === 'string' && query.sort ? query.sort.split(',') : null;
	const page = query.page ? Number(query.page) || null : null;

	return { filter, sort, page };
}

/** Encode filter/sort/page onto a copy of `baseQuery`, preserving unrelated keys (e.g. bookmark). */
export function encodeUrlState(state: UrlListState, baseQuery: Record<string, any>): Record<string, any> {
	const query: Record<string, any> = { ...baseQuery };

	for (const key of STATE_KEYS) delete query[key];

	if (state.filter && Object.keys(state.filter).length > 0) query.filter = JSON.stringify(state.filter);
	if (state.sort && state.sort.length > 0) query.sort = state.sort.join(',');
	if (state.page && state.page > 1) query.page = String(state.page);

	return query;
}

/**
 * Two-way sync between the items-list preset state (filter + layoutQuery.sort/page) and the URL
 * query string. URL params win on initial load; state changes push to the URL (enabling
 * back/forward and copy-paste); browser navigation applies the URL back to state.
 *
 * A `syncing` guard plus value-equality checks prevent the state<->URL watchers from looping or
 * triggering a redundant second fetch.
 */
export function useUrlState(filter: Ref<Filter | null>, layoutQuery: Ref<Record<string, any>>) {
	const route = useRoute();
	const router = useRouter();

	let syncing = false;

	function currentState(): UrlListState {
		return {
			filter: filter.value,
			sort: layoutQuery.value?.sort ?? null,
			page: layoutQuery.value?.page ?? null,
		};
	}

	function applyState(state: UrlListState) {
		if (!isEqual(filter.value ?? null, state.filter ?? null)) {
			filter.value = state.filter;
		}

		const lq = layoutQuery.value ?? {};
		const nextSort = state.sort ?? lq.sort ?? null;
		const nextPage = state.page ?? 1;

		if (!isEqual(lq.sort ?? null, nextSort) || (lq.page ?? 1) !== nextPage) {
			layoutQuery.value = { ...lq, sort: nextSort ?? undefined, page: nextPage };
		}
	}

	// Initial load: URL params override preset defaults.
	const initial = decodeUrlState(route.query);
	if (initial.filter || initial.sort || initial.page) {
		applyState(initial);
	}

	// state -> URL (push so back/forward and copy-paste work)
	watch(
		[filter, () => layoutQuery.value?.sort, () => layoutQuery.value?.page],
		() => {
			if (syncing) return;

			const query = encodeUrlState(currentState(), route.query);
			if (isEqual(query, route.query)) return;

			syncing = true;
			router.push({ query }).finally(() => {
				syncing = false;
			});
		},
		{ deep: true },
	);

	// URL -> state (browser back/forward, external navigation)
	watch(
		() => route.query,
		(query) => {
			if (syncing) return;

			syncing = true;
			applyState(decodeUrlState(query));
			nextTick(() => {
				syncing = false;
			});
		},
		{ deep: true },
	);
}
