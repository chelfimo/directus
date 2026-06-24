<script setup lang="ts">
import type { File, Filter } from '@directus/types';
import { sum } from 'lodash';
import type { Upload } from 'tus-js-client';
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import api from '@/api';
import VButton from '@/components/v-button.vue';
import VCardActions from '@/components/v-card-actions.vue';
import VCardText from '@/components/v-card-text.vue';
import VCardTitle from '@/components/v-card-title.vue';
import VCard from '@/components/v-card.vue';
import VDialog from '@/components/v-dialog.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VInput from '@/components/v-input.vue';
import VProgressLinear from '@/components/v-progress-linear.vue';
import VUploadFileRow from '@/components/v-upload-file-row.vue';
import { emitter, Events } from '@/events';
import { useFilesStore } from '@/stores/files.js';
import { useNotificationsStore } from '@/stores/notifications';
import { useServerStore } from '@/stores/server';
import { unexpectedError } from '@/utils/unexpected-error';
import { uploadFile } from '@/utils/upload-file';
import { uploadFiles, type FileUploadHandle, type FileUploadState } from '@/utils/upload-files';
import DrawerFiles from '@/views/private/components/drawer-files.vue';

interface FileRow {
	index: number;
	name: string;
	state: FileUploadState;
	progress: number;
	removed: boolean;
}

export type UploadController = {
	start(): void;
	abort(): void;
};

interface Props {
	multiple?: boolean;
	preset?: Record<string, any>;
	fileId?: string;
	/** In case that the user isn't allowed to upload files */
	fromUser?: boolean;
	fromUrl?: boolean;
	fromLibrary?: boolean;
	folder?: string;
	filter?: Filter;
	disabled?: boolean;
	accept?: string;
}

const props = withDefaults(defineProps<Props>(), {
	preset: () => ({}),
	fromUser: true,
});

const emit = defineEmits<{
	input: [files: null | File | File[]];
	start: [controller: UploadController];
}>();

const { t } = useI18n();
const notificationsStore = useNotificationsStore();
const { info } = useServerStore();

let uploadController: Upload | null = null;

const { uploading, progress, upload, onBrowseSelect, done, numberOfFiles, visibleFileRows, showCancelAll, cancelAll, retryFile } =
	useUpload();
const { onDragEnter, onDragLeave, onDrop, dragging } = useDragging();
const { url, isValidURL, loading: urlLoading, importFromURL } = useURLImport();
const { setSelection } = useSelection();
const activeDialog = ref<'choose' | 'url' | null>(null);
const input = ref<HTMLInputElement>();
const userSelectOpen = ref(false);

const menuActivce = computed(() => Boolean(activeDialog.value) || userSelectOpen.value);

onUnmounted(() => {
	uploadController?.abort();
});

function validFiles(files: FileList) {
	const typeErrors: string[] = [];
	const emptyErrors: string[] = [];

	for (const file of files) {
		if (file.size === 0) {
			emptyErrors.push(`"${file.name}"`);
			continue;
		}

		if (props.accept) {
			const acceptTypes = props.accept.split(',').map((type) => type.trim());

			const isValidType = acceptTypes.some((acceptType) => {
				if (acceptType.endsWith('/*')) {
					const baseType = acceptType.slice(0, -2);

					return file.type.startsWith(baseType + '/');
				} else {
					return file.type === acceptType;
				}
			});

			if (!isValidType) {
				typeErrors.push(`"${file.name}" (${file.type})`);
			}
		}
	}

	const totalErrors = typeErrors.length + emptyErrors.length;

	if (typeErrors.length + emptyErrors.length > 0) {
		const errorParts: string[] = [];

		if (typeErrors.length > 0) {
			errorParts.push(
				t('files_wrong_type', {
					files: typeErrors.join(', '),
					expected: props.accept,
				}),
			);
		}

		if (emptyErrors.length > 0) {
			errorParts.push(
				t('files_are_empty', {
					files: emptyErrors.join(', '),
				}),
			);
		}

		notificationsStore.add({
			title: t('invalid_files_selected', { count: totalErrors }, totalErrors),
			text: errorParts.join('\n'),
			type: 'error',
			dialog: true,
		});

		return false;
	}

	return true;
}

