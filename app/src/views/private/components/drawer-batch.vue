<script setup lang="ts">
import { useCollection } from '@directus/composables';
import { getEndpoint } from '@directus/utils';
import { isObject, omit } from 'lodash';
import PQueue from 'p-queue';
import { computed, ref, toRefs, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import PrivateViewHeaderBarActionButton from '../private-view/components/private-view-header-bar-action-button.vue';
import DrawerBatchItem from './drawer-batch-item.vue';
import api from '@/api';
import VDrawer from '@/components/v-drawer.vue';
import VForm from '@/components/v-form/v-form.vue';
import { useBatchRollup } from '@/composables/use-batch-rollup';
import { VALIDATION_TYPES } from '@/constants';
import { useFieldsStore } from '@/stores/fields';
import { useRelationsStore } from '@/stores/relations';
import { APIError } from '@/types/error';
import { fetchAll } from '@/utils/fetch-all';
import { notify } from '@/utils/notify';
import { unexpectedError } from '@/utils/unexpected-error';

// Cap concurrent per-item PATCHes so a large selection doesn't flood the API (DR-UC06).
const BATCH_CONCURRENCY = 5;

type TranslationsFieldInfo = {
	field: string;
	creates: Record<string, any>[];
	junctionField: string;
	relatedPkField: string;
};

const props = defineProps<{
	collection: string;
	primaryKeys: (number | string)[];
	active?: boolean;
	edits?: Record<string, any>;
	stageOnSave?: boolean;
}>();

const emit = defineEmits<{
	(e: 'update:active', value: boolean): void;
	(e: 'refresh'): void;
	(e: 'input', value: Record<string, any>): void;
}>();

const { t } = useI18n();

const { collection } = toRefs(props);
const { primaryKeyField } = useCollection(collection);

const { internalEdits } = useEdits();
const { internalActive } = useActiveState();
const rollup = useBatchRollup();
const { getTranslationsFields, saveBatchWithTranslations } = useTranslationsFields();
const { save, cancel, saving, validationErrors, retryItem } = useActions();

// Seed the per-item rollup as pending when the drawer opens; clear it when it closes.
watch(
	internalActive,
	(active) => {
		if (active) rollup.init(props.primaryKeys);
		else rollup.reset();
	},
	{ immediate: true },
);

// Template-facing helpers (nested refs/getters don't auto-unwrap in the template).
const rollupHeader = computed(() => t('batch_rollup_header', { count: rollup.savedCount.value, total: rollup.total.value }));
const itemState = (pk: number | string) => rollup.get(pk);

function useEdits() {
	const localEdits = ref<Record<string, any>>({});

	const internalEdits = computed<Record<string, any>>({
		get() {
			if (props.edits !== undefined) {
				return {
					...props.edits,
					...localEdits.value,
				};
			}

			return localEdits.value;
		},
		set(newEdits) {
			localEdits.value = newEdits;
		},
	});

	return { internalEdits };
}

function useActiveState() {
	const localActive = ref(false);

	const internalActive = computed({
		get() {
			return props.active === undefined ? localActive.value : props.active;
		},
		set(newActive: boolean) {
			localActive.value = newActive;
			emit('update:active', newActive);
		},
	});

	return { internalActive };
}

function useActions() {
	const saving = ref(false);
	const validationErrors = ref<any[]>([]);

	return { save, cancel, saving, validationErrors, retryItem };

	async function save() {
		if (props.stageOnSave) {
			emit('input', internalEdits.value);
			internalActive.value = false;
			internalEdits.value = {};
			return;
		}

		const translationsFields = getTranslationsFields(internalEdits.value);

		// Translations batch edit keeps the existing single-request payload-merge path; the per-item
		// rollup applies to plain field edits (DR-UC06).
		if (translationsFields.length > 0) {
			saving.value = true;

			try {
				await saveBatchWithTranslations(translationsFields);
				emit('refresh');
				internalActive.value = false;
				internalEdits.value = {};
			} catch (error: any) {
				handleSaveError(error);
			} finally {
				saving.value = false;
			}

			return;
		}

		validationErrors.value = [];
		rollup.init(props.primaryKeys);
		saving.value = true;

		// Dispatch N concurrent per-item PATCHes (concurrency-capped); collect per-item outcomes.
		const queue = new PQueue({ concurrency: BATCH_CONCURRENCY });
		await Promise.all(props.primaryKeys.map((pk) => queue.add(() => saveItem(pk))));

		saving.value = false;
		emit('refresh');
		reportOutcome();

		// Close only when every item succeeded; otherwise stay open so failed rows can be retried.
		if (rollup.errorCount.value === 0) {
			internalActive.value = false;
			internalEdits.value = {};
		}
	}

	async function saveItem(pk: number | string) {
		rollup.set(pk, 'saving');

		try {
			await api.patch(`${getEndpoint(collection.value)}/${encodeURIComponent(String(pk))}`, internalEdits.value);
			rollup.set(pk, 'saved');
		} catch (error: any) {
			rollup.set(pk, 'error');
			collectValidationErrors(error);
		}
	}

	async function retryItem(pk: number | string) {
		saving.value = true;
		await saveItem(pk);
		saving.value = false;
		emit('refresh');
		reportOutcome();

		if (rollup.errorCount.value === 0) {
			internalActive.value = false;
			internalEdits.value = {};
		}
	}

	function reportOutcome() {
		const total = rollup.total.value;
		const saved = rollup.savedCount.value;

		if (saved === total) {
			notify({ title: t('batch_rollup_all_success', { total }) });
		} else if (saved === 0) {
			notify({ title: t('batch_rollup_all_error'), type: 'error' });
		} else {
			notify({ title: t('batch_rollup_partial', { count: saved, total }), type: 'warning' });
		}
	}

	function collectValidationErrors(error: any) {
		const errors = error?.response?.data?.errors;
		if (!errors) return;

		const seen = new Set(validationErrors.value.map((e: any) => e?.field));

		for (const err of errors as APIError[]) {
			if (!VALIDATION_TYPES.includes(err?.extensions?.code)) continue;
			const field = (err.extensions as any)?.field;
			if (seen.has(field)) continue;
			seen.add(field);
			validationErrors.value = [...validationErrors.value, err.extensions];
		}
	}

	function handleSaveError(error: any) {
		const errors = error?.response?.data?.errors;

		if (!errors) {
			unexpectedError(error);
			return;
		}

		validationErrors.value = errors
			.filter((err: APIError) => VALIDATION_TYPES.includes(err?.extensions?.code))
			.map((err: APIError) => err.extensions);

		const otherErrors = errors.filter((err: APIError) => VALIDATION_TYPES.includes(err?.extensions?.code) === false);

		if (otherErrors.length > 0) {
			otherErrors.forEach(unexpectedError);
		}
	}

	function cancel() {
		internalActive.value = false;
		internalEdits.value = {};
	}
}

function useTranslationsFields() {
	const fieldsStore = useFieldsStore();
	const relationsStore = useRelationsStore();

	return { getTranslationsFields, saveBatchWithTranslations };

	function getTranslationsFields(edits: Record<string, any>): TranslationsFieldInfo[] {
		const results: TranslationsFieldInfo[] = [];

		for (const [key, value] of Object.entries(edits)) {
			// Batch mode form (primary-key="+") only produces `create` operations for relational fields.
			if (!isObject(value) || !('create' in value)) continue;

			const fieldInfo = fieldsStore.getField(collection.value, key);
			if (!fieldInfo?.meta?.special?.includes('translations')) continue;

			const relations = relationsStore.getRelationsForField(collection.value, key);
			const junctionRelation = relations.find((r) => r.meta?.one_field === key);
			const junctionField = junctionRelation?.meta?.junction_field;

			if (!junctionField) continue;

			const relatedCollection = relations.find((r) => r.field === junctionField)?.related_collection;

			const relatedPkField = relatedCollection
				? fieldsStore.getPrimaryKeyFieldForCollection(relatedCollection)?.field
				: null;

			if (!relatedPkField) continue;

			results.push({
				field: key,
				creates: (value as any).create as Record<string, any>[],
				junctionField,
				relatedPkField,
			});
		}

		return results;
	}

	async function saveBatchWithTranslations(translationsFields: TranslationsFieldInfo[]) {
		const otherEdits = omit(
			internalEdits.value,
			translationsFields.map((t) => t.field),
		);

		if (!primaryKeyField.value) {
			throw new Error(`No primary key field found for collection ${collection.value}`);
		}

		const pkField = primaryKeyField.value.field;
		const endpoint = getEndpoint(collection.value);

		const existingItems = await fetchAll<Record<string, any>>(endpoint, {
			params: {
				filter: { [pkField]: { _in: props.primaryKeys } },
				fields: [pkField, ...translationsFields.map((t) => `${t.field}.*`)],
			},
		});

		const itemMap = new Map(existingItems.map((item) => [item[pkField], item]));
		const resolveId = (val: unknown, field: string) => (isObject(val) ? (val as Record<string, any>)[field] : val);

		const payload = props.primaryKeys
			.filter((pk) => itemMap.has(pk))
			.map((pk) => {
				const item: Record<string, any> = { [pkField]: pk, ...otherEdits };

				for (const { field, creates, junctionField, relatedPkField } of translationsFields) {
					const merged = new Map(
						(itemMap.get(pk)![field] || []).map((row: Record<string, any>) => [
							resolveId(row[junctionField], relatedPkField),
							row,
						]),
					);

					for (const create of creates) {
						const id = resolveId(create[junctionField], relatedPkField);
						merged.set(id, { ...(merged.get(id) ?? {}), ...create });
					}

					item[field] = [...merged.values()];
				}

				return item;
			});

		await api.patch(endpoint, payload);
	}
}
</script>

<template>
	<VDrawer
		v-model="internalActive"
		:title="$t('editing_in_batch', { count: primaryKeys.length })"
		persistent
		@cancel="cancel"
		@apply="save"
	>
		<template #actions>
			<PrivateViewHeaderBarActionButton
				v-tooltip.bottom="$t('save')"
				:loading="saving"
				:disabled="saving"
				icon="check"
				@click="save"
			/>
		</template>

		<div class="drawer-batch-content">
			<VForm
				v-model="internalEdits"
				:collection="collection"
				batch-mode
				primary-key="+"
				:validation-errors="validationErrors"
			/>

			<div class="batch-rollup">
				<div class="rollup-header" data-testid="batch-rollup-header">{{ rollupHeader }}</div>
				<DrawerBatchItem
					v-for="pk in primaryKeys"
					:key="pk"
					:item-key="pk"
					:state="itemState(pk)"
					@retry="retryItem(pk)"
				/>
			</div>
		</div>
	</VDrawer>
</template>

<style lang="scss" scoped>
.v-divider {
	margin: 2.9375rem 0;
}

.drawer-batch-content {
	padding: var(--content-padding);
	padding-block-end: var(--content-padding-bottom);
}

.batch-rollup {
	margin-block-start: 2rem;

	.rollup-header {
		margin-block-end: 0.5rem;
		color: var(--theme--foreground-subdued);
		font-weight: 600;
	}
}
</style>
