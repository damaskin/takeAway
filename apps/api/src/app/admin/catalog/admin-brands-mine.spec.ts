import type { PasswordService } from '../../auth/services/password.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminCatalogService } from './admin-catalog.service';

/** GET /admin/brands/mine feeds the admin shell, which shows the owner where moderation stands. */
describe('AdminCatalogService.listBrandsForScope', () => {
  it('returns each brand with its moderation state, restricted to the scope', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new AdminCatalogService({ brand: { findMany } } as unknown as PrismaService, {} as PasswordService);

    await svc.listBrandsForScope(['b1']);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['b1'] } },
        select: expect.objectContaining({ moderationStatus: true, moderationNote: true, submittedAt: true }),
      }),
    );
  });
});