function useUpload() {
	const filesStore = useFilesStore();
	const newUpload = filesStore.upload();

	// DR-UC10: per-file rollup for multi-file mode.
	const fileRows = ref<FileRow[]>([]);
	let abortHandles: FileUploadHandle[] = [];
	let lastFiles: globalThis.File[] = [];
	let lastPreset: Record<string, any> = {};

	const visibleFileRows = computed(() => fileRows.value.filter((row) => !row.removed));
	const showCancelAll = computed(() =>
		fileRows.value.some((row) => !row.removed && (row.state === 'queued' || row.state === 'uploading')),
	);

	return {
		uploading: newUpload.uploading,
		progress: newUpload.progress,
		upload,
		onBrowseSelect,
		numberOfFiles: newUpload.numberOfFiles,
		done: newUpload.done,
		visibleFileRows,
		showCancelAll,
		cancelAll,
		retryFile,
	};

	// Cancel all: remove still-queued files, abort in-flight ones (-> cancelled), keep done (DR-UC10-C2).
	function cancelAll() {
		for (const row of fileRows.value) {
			if (row.removed) continue;

			if (row.state === 'queued') {
				abortHandles[row.index]?.abort();
				row.removed = true;
			} else if (row.state === 'uploading') {
				abortHandles[row.index]?.abort();
			}
		}
	}

	// Per-row retry: re-upload a single errored file (DR-UC10-S3).
	async function retryFile(index: number) {
		const file = lastFiles[index];
		const row = fileRows.value.find((candidate) => candidate.index === index);
		if (!file || !row) return;

		const controller = new AbortController();
		abortHandles[index] = {
			abort: () => {
				row.state = 'cancelled';
				controller.abort();
			},
		};

		row.removed = false;
		row.progress = 0;
		row.state = 'uploading';

		try {
			const result = await uploadFile(file, {
				preset: lastPreset,
				signal: controller.signal,
				onProgressChange: (percentage) => {
					row.progress = percentage;
				},
			});

			if ((row.state as FileUploadState) === 'cancelled') return;
			row.state = result ? 'done' : 'error';
			if (result) emit('input', result);
		} catch (error: any) {
			row.state = error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' ? 'cancelled' : 'error';
		}
	}

	async function upload(files: FileList) {
		newUpload.start(files.length);

		const preset = {
			...props.preset,
			...(props.folder && { folder: props.folder }),
		};

		try {
			if (!validFiles(files)) return;

			if (props.multiple === true) {
				const fileList = Array.from(files);
				const fileSizes = fileList.map((file) => file.size);
				const totalBytes = sum(fileSizes);
				const fileControllers: (UploadController | null)[] = new Array(files.length).fill(null);

				// Seed the per-file rollup as queued (DR-UC10-L1).
				lastFiles = fileList;
				lastPreset = preset;
				fileRows.value = fileList.map((file, index) => ({
					index,
					name: file.name,
					state: 'queued',
					progress: 0,
					removed: false,
				}));
				abortHandles = [];

				const controller = {
					start() {
						fileControllers.forEach((controller) => controller?.start());
					},
					abort() {
						fileControllers.forEach((controller) => controller?.abort());
					},
				};

				const uploadedFiles = await uploadFiles(fileList, {
					// Cap concurrency at min(5, N) when the server doesn't configure it (DR-UC10-C1).
					maxConcurrency: info.uploads?.maxConcurrency ?? Math.min(5, fileList.length),
					onProgressChange: (percentages) => {
						newUpload.progress.value = Math.round(
							(sum(fileSizes.map((total, i) => total * (percentages[i]! / 100))) / totalBytes) * 100,
						);

						for (const [i, percentage] of percentages.entries()) {
							if (fileRows.value[i]) fileRows.value[i]!.progress = percentage;
						}

						const doneIndices = percentages
							.map((p, i) => [p, i])
							.filter(([p]) => p === 100)
							.map(([, i]) => i!);

						newUpload.done.value = doneIndices.length;

						// Nullify controller for done uploads, to prevent resuming after pausing
						for (const idx of doneIndices) {
							if (fileControllers[idx]) fileControllers[idx] = null;
						}
					},
					onFileStateChange: (states) => {
						for (const [i, state] of states.entries()) {
							if (fileRows.value[i]) fileRows.value[i]!.state = state;
						}
					},
					onControllersChange: (handles) => {
						abortHandles = handles;
					},
					onChunkedUpload: (controllers) => {
						controllers.forEach((controller, i) => (fileControllers[i] = controller));
						uploadController = controller as Upload;

						if (controllers.every((c) => c !== null)) {
							// Only emit start once every upload started
							emit('start', controller);
						}
					},
					preset,
				});

				if (uploadedFiles)
					emit(
						'input',
						uploadedFiles.filter((f): f is File => !!f),
					);
			} else {
				const uploadedFile = await uploadFile(Array.from(files)[0]!, {
					onProgressChange: (percentage) => {
						newUpload.progress.value = percentage;
						newUpload.done.value = percentage === 100 ? 1 : 0;
					},
					onChunkedUpload: (controller) => {
						uploadController = controller;
						emit('start', controller);
					},
					fileId: props.fileId,
					preset,
				});

				if (uploadedFile) emit('input', uploadedFile);
				uploadController = null;
			}
		} catch (error) {
			unexpectedError(error);
			emit('input', null);
		} finally {
			newUpload.finish();
		}
	}

	function onBrowseSelect(event: Event) {
		const files = (event.target as HTMLInputElement)?.files;

		if (files) {
			upload(files);
		}

		userSelectOpen.value = false;
	}
}

