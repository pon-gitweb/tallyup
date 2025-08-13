import { path } from 'src/services/firestorePaths';

describe('firestorePaths', () => {
  it('builds item path correctly', () => {
    expect(path.item('v','d','a','i')).toBe('venues/v/departments/d/areas/a/items/i');
  });
});
