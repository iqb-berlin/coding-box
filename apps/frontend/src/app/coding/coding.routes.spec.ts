import { codingRoutes } from './coding.routes';
import { canActivatePersonalCodingJobs } from '../core/guards/personal-coding-jobs.guard';

describe('codingRoutes', () => {
  it('guards the legacy personal coding jobs route with the admin-aware guard', () => {
    const codingRoute = codingRoutes.find(route => route.path === 'coding');

    expect(codingRoute).toBeDefined();
    expect(codingRoute?.canActivate).toContain(canActivatePersonalCodingJobs);
  });
});
