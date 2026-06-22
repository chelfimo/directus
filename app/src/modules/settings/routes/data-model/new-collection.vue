<script setup lang="ts">
import { DeepPartial, Field, Relation } from '@directus/types';
import { cloneDeep, debounce } from 'lodash';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import api from '@/api';
import VCheckbox from '@/components/v-checkbox.vue';
import VDrawer from '@/components/v-drawer.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VInput from '@/components/v-input.vue';
import VNotice from '@/components/v-notice.vue';
import VSelect from '@/components/v-select/v-select.vue';
import { useCollectionDraft, CollectionDraft } from '@/composables/use-collection-draft';
import { useDialogRoute } from '@/composables/use-dialog-route';
import { useCollectionsStore } from '@/stores/collections';
import { useFieldsStore } from '@/stores/fields';
import { useRelationsStore } from '@/stores/relations';
import { notify } from '@/utils/notify';
import { unexpectedError } from '@/utils/unexpected-error';
import NewCollectionWizard from './components/new-collection-wizard.vue';

const defaultSystemFields = {
	status: {
		enabled: false,
		inputDisabled: false,
		name: 'status',
		label: 'status',
		icon: 'flag',
	},
	sort: {
		enabled: false,
		inputDisabled: false,
		name: 'sort',
		label: 'sort',
		icon: 'low_priority',
	},
	dateCreated: {
		enabled: false,
		inputDisabled: false,
		name: 'date_created',
		label: 'created_on',
		icon: 'access_time',
	},
	userCreated: {
		enabled: false,
		inputDisabled: false,
		name: 'user_created',
		label: 'created_by',
		icon: 'account_circle',
	},
	dateUpdated: {
		enabled: false,
		inputDisabled: false,
		name: 'date_updated',
		label: 'updated_on',
		icon: 'access_time',
	},
	userUpdated: {
		enabled: false,
		inputDisabled: false,
		name: 'user_updated',
		label: 'updated_by',
		icon: 'account_circle',
	},
};

const { t } = useI18n();

const router = useRouter();

const collectionsStore = useCollectionsStore();
const fieldsStore = useFieldsStore();
const relationsStore = useRelationsStore();

const isOpen = useDialogRoute();

const stepIndex = ref(0);

const steps = computed(() => [
	{ id: 'collection', label: t('collection_setup') },
	{ id: 'primary_key', label: t('primary_key_field') },
	{ id: 'optional_fields', label: t('optional_system_fields') },
]);

const collectionName = ref<string | null>(null);
const singleton = ref(false);
const primaryKeyFieldName = ref('id');
const primaryKeyFieldType = ref<'auto_int' | 'auto_big_int' | 'uuid' | 'manual'>('auto_int');

const sortField = ref<string>();

const archiveField = ref<string>();
const archiveValue = ref<string>();
const unarchiveValue = ref<string>();

const systemFields = reactive(cloneDeep(defaultSystemFields));

const saving = ref(false);

watch(() => singleton.value, setOptionsForSingleton);

function setOptionsForSingleton() {
	systemFields.sort = { ...defaultSystemFields.sort };
	systemFields.sort.inputDisabled = singleton.value;
}

// Step 1 requires a collection name; step 2 requires a primary-key column name. The final
// step has no gate (Submit handles its own loading). canAdvance gates the Next button only.
const canAdvance = computed(() => {
	if (stepIndex.value === 0) return !!collectionName.value?.length;
	if (stepIndex.value === 1) return !!primaryKeyFieldName.value?.length;
	return true;
});

const draft = useCollectionDraft();

// Set once the create succeeds so the trailing debounced autosave can't rewrite a cleared draft.
const committed = ref(false);

function buildDraft(): CollectionDraft {
	const systemFieldsDraft: CollectionDraft['systemFields'] = {};

	for (const [key, info] of Object.entries(systemFields)) {
		systemFieldsDraft[key] = { enabled: info.enabled, name: info.name };
	}

	return {
		collectionName: collectionName.value,
		singleton: singleton.value,
		primaryKeyFieldName: primaryKeyFieldName.value,
		primaryKeyFieldType: primaryKeyFieldType.value,
		systemFields: systemFieldsDraft,
	};
}