function useDragging() {
	const dragging = ref(false);

	let dragCounter = 0;

	return { onDragEnter, onDragLeave, onDrop, dragging };

	function onDragEnter() {
		dragCounter++;

		if (dragCounter === 1) {
			dragging.value = true;
		}
	}

	function onDragLeave() {
		dragCounter--;

		if (dragCounter === 0) {
			dragging.value = false;
		}
	}

	function onDrop(event: DragEvent) {
		dragCounter = 0;
		dragging.value = false;

		const files = event.dataTransfer?.files;

		if (files && props.fromUser) {
			upload(files);
		}
	}
}

function useSelection() {
	return { setSelection };

	async function setSelection(selection: (string | number)[] | null) {
		if (!selection) return;

		if (props.multiple) {
			const filesResponse = await api.get(`/files`, {
				params: {
					filter: {
						id: {
							_in: selection,
						},
					},
				},
			});

			emit('input', filesResponse.data.data);
		} else {
			if (selection[0]) {
				const id = selection[0];
				const fileResponse = await api.get(`/files/${id}`);
				emit('input', fileResponse.data.data);
			} else {
				emit('input', null);
			}
		}
	}
}

function useURLImport() {
	const url = ref('');
	const loading = ref(false);
	const filesStore = useFilesStore();
	const newUpload = filesStore.upload();

	const isValidURL = computed(() => {
		try {
			new URL(url.value);
			return true;
		} catch {
			return false;
		}
	});

	return { url, loading, isValidURL, importFromURL };

	async function importFromURL() {
		if (!isValidURL.value || loading.value) return;

		loading.value = true;
		newUpload.start(1);

		const data = {
			...props.preset,
			...(props.folder && { folder: props.folder }),
			id: props.fileId,
		};

		try {
			const response = await api.post(`/files/import`, {
				url: url.value,
				data,
				options: { filterMimeType: props.accept?.split(',') },
			});

			newUpload.progress.value = 100;
			newUpload.done.value = 1;

			emitter.emit(Events.upload);

			if (props.multiple) {
				emit('input', [response.data.data]);
			} else {
				emit('input', response.data.data);
			}

			activeDialog.value = null;
			url.value = '';
		} catch (error) {
			unexpectedError(error);
		} finally {
			loading.value = false;
			newUpload.finish();
		}
	}
}

function openFileBrowser() {
	userSelectOpen.value = true;
	input.value?.click();
}

function abort() {
	uploadController?.abort();
}

defineExpose({ abort });
</script>

