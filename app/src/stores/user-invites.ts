import { nanoid } from 'nanoid';
import { defineStore } from 'pinia';

export interface PendingInvite {
	/** Local-only id used to correlate optimistic rows with their server reconcile/revert. */
	id: string;
	email: string;
	role: string | undefined;
}

/**
 * Thin store holding the optimistic "pending invitee" rows for the user-invite flow (DR-UC01).
 *
 * The invite dialog adds one pending row per valid email before the server responds, then either
 * reconciles (on 2xx, the real user rows arrive via a list refresh) or reverts (on 4xx/5xx) them.
 */
export const useUserInvitesStore = defineStore({
	id: 'userInvitesStore',
	state: () => ({
		pending: [] as PendingInvite[],
	}),
	actions: {
		/** Optimistically add one pending row per email. Returns the local ids so the caller can later reconcile or revert exactly these rows. */
		add(emails: string[], role: string | undefined): string[] {
			const added: PendingInvite[] = emails.map((email) => ({ id: nanoid(), email, role }));
			this.pending = [...this.pending, ...added];
			return added.map((invite) => invite.id);
		},
		/** On success: drop the pending rows. The confirmed users hydrate into the real list via a refresh. */
		reconcile(ids: string[]) {
			this.pending = this.pending.filter((invite) => !ids.includes(invite.id));
		},
		/** On failure: drop the pending rows so the optimistic projection disappears. */
		revert(ids: string[]) {
			this.pending = this.pending.filter((invite) => !ids.includes(invite.id));
		},
		/** Clear everything (e.g. when leaving the view). */
		clear() {
			this.pending = [];
		},
	},
});
