import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_SITE_ID,
} from './multisite.constants';

export type PublicSiteContext = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isDefault: boolean;
  whatsappAccount: {
    active: boolean;
    displayPhoneNumber: string | null;
  } | null;
};

/**
 * Resuelve una sede pública por su código estable. La ausencia del código
 * conserva el enlace histórico de la sede principal; un código inválido jamás
 * cae silenciosamente en la principal.
 */
export async function resolvePublicSite(
  prisma: PrismaService,
  siteCode?: string | null,
): Promise<PublicSiteContext> {
  const code = String(siteCode || '')
    .trim()
    .toLowerCase();

  const site = await prisma.site.findFirst({
    where: code
      ? {
          organizationId: DEFAULT_ORGANIZATION_ID,
          code,
          active: true,
          organization: { active: true },
        }
      : {
          id: DEFAULT_SITE_ID,
          active: true,
          organization: { active: true },
        },
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      phone: true,
      isDefault: true,
      whatsappAccount: {
        select: { active: true, displayPhoneNumber: true },
      },
    },
  });

  if (!site) {
    throw new NotFoundException('La sede solicitada no está disponible');
  }
  return site;
}
