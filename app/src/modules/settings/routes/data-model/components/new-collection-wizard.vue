<script setup lang="ts">
import { computed } from 'vue';
import VButton from '@/components/v-button.vue';

interface WizardStep {
	id: string;
	label: string;
}

const props = withDefaults(
	defineProps<{
		/** Ordered steps; each `id` is also the name of the slot rendered for that step. */
		steps: WizardStep[];
		/** Active step index (v-model). */
		modelValue: number;
		/** Whether the current step is complete enough to advance via Next. */
		canAdvance?: boolean;
		/** Disables Submit and shows its loading state during the final request. */
		submitting?: boolean;
	}>(),
	{
		canAdvance: true,
		submitting: false,
	},
);

const emit = defineEmits<{
	(e: 'update:modelValue', value: number): void;
	(e: 'submit'): void;
}>();

const isFirstStep = computed(() => props.modelValue <= 0);
const isLastStep = computed(() => props.modelValue >= props.steps.length - 1);
const currentStepId = computed(() => props.steps[props.modelValue]?.id);

function back() {
	if (isFirstStep.value) return;
	emit('update:modelValue', props.modelValue - 1);
}

function next() {
	if (isLastStep.value || !props.canAdvance) return;
	emit('update:modelValue', props.modelValue + 1);
}

function submit() {
	if (props.submitting) return;
	emit('submit');
}
</script>

<template>
	<div class="new-collection-wizard">
		<ol class="step-indicator" data-testid="wizard-step-indicator">
			<li
				v-for="(step, index) in steps"
				:key="step.id"
				class="step"
				data-testid="wizard-step"
				:data-step-id="step.id"
				:data-active="index === modelValue ? 'true' : 'false'"
				:data-complete="index < modelValue ? 'true' : 'false'"
			>
				<span class="step-number">{{ index + 1 }}</span>
				<span class="step-label">{{ step.label }}</span>
			</li>
		</ol>

		<div class="step-content">
			<slot :name="currentStepId" />
		</div>

		<div class="wizard-actions">
			<VButton v-if="!isFirstStep" secondary data-testid="wizard-back-btn" @click="back">
				{{ $t('back') }}
			</VButton>

			<div class="spacer" />

			<VButton v-if="!isLastStep" data-testid="wizard-next-btn" :disabled="!canAdvance" @click="next">
				{{ $t('next') }}
			</VButton>

			<VButton v-else data-testid="wizard-submit-btn" :loading="submitting" @click="submit">
				{{ $t('finish_setup') }}
			</VButton>
		</div>
	</div>
</template>

<style lang="scss" scoped>
.step-indicator {
	display: flex;
	gap: 8px;
	margin: 0 0 2rem;
	padding: 0;
	list-style: none;
}

.step {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	color: var(--theme--foreground-subdued);
	background-color: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);

	.step-number {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.5em;
		block-size: 1.5em;
		color: var(--theme--foreground-subdued);
		background-color: var(--theme--background-normal);
		border-radius: 50%;
		font-size: 0.85em;
	}

	&[data-complete='true'] {
		color: var(--theme--foreground);

		.step-number {
			color: var(--white);
			background-color: var(--theme--primary);
		}
	}

	&[data-active='true'] {
		color: var(--theme--foreground);
		background-color: var(--theme--primary-background);

		.step-number {
			color: var(--white);
			background-color: var(--theme--primary);
		}
	}
}

.wizard-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-block-start: 2rem;
}

.spacer {
	flex-grow: 1;
}
</style>
