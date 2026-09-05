import { contentSecurityPolicyDirectives } from './security-headers';

describe('Content security policy', () => {
  it('allows authenticated WhatsApp audio and video object URLs', () => {
    expect(contentSecurityPolicyDirectives.mediaSrc).toContain('blob:');
  });
});