<template>
	<div
		v-prevent-focusout="menuActivce"
		data-dropzone
		class="v-upload"
		:class="{ dragging: dragging && fromUser, uploading, disabled }"
		@dragenter.prevent="onDragEnter"
		@dragover.prevent
		@dragleave.prevent="onDragLeave"
		@drop.stop.prevent="onDrop"
	>
		<template v-if="dragging && fromUser">
			<VIcon class="upload-icon" x-large name="file_upload" />
			<p class="type-label">{{ $t('drop_to_upload') }}</p>
		</template>

		<template v-else-if="uploading">
			<p class="type-label">{{ progress }}%</p>
			<p class="type-text">
				{{
					multiple && numberOfFiles > 1
						? $t('upload_files_indeterminate', { done: done, total: numberOfFiles })
						: $t('upload_file_indeterminate')
				}}
			</p>
			<VProgressLinear :value="progress" rounded />
		</template>

		<template v-else>
			<div class="actions">
				<VButton
					v-if="fromUser"
					v-tooltip="!disabled && $t('click_to_browse')"
					icon
					rounded
					secondary
					:disabled
					@click="openFileBrowser"
				>
					<input
						ref="input"
						class="browse"
						type="file"
						tabindex="-1"
						:multiple="multiple"
						:accept="accept"
						@cancel="userSelectOpen = false"
						@input="onBrowseSelect"
					/>
					<VIcon name="file_upload" />
				</VButton>
				<VButton
					v-if="fromLibrary"
					v-tooltip="!disabled && $t('choose_from_library')"
					icon
					rounded
					secondary
					:disabled
					@click="activeDialog = 'choose'"
				>
					<VIcon name="folder_open" />
				</VButton>
				<VButton
					v-if="fromUrl && fromUser"
					v-tooltip="!disabled && $t('import_from_url')"
					icon
					rounded
					secondary
					:disabled
					@click="activeDialog = 'url'"
				>
					<VIcon name="link" />
				</VButton>
			</div>

			<p class="type-label">{{ $t(fromUser ? 'drag_file_here' : 'choose_from_library') }}</p>

			<template v-if="fromUrl !== false || fromLibrary !== false">
				<DrawerFiles
					:active="activeDialog === 'choose'"
					:multiple="multiple"
					:folder="folder"
					:filter="filter"
					@update:active="activeDialog = null"
					@input="setSelection"
				/>

				<VDialog
					:model-value="activeDialog === 'url'"
					:persistent="urlLoading"
					@esc="activeDialog = null"
					@apply="importFromURL"
					@update:model-value="activeDialog = null"
				>
					<VCard>
						<VCardTitle>{{ $t('import_from_url') }}</VCardTitle>
						<VCardText>
							<VInput v-model="url" autofocus :placeholder="$t('url')" :nullable="false" :disabled="urlLoading" />
						</VCardText>
						<VCardActions>
							<VButton :disabled="urlLoading" secondary @click="activeDialog = null">
								{{ $t('cancel') }}
							</VButton>
							<VButton :loading="urlLoading" :disabled="!isValidURL" @click="importFromURL">
								{{ $t('import_label') }}
							</VButton>
						</VCardActions>
					</VCard>
				</VDialog>
			</template>
		</template>

		<div v-if="multiple && visibleFileRows.length > 0" class="upload-file-list" @click.stop>
			<div class="upload-file-list-header">
				<span class="rollup-count">{{ $t('upload_files_indeterminate', { done, total: numberOfFiles }) }}</span>
				<VButton v-if="showCancelAll" x-small secondary data-testid="upload-cancel-all" @click.stop="cancelAll">
					{{ $t('cancel_all') }}
				</VButton>
			</div>
			<VUploadFileRow
				v-for="row in visibleFileRows"
				:key="row.index"
				:filename="row.name"
				:state="row.state"
				:progress="row.progress"
				@retry="retryFile(row.index)"
			/>
		</div>
	</div>
</template>

<style lang="scss" scoped>
.v-upload {
	position: relative;
	display: flex;
	flex-direction: column;
	justify-content: center;
	min-block-size: var(--input-height-md);
	padding: 1.8125rem;
	color: var(--theme--foreground-subdued);
	text-align: center;
	border: var(--theme--border-width) dashed var(--theme--form--field--input--border-color);
	border-radius: var(--theme--border-radius);
	transition: var(--fast) var(--transition);
	transition-property: color, border-color, background-color;

	p {
		color: inherit;
	}

	&.disabled {
		background-color: var(--theme--form--field--input--background-subdued);
	}

	&:not(.uploading):not(.disabled):hover {
		border-color: var(--theme--form--field--input--border-color-hover);
	}
}

.actions {
	display: flex;
	justify-content: center;
	margin-block-end: 1rem;

	.v-button {
		margin-inline-end: 0.6875rem;

		&:last-child {
			margin-inline-end: 0;
		}
	}
}

.browse {
	position: absolute;
	inset-block-start: 0;
	inset-inline-start: 0;
	display: block;
	inline-size: 100%;
	block-size: 100%;
	cursor: pointer;
	opacity: 0;
	appearance: none;
}

.dragging {
	color: var(--theme--primary);
	background-color: var(--theme--primary-background);
	border-color: var(--theme--form--field--input--border-color-focus);

	* {
		pointer-events: none;
	}

	.upload-icon {
		margin: 0 auto;
		margin-block-end: 0.6875rem;
	}
}

.uploading {
	--v-progress-linear-color: var(--white);
	--v-progress-linear-background-color: rgb(255 255 255 / 0.25);
	--v-progress-linear-height: 0.4375rem;

	color: var(--white);
	background-color: var(--theme--primary);
	border-color: var(--theme--form--field--input--border-color-focus);
	border-style: solid;

	.v-progress-linear {
		position: absolute;
		inset-block-end: 1.6875rem;
		inset-inline-start: 1.8125rem;
		inline-size: calc(100% - 3.625rem);
	}
}

.upload-file-list {
	inline-size: 100%;
	margin-block-start: 1rem;
	text-align: start;

	.upload-file-list-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-block-end: 0.5rem;
		color: var(--theme--foreground-subdued);
		font-size: 0.85em;
	}
}
</style>
