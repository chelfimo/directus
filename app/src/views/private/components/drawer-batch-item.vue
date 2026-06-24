<script setup lang="ts">
import { computed } from 'vue';
import VButton from '@/components/v-button.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VProgressCircular from '@/components/v-progress-circular.vue';
import type { BatchItemState } from '@/composables/use-batch-rollup';

const props = defineProps<{
	itemKey: string | number;
	state: BatchItemState;
}>();

defineEmits<{
	(e: 'retry'): void;
}>();

const icon = computed(() => {
	switch (props.state) {
		case 'saved':
			return 'check_circle';
		case 'error':
			return 'error';
		case 'pending':
		default:
			return 'radio_button_unchecked';
	}
});
</script>

<template>
	<div class="batch-item-row" data-testid="batch-item-row" :data-state="state">
		<VProgressCircular v-if="state === 'saving'" indeterminate small class="status-icon saving" />
		<VIcon v-else :name="icon" small class="status-icon" :class="state" />

		<span class="item-key">{{ itemKey }}</span>

		<VButton
			v-if="state === 'error'"
			x-small
			secondary
			class="retry"
			data-testid="batch-item-retry"
			@click="$emit('retry')"
		>
			{{ $t('retry') }}
		</VButton>
	</div>
</template>

<style lang="scss" scoped>
.batch-item-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border-block-end: var(--theme--border-width) solid var(--theme--border-color-subdued);

	.status-icon {
		flex-shrink: 0;

		&.saved {
			--v-icon-color: var(--theme--success);
		}

		&.error {
			--v-icon-color: var(--theme--danger);
		}

		&.pending {
			--v-icon-color: var(--theme--foreground-subdued);
		}
	}

	.item-key {
		font-family: var(--theme--fonts--monospace--font-family);
		color: var(--theme--foreground);
	}

	.retry {
		margin-inline-start: auto;
	}
}
</style>
