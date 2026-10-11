import type { ApiErrorWording } from '../../core/http/api-error';

/** How the campaigns screens word the API's refusals. */
export const CAMPAIGN_ERROR_WORDING: ApiErrorWording = {
  codes: {
    CAMPAIGN_NO_RECIPIENTS: 'admin.campaigns.errors.noRecipients',
    CAMPAIGN_IN_PROGRESS: 'admin.campaigns.errors.inProgress',
    CAMPAIGN_NOT_SENDABLE: 'admin.campaigns.errors.notSendable',
    CAMPAIGN_NOT_EDITABLE: 'admin.campaigns.errors.notEditable',
    CAMPAIGN_NOT_SUBMITTABLE: 'admin.campaigns.errors.notSubmittable',
    CAMPAIGN_NOT_DELETABLE: 'admin.campaigns.errors.notDeletable',
    CAMPAIGN_NOT_PENDING: 'admin.campaigns.errors.notPending',
    CAMPAIGN_SCHEDULED_IN_PAST: 'admin.campaigns.errors.scheduledInPast',
  },
  messages: {
    'SUPER_ADMIN must pass ?brandId=': 'admin.campaigns.noBrand',
  },
  network: 'common.networkError',
};