function applyDraft(d: CollectionDraft) {
	collectionName.value = d.collectionName;
	singleton.value = d.singleton;
	primaryKeyFieldName.value = d.primaryKeyFieldName ?? 'id';
	primaryKeyFieldType.value = d.primaryKeyFieldType ?? 'auto_int';

	for (const [key, info] of Object.entries(d.systemFields ?? {})) {
		if (systemFields[key as keyof typeof systemFields]) {
			systemFields[key as keyof typeof systemFields].enabled = info.enabled;
			systemFields[key as keyof typeof systemFields].name = info.name;
		}
	}

	setOptionsForSingleton();
}

const saveDraft = debounce(() => {
	if (committed.value) return;
	draft.save(buildDraft());
}, 500);

// Restore an interrupted draft on (re)open (DR-UC02-P1).
onMounted(() => {
	const existing = draft.load();
	if (existing) applyDraft(existing);
});

// Autosave any change across any step.
watch([collectionName, singleton, primaryKeyFieldName, primaryKeyFieldType, systemFields], saveDraft, {
	deep: true,
});

function onApply() {
	if (stepIndex.value < steps.value.length - 1) {
		if (canAdvance.value) stepIndex.value += 1;
		return;
	}

	if (!saving.value) save();
}

async function save() {
	saving.value = true;

	try {
		const response = await api.post(`/collections`, {
			collection: collectionName.value,
			fields: [getPrimaryKeyField(), ...getSystemFields()],
			schema: {},
			meta: {
				sort_field: sortField.value,
				archive_field: archiveField.value,
				archive_value: archiveValue.value,
				unarchive_value: unarchiveValue.value,
				singleton: singleton.value,
			},
		});

		const createdCollectionName = response.data.data.collection;

		const storeHydrations: Promise<void>[] = [];

		const relations = getSystemRelations();

		if (relations.length > 0) {
			const requests = relations.map((relation) => api.post('/relations', relation));
			await Promise.all(requests);
			storeHydrations.push(relationsStore.hydrate());
		}

		storeHydrations.push(collectionsStore.hydrate(), fieldsStore.hydrate());
		await Promise.all(storeHydrations);

		notify({
			title: t('collection_created'),
		});

		// Success: drop the draft so a later create starts fresh (DR-UC02-P2). Cancel any pending
		// debounced save first so it can't resurrect the cleared draft.
		committed.value = true;
		saveDraft.cancel();
		draft.clear();

		router.replace({ name: 'settings-fields', params: { collection: createdCollectionName } });
	} catch (error) {
		// Failure: keep the draft for retry (DR-UC02-P3).
		unexpectedError(error);
	} finally {
		saving.value = false;
	}
}

function getPrimaryKeyField() {
	if (primaryKeyFieldType.value === 'uuid') {
		return {
			field: primaryKeyFieldName.value,
			type: 'uuid',
			meta: {
				hidden: true,
				readonly: true,
				interface: 'input',
				special: ['uuid'],
			},
			schema: {
				is_primary_key: true,
				length: 36,
				has_auto_increment: false,
			},
		};
	} else if (primaryKeyFieldType.value === 'manual') {
		return {
			field: primaryKeyFieldName.value,
			type: 'string',
			meta: {
				interface: 'input',
				readonly: false,
				hidden: false,
			},
			schema: {
				is_primary_key: true,
				length: 255,
				has_auto_increment: false,
			},
		};
	} else {
		return {
			field: primaryKeyFieldName.value,
			type: primaryKeyFieldType.value === 'auto_big_int' ? 'bigInteger' : 'integer',
			meta: {
				hidden: true,
				interface: 'input',
				readonly: true,
			},
			schema: {
				is_primary_key: true,
				has_auto_increment: true,
			},
		};
	}
}

