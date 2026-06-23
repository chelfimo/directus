<script setup lang="ts">
import { Field, LocalType } from '@directus/types';
import { isNil, orderBy } from 'lodash';
import { computed, onBeforeMount, onBeforeUnmount, ref, toRefs } from 'vue';
import { useI18n } from 'vue-i18n';
import Draggable from 'vuedraggable';
import FieldSelect from './FieldSelect.vue';
import VButton from '@/components/v-button.vue';
import VDivider from '@/components/v-divider.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VListItemContent from '@/components/v-list-item-content.vue';
import VListItemIcon from '@/components/v-list-item-icon.vue';
import VListItem from '@/components/v-list-item.vue';
import VList from '@/components/v-list.vue';
import VMenu from '@/components/v-menu.vue';
import { useFieldsStore } from '@/stores/fields';
import { hideDragImage } from '@/utils/hide-drag-image';

const props = defineProps<{
	collection: string;
}>();

const { t } = useI18n();

const { collection } = toRefs(props);
const fieldsStore = useFieldsStore();
onBeforeMount(async () => await fieldsStore.hydrate({ skipTranslation: true }));
onBeforeUnmount(() => fieldsStore.translateFields());

const fields = computed(() => fieldsStore.getFieldsForCollectionSorted(collection.value));

const parsedFields = computed(() => {
	return orderBy(fields.value, [(o) => (o.meta?.sort ? Number(o.meta?.sort) : null), (o) => o.meta?.id]).filter(
		(field) => field.field.startsWith('$') === false,
	);
});

const lockedFields = computed(() => {
	return parsedFields.value.filter((field) => field.meta?.system === true);
});

const usableFields = computed(() => {
	return parsedFields.value.filter((field) => field.meta?.system !== true);
});

// Top-level (ungrouped) fields are the draggable set; kept as a computed so the @start/@end
// handlers can map the sortable index back to the dragged field's key (DR-UC05).
const topLevelFields = computed(() => usableFields.value.filter((field) => isNil(field?.meta?.group)));

// Observable drag/save lifecycle: the row currently being dragged, and the row whose reorder save
// is in flight. Bound to data-dragging / data-saving on the field rows.
const draggingKey = ref<string | null>(null);
const savingKey = ref<string | null>(null);

function onDragStart(event: { oldIndex?: number }) {
	draggingKey.value = topLevelFields.value[event.oldIndex ?? -1]?.field ?? null;
}

function onDragEnd() {
	draggingKey.value = null;
}

const addOptions = computed<Array<{ type: LocalType; icon: string; text: any } | { divider: boolean }>>(() => [
	{
		type: 'standard',
		icon: 'create',
		text: t('standard_field'),
	},
	{
		type: 'presentation',
		icon: 'scatter_plot',
		text: t('presentation_and_aliases'),
	},
	{
		type: 'group',
		icon: 'view_in_ar',
		text: t('field_group'),
	},
	{
		divider: true,
	},
	{
		type: 'file',
		icon: 'photo',
		text: t('single_file'),
	},
	{
		type: 'files',
		icon: 'collections',
		text: t('multiple_files'),
	},
	{
		divider: true,
	},
	{
		type: 'm2o',
		icon: 'call_merge',
		text: t('m2o_relationship'),
	},
	{
		type: 'o2m',
		icon: 'call_split',
		text: t('o2m_relationship'),
	},
	{
		type: 'm2m',
		icon: 'import_export',
		text: t('m2m_relationship'),
	},
	{
		type: 'm2a',
		icon: 'gesture',
		text: t('m2a_relationship'),
	},
	{
		divider: true,
	},
	{
		type: 'translations',
		icon: 'translate',
		text: t('translations'),
	},
]);

