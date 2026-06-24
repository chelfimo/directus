<script setup lang="ts">
import { computed } from 'vue';
import VButton from '@/components/v-button.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VProgressLinear from '@/components/v-progress-linear.vue';
import type { FileUploadState } from '@/utils/upload-files';

const props = defineProps<{
	filename: string;
	state: FileUploadState;
	progress: number;
}>();

defineEmits<{
	(e: 'retry'): void;
}>();

const icon = computed(() => {
	switch (props.state) {
		case 'done':
			return 'check_circle';
		case 'error':
			return 'error';
		case 'cancelled':
			return 'cancel';
		case 'uploading':
			return 'sync';
		case 'queued':
		default:
			return 'schedule';
	}
});
</script>

<template>
	<div class="upload-file-row" data-testid="upload-file-row" :data-state="state">
		<VIcon :name="icon" small class="status-icon" :class="state" />

		<div class="info">
			<span class="filename">{{ filename }}</span>
			<VProgressLinear
				v-if="state === 'uploading'"
				class="progress"
				rounded
				role="progressbar"
				:aria-valuenow="progress"
				:aria-valuemin="0"
				:aria-valuemax="100"
				:value="progress"
			/>
		</div>

		<span class="state-badge">{{ state }}</span>

		<VButton
			v-if="state === 'error'"
			x-small
			secondary
			class="retry"
			data-testid="upload-file-retry"
			@click="$emit('retry')"
		>
			{{ $t('retry') }}
		</VButton>
	</div>
</template>

<style lang="scss" scoped>
.upload-file-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border-block-end: var(--theme--border-width) solid var(--theme--border-color-subdued);

	.status-icon {
		flex-shrink: 0;

		&.done {
			--v-icon-color: var(--theme--success);
		}

		&.error {
			--v-icon-color: var(--theme--danger);
		}

		&.cancelled,
		&.queued {
			--v-icon-color: var(--theme--foreground-subdued);
		}
	}

	.info {
		flex-grow: 1;
		min-inline-size: 0;

		.filename {
			display: block;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		.progress {
			margin-block-start: 4px;
		}
	}

	.state-badge {
		flex-shrink: 0;
		color: var(--theme--foreground-subdued);
		font-size: 0.85em;
	}

	.retry {
		flex-shrink: 0;
	}
}
</style>
