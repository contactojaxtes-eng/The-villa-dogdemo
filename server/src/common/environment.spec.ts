import { isAllowedOrigin } from './environment';

describe('Exact browser origins', () => {
  const oldEnv = { ...process.env };
  afterEach(() => { process.env = { ...oldEnv }; });
  it('rejects suffix spoofing, wildcard and missing production configuration', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://restaurant.example';
    expect(isAllowedOrigin('https://restaurant.example')).toBe(true);
    expect(isAllowedOrigin('https://evilrestaurant.example')).toBe(false);
    process.env.ALLOWED_ORIGINS = '*';
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    delete process.env.ALLOWED_ORIGINS;
    expect(isAllowedOrigin('http://localhost:5173')).toBe(false);
  });
});
