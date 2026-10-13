import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSiteMemberDto } from './update-site-member.dto';

describe('UpdateSiteMemberDto', () => {
  it('normalizes a valid site role', async () => {
    const dto = plainToInstance(UpdateSiteMemberDto, {
      active: true,
      role: ' cashier ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.role).toBe('CASHIER');
  });

  it('rejects SUPERADMIN regardless of casing or surrounding whitespace', async () => {
    const dto = plainToInstance(UpdateSiteMemberDto, {
      active: true,
      role: ' superAdmin ',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([
      expect.objectContaining({
        property: 'role',
        constraints: expect.objectContaining({ isNotIn: expect.any(String) }),
      }),
    ]);
  });
});
