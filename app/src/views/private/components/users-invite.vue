<script setup lang="ts">
import { Role } from '@directus/types';
import { computed, ref, watch } from 'vue';
import api from '@/api';
import VButton from '@/components/v-button.vue';
import VCardActions from '@/components/v-card-actions.vue';
import VCardText from '@/components/v-card-text.vue';
import VCardTitle from '@/components/v-card-title.vue';
import VCard from '@/components/v-card.vue';
import VDialog from '@/components/v-dialog.vue';
import VNotice from '@/components/v-notice.vue';
import VSelect from '@/components/v-select/v-select.vue';
import VTextarea from '@/components/v-textarea.vue';
import { useUserInvitesStore } from '@/stores/user-invites';
import { APIError } from '@/types/error';
import { unexpectedError } from '@/utils/unexpected-error';

const props = defineProps<{
	modelValue: boolean;
	role?: string;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void;
}>();

const userInvitesStore = useUserInvitesStore();

// Matches a single email: non-space/@ local part, @, non-space/@ domain, dot, TLD.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emails = ref<string>('');
const roles = ref<Record<string, any>[]>([]);
const roleSelected = ref<string | undefined>(props.role);
const loading = ref(false);
const emailsBlurred = ref(false);

const uniqueValidationErrors = ref<APIError[]>([]);

/** Each non-empty, trimmed entry parsed from the textarea (comma or newline separated). */
const parsedEmails = computed(() =>
	emails.value
		.split(/,|\n/)
		.map((email) => email.trim())
		.filter((email) => email),
);

const validEmails = computed(() => parsedEmails.value.filter((email) => EMAIL_REGEX.test(email)));
const invalidEmails = computed(() => parsedEmails.value.filter((email) => !EMAIL_REGEX.test(email)));

/** Client-side validation message, surfaced only once the field has been blurred. */
const clientValidationError = computed(() => {
	if (!emailsBlurred.value || invalidEmails.value.length === 0) return null;
	return invalidEmails.value;
});

const hasInlineError = computed(
	() => uniqueValidationErrors.value.length > 0 || clientValidationError.value !== null,
);

// Send is gated: at least one valid email AND a role must be present.
const canSend = computed(() => validEmails.value.length > 0 && !!roleSelected.value);

watch(
	() => props.modelValue,
	(active) => {
		if (active) {
			loadRoles();
		} else {
			resetForm();
		}
	},
);

// Clear the blur-driven client error as soon as the input becomes valid again.
watch(parsedEmails, () => {
	if (invalidEmails.value.length === 0) emailsBlurred.value = false;
});

function onEmailsBlur() {
	emailsBlurred.value = true;
}

function resetForm() {
	emails.value = '';
	emailsBlurred.value = false;
	uniqueValidationErrors.value = [];
	loading.value = false;
}

async function inviteUsers() {
	if (!canSend.value || loading.value) return;

	loading.value = true;
	uniqueValidationErrors.value = [];

	const emailsToInvite = validEmails.value;

	// Optimistic: show pending rows before the server responds (DR-UC01-A1).
	const pendingIds = userInvitesStore.add(emailsToInvite, roleSelected.value);

	try {
		await api.post('/users/invite', {
			email: emailsToInvite,
			role: roleSelected.value,
		});

		// 2xx: real rows hydrate via the list refresh, so drop the pending projection (A2).
		userInvitesStore.reconcile(pendingIds);
		emails.value = '';
		emit('update:modelValue', false);
	} catch (error: any) {
		// 4xx/5xx: remove the optimistic rows and keep the dialog open with the error (A3).
		userInvitesStore.revert(pendingIds);

		uniqueValidationErrors.value =
			error?.response?.data?.errors?.filter((e: APIError) => e.extensions?.code === 'RECORD_NOT_UNIQUE') ?? [];

		const otherErrors =
			error?.response?.data?.errors?.filter((e: APIError) => e?.extensions?.code !== 'RECORD_NOT_UNIQUE') ?? [];

		if (otherErrors.length > 0) {
			otherErrors.forEach((e: APIError) => unexpectedError(e));
		}
	} finally {
		loading.value = false;
	}
}

async function loadRoles() {
	const response = await api.get<{ data: Pick<Role, 'id' | 'name'>[] }>('/roles', {
		params: {
			sort: 'name',
			fields: ['id', 'name'],
		},
	});

	roles.value = response.data.data.map((role) => ({
		text: role.name,
		value: role.id,
	}));

	if (roles.value.length > 0 && !roleSelected.value) {
		roleSelected.value = roles.value[0]?.value;
	}
}
</script>

<template>
	<VDialog
		:model-value="modelValue"
		@update:model-value="$emit('update:modelValue', $event)"
		@esc="$emit('update:modelValue', false)"
		@apply="inviteUsers"
	>
		<VCard>
			<VCardTitle>{{ $t('invite_users') }}</VCardTitle>

			<VCardText>
				<div class="grid">
					<!-- testid lives on the field wrapper: VTextarea re-binds $attrs onto its inner
					     textarea while inheritAttrs also copies them to its root, so a hook placed on
					     the component itself would match twice. The wrapper is a single, stable target. -->
					<div class="field" data-testid="user-invite-email">
						<div class="type-label">{{ $t('emails') }}</div>
						<VTextarea
							v-model="emails"
							autofocus
							:nullable="false"
							placeholder="admin@example.com, user@example.com..."
							@blur="onEmailsBlur"
						/>
					</div>
					<div v-if="!role" class="field" data-testid="user-invite-role">
						<div class="type-label">{{ $t('role') }}</div>
						<VSelect v-model="roleSelected" :items="roles" />
					</div>
					<VNotice v-if="hasInlineError" class="field" type="danger" data-testid="user-invite-error">
						<div class="error-list">
							<template v-if="clientValidationError">
								<div v-for="(invalid, i) in clientValidationError" :key="`client-${i}`">
									{{ invalid }}: {{ $t('validationError.email') }}
								</div>
							</template>
							<div v-for="(err, i) in uniqueValidationErrors" :key="`server-${i}`">
								<template v-if="(err as any).extensions.invalid">
									{{ $t('email_already_invited', { email: (err as any).extensions.invalid }) }}
								</template>
								<template v-else-if="i === 0">
									{{ $t('validationError.unique') }}
								</template>
							</div>
						</div>
					</VNotice>
				</div>
			</VCardText>

			<VCardActions>
				<VButton secondary @click="$emit('update:modelValue', false)">{{ $t('cancel') }}</VButton>
				<VButton :disabled="!canSend" :loading="loading" data-testid="user-invite-send" @click="inviteUsers">
					{{ $t('invite') }}
				</VButton>
			</VCardActions>
		</VCard>
	</VDialog>
</template>

<style lang="scss" scoped>
@use '@/styles/mixins';

.grid {
	--theme--form--row-gap: 1.125rem;

	@include mixins.form-grid;
}

.v-card-title {
	font-size: 1.125rem;
}

.error-list > div + div {
	margin-block-start: 4px;
}
</style>
