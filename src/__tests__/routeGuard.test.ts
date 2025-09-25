import { routeTarget } from '../navigation/routeGuard';

describe('routeTarget', () => {
  it('loading -> loading', () => {
    expect(routeTarget({ loading:true, user:null, venueId:null })).toBe('loading');
  });
  it('no user -> auth', () => {
    expect(routeTarget({ loading:false, user:null, venueId:null })).toBe('auth');
  });
  it('user, no venue -> setup', () => {
    expect(routeTarget({ loading:false, user:{ uid:'u' }, venueId:null })).toBe('setup');
  });
  it('user with venue -> main', () => {
    expect(routeTarget({ loading:false, user:{ uid:'u' }, venueId:'v_123' })).toBe('main');
  });
});
