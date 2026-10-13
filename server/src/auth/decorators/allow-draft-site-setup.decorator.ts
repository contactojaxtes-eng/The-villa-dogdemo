import { SetMetadata } from '@nestjs/common';

export const ALLOW_DRAFT_SITE_SETUP_KEY = 'allow_draft_site_setup';

export const AllowDraftSiteSetup = () =>
  SetMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, true);
