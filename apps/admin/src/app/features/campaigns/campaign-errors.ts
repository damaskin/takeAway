import type { ApiErrorWording } from '../../core/http/api-error';

/** How the campaigns screens word the API's refusals. */
export const CAMPAIGN_ERROR_WORDING: ApiErrorWording = {
  codes: {
    CAMPAIGN_NO_RECIPIENTS: 'admin.campaigns.errors.noRecipients',
    CAMPAIGN_IN_PROGRESS: 'admin.campaigns.errors.inProgress',
    CAMPAIGN_NOT_SENDABLE: 'admin.campaigns.errors.notSendable',
  },
  messages: {
    'SUPER_ADMIN must pass ?brandId=': 'admin.campaigns.noBrand',
  },
  network: 'common.networkError',
};