function getSystemFields() {
	const fields: DeepPartial<Field>[] = [];

	// Status
	if (systemFields.status.enabled === true) {
		fields.push({
			field: systemFields.status.name,
			type: 'string',
			meta: {
				width: 'full',
				options: {
					choices: [
						{
							text: '$t:published',
							value: 'published',
							color: 'var(--theme--primary)',
						},
						{
							text: '$t:draft',
							value: 'draft',
							color: 'var(--theme--foreground)',
						},
						{
							text: '$t:archived',
							value: 'archived',
							color: 'var(--theme--warning)',
						},
					],
				},
				interface: 'select-dropdown',
				display: 'labels',
				display_options: {
					showAsDot: true,
					choices: [
						{
							text: '$t:published',
							value: 'published',
							color: 'var(--theme--primary)',
							foreground: 'var(--theme--primary)',
							background: 'var(--theme--primary-background)',
						},
						{
							text: '$t:draft',
							value: 'draft',
							color: 'var(--theme--foreground)',
							foreground: 'var(--theme--foreground)',
							background: 'var(--theme--background-normal)',
						},
						{
							text: '$t:archived',
							value: 'archived',
							color: 'var(--theme--warning)',
							foreground: 'var(--theme--warning)',
							background: 'var(--theme--warning-background)',
						},
					],
				},
			},
			schema: {
				default_value: 'draft',
				is_nullable: false,
			},
		});

		archiveField.value = systemFields.status.name;
		archiveValue.value = 'archived';
		unarchiveValue.value = 'draft';
	}

	// Sort
	if (systemFields.sort.enabled === true) {
		fields.push({
			field: systemFields.sort.name,
			type: 'integer',
			meta: {
				interface: 'input',
				hidden: true,
			},
			schema: {},
		});

		sortField.value = systemFields.sort.name;
	}

	if (systemFields.userCreated.enabled === true) {
		fields.push({
			field: systemFields.userCreated.name,
			type: 'uuid',
			meta: {
				special: ['user-created'],
				interface: 'select-dropdown-m2o',
				options: {
					template: '{{avatar}} {{first_name}} {{last_name}}',
				},
				display: 'user',
				readonly: true,
				hidden: true,
				width: 'half',
			},
			schema: {},
		});
	}

	if (systemFields.dateCreated.enabled === true) {
		fields.push({
			field: systemFields.dateCreated.name,
			type: 'timestamp',
			meta: {
				special: ['date-created'],
				interface: 'datetime',
				readonly: true,
				hidden: true,
				width: 'half',
				display: 'datetime',
				display_options: {
					relative: true,
				},
			},
			schema: {},
		});
	}

	if (systemFields.userUpdated.enabled === true) {
		fields.push({
			field: systemFields.userUpdated.name,
			type: 'uuid',
			meta: {
				special: ['user-updated'],
				interface: 'select-dropdown-m2o',
				options: {
					template: '{{avatar}} {{first_name}} {{last_name}}',
				},
				display: 'user',
				readonly: true,
				hidden: true,
				width: 'half',
			},
			schema: {},
		});
	}

	if (systemFields.dateUpdated.enabled === true) {
		fields.push({
			field: systemFields.dateUpdated.name,
			type: 'timestamp',
			meta: {
				special: ['date-updated'],
				interface: 'datetime',
				readonly: true,
				hidden: true,
				width: 'half',
				display: 'datetime',
				display_options: {
					relative: true,
				},
			},
			schema: {},
		});
	}

	return fields;
}

function getSystemRelations() {
	const relations: Partial<Relation>[] = [];

	if (systemFields.userCreated.enabled === true) {
		relations.push({
			collection: collectionName.value!,
			field: systemFields.userCreated.name,
			related_collection: 'directus_users',
			schema: {},
		});
	}

	if (systemFields.userUpdated.enabled === true) {
		relations.push({
			collection: collectionName.value!,
			field: systemFields.userUpdated.name,
			related_collection: 'directus_users',
			schema: {},
		});
	}

	return relations;
}

