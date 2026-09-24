import { join } from 'path';
import { isImmutableViteAsset } from './app.module';

describe('static asset cache policy', () => {
  it('only marks hashed Vite assets as immutable', () => {
    const dist = join(__dirname, '..', '..', 'client', 'dist');

    expect(isImmutableViteAsset(join(dist, 'assets', 'index-DRGAOwv5.js'))).toBe(true);
    expect(isImmutableViteAsset(join(dist, 'assets', 'index-DSblnnad.css'))).toBe(true);
    expect(isImmutableViteAsset(join(dist, 'assets', 'index.js'))).toBe(false);
    expect(isImmutableViteAsset(join(dist, 'index.html'))).toBe(false);
    expect(isImmutableViteAsset(join(dist, 'config.json'))).toBe(false);
    expect(isImmutableViteAsset(join(dist, 'TheVillaDogBridge.exe'))).toBe(false);
  });
});