async function setSort(fields: Field[]) {
	const updates = fields.map((field, index) => ({
		field: field.field,
		meta: {
			sort: index + 1,
			group: null,
		},
	}));

	// Mark the dragged row as saving while the (single) PATCH is in flight; cleared once the store
	// action settles, whether it reconciled or reverted. draggingKey is still set here because @end
	// fires after @update:model-value.
	savingKey.value = draggingKey.value;

	try {
		await fieldsStore.updateFields(collection.value, updates);
	} finally {
		savingKey.value = null;
	}
}

async function setNestedSort(updates?: Field[]) {
	updates = (updates || []).filter((val) => isNil(val) === false);

	if (updates.length > 0) {
		await fieldsStore.updateFields(collection.value, updates);
	}
}
</script>

<template>
	<div class="fields-management">
		<div v-if="lockedFields.length > 0" class="field-grid">
			<FieldSelect v-for="field in lockedFields" :key="field.field" disabled :field="field" />
		</div>

		<Draggable
			class="field-grid"
			:model-value="topLevelFields"
			handle=".drag-handle"
			:group="{ name: 'fields' }"
			:set-data="hideDragImage"
			item-key="field"
			:animation="150"
			ghost-class="field-reorder-ghost"
			v-bind="{ 'force-fallback': true, 'fallback-on-body': true, 'invert-swap': true }"
			@start="onDragStart"
			@end="onDragEnd"
			@update:model-value="setSort"
		>
			<template #item="{ element }">
				<FieldSelect
					:field="element"
					:fields="usableFields"
					:data-dragging="element.field === draggingKey ? 'true' : undefined"
					:data-saving="element.field === savingKey ? 'true' : undefined"
					@set-nested-sort="setNestedSort"
				/>
			</template>
		</Draggable>

		<VButton full-width :to="{ name: 'settings-fields-field', params: { collection, field: '+' } }">
			{{ $t('create_field') }}
		</VButton>

		<VMenu show-arrow>
			<template #activator="{ toggle, active }">
				<button class="add-field-advanced" :dashed="!active" :class="{ active }" @click="toggle">
					{{ $t('create_in_advanced_field_creation_mode') }}
				</button>
			</template>
			<VList>
				<template v-for="(option, index) in addOptions" :key="index">
					<VDivider v-if="option.divider === true" />
					<VListItem
						v-else
						:to="{ name: 'settings-fields-field', params: { collection, field: '+' }, query: { type: option.type } }"
					>
						<VListItemIcon>
							<VIcon :name="option.icon" />
						</VListItemIcon>
						<VListItemContent>
							{{ option.text }}
						</VListItemContent>
					</VListItem>
				</template>
			</VList>
		</VMenu>
	</div>
</template>

<style lang="scss" scoped>
.fields-management {
	margin-block-end: 1.375rem;
}

.field-grid {
	position: relative;
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	padding-block-end: 1.375rem;
}

// Visible drop indicator at the candidate position while dragging (DR-UC05-D2).
.field-reorder-ghost {
	opacity: 0.6;
	outline: var(--theme--border-width) dashed var(--theme--primary);
	outline-offset: -2px;
	border-radius: var(--theme--border-radius);
}

.field-select {
	margin: 0.25rem;
}

.field-select:deep(.field-grid) {
	gap: 0;
}

.field-select:deep(.field-grid.group.full.nested) {
	margin: 0.25rem 0;

	.field-select {
		margin: 0.25rem;
	}
}

.add-field {
	--v-button-font-size: 0.8125rem;
	--v-button-background-color: var(--theme--primary);
	--v-button-background-color-hover: var(--theme--primary-accent);

	margin-block-start: -0.6875rem;
}

.add-field-advanced {
	display: block;
	inline-size: max-content;
	margin: 0 auto;
	margin-block-start: 0.4375rem;
	color: var(--theme--foreground-subdued);
	transition: color var(--fast) var(--transition);

	&:hover {
		color: var(--theme--foreground);
	}
}

.visible {
	margin-block-end: 1.375rem;
}

.list-move {
	transition: transform 0.5s;
}
</style>