</script>

<template>
	<VDrawer
		:title="$t('creating_new_collection')"
		:model-value="isOpen"
		class="new-collection"
		persistent
		:sidebar-label="steps[stepIndex]?.label"
		@cancel="router.push({ name: 'settings-collections' })"
		@apply="onApply"
	>
		<NewCollectionWizard
			v-model="stepIndex"
			class="content"
			:steps="steps"
			:can-advance="canAdvance"
			:submitting="saving"
			@submit="save"
		>
			<template #collection>
				<VNotice>{{ $t('creating_collection_info') }}</VNotice>

				<div class="grid">
					<div class="field full">
						<div class="type-label">
							{{ $t('name') }}
							<VIcon v-tooltip="$t('required')" class="required" name="star" sup filled />
						</div>
						<VInput
							v-model="collectionName"
							autofocus
							class="monospace"
							db-safe
							:placeholder="$t('a_unique_table_name')"
						/>
						<small class="type-note">{{ $t('collection_names_are_case_sensitive') }}</small>
					</div>
					<div class="field full">
						<div class="type-label">{{ $t('singleton') }}</div>
						<VCheckbox v-model="singleton" block :label="$t('singleton_label')" />
					</div>
				</div>
			</template>

			<template #primary_key>
				<div class="grid">
					<div class="field half">
						<div class="type-label">{{ $t('primary_key_field') }}</div>
						<VInput v-model="primaryKeyFieldName" class="monospace" db-safe :placeholder="$t('a_unique_column_name')" />
					</div>
					<div class="field half">
						<div class="type-label">{{ $t('type') }}</div>
						<VSelect
							v-model="primaryKeyFieldType"
							:items="[
								{
									text: $t('auto_increment_integer'),
									value: 'auto_int',
								},
								{
									text: $t('auto_increment_big_integer'),
									value: 'auto_big_int',
								},
								{
									text: $t('generated_uuid'),
									value: 'uuid',
								},
								{
									text: $t('manual_string'),
									value: 'manual',
								},
							]"
						/>
					</div>
				</div>
			</template>

			<template #optional_fields>
				<VNotice>{{ $t('creating_collection_system') }}</VNotice>

				<div class="grid system">
					<div
						v-for="(info, field, index) in systemFields"
						:key="field"
						class="field"
						:class="index % 2 === 0 ? 'half' : 'half-right'"
					>
						<div class="type-label">{{ $t(info.label) }}</div>
						<VInput
							v-model="info.name"
							db-safe
							class="monospace"
							:class="{ active: info.enabled }"
							:disabled="info.inputDisabled"
							@focus="info.enabled = true"
						>
							<template #prepend>
								<VCheckbox v-model="info.enabled" :disabled="info.inputDisabled" />
							</template>

							<template #append>
								<VIcon :name="info.icon" />
							</template>
						</VInput>
					</div>
				</div>
			</template>
		</NewCollectionWizard>
	</VDrawer>
</template>

<style lang="scss" scoped>
@use '@/styles/mixins';

.type-title {
	margin-block-end: 2.6875rem;
}

.grid {
	@include mixins.form-grid;
}

.system :deep(.v-input .input) {
	color: var(--theme--foreground-subdued);
}

.system :deep(.v-input .active .input) {
	color: var(--theme--foreground);
}

.system .v-icon {
	--v-icon-color: var(--theme--foreground-subdued);
}

.spacer {
	flex-grow: 1;
}

.v-input.monospace {
	--v-input-font-family: var(--theme--fonts--monospace--font-family);
}

.required {
	color: var(--theme--primary);
}

.content {
	padding: var(--content-padding);
	padding-block-end: var(--content-padding);
}

.v-notice {
	margin-block-end: 2rem;
}

.type-note {
	position: relative;
	display: block;
	max-inline-size: 29.25rem;
	margin-block-start: 0.25rem;
}
</style>
