import type { ApiErrorWording } from '../../core/http/api-error';

/** How the announcement screens word the API's refusals. */
export const ANNOUNCEMENT_ERROR_WORDING: ApiErrorWording = {
  codes: {
    ANNOUNCEMENT_NO_RECIPIENTS: 'admin.announcements.errors.noRecipients',
    ANNOUNCEMENT_IN_PROGRESS: 'admin.announcements.errors.inProgress',
    ANNOUNCEMENT_NOT_SENDABLE: 'admin.announcements.errors.notSendable',
    ANNOUNCEMENT_NOT_EDITABLE: 'admin.announcements.errors.notEditable',
    ANNOUNCEMENT_NOT_SCHEDULED: 'admin.announcements.errors.notScheduled',
    ANNOUNCEMENT_NOT_DELETABLE: 'admin.announcements.errors.notDeletable',
    ANNOUNCEMENT_SCHEDULED_IN_PAST: 'admin.announcements.errors.scheduledInPast',
    ANNOUNCEMENT_LINK_INVALID: 'admin.announcements.errors.linkInvalid',
  },
  network: 'common.networkError',
};
