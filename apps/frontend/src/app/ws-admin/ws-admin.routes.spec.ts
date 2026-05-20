import { type Route } from '@angular/router';
import { wsAdminRoutes } from './ws-admin.routes';

describe('wsAdminRoutes', () => {
  const rootRoute = wsAdminRoutes.find(route => route.path === 'workspace-admin/:ws');

  function childRoute(path: string): Route | undefined {
    return rootRoute?.children?.find(route => route.path === path);
  }

  function codingChildRoute(path: string): Route | undefined {
    return childRoute('coding')?.children?.find(route => route.path === path);
  }

  function expectGuarded(route: Route | undefined): void {
    expect(route).toBeDefined();
    expect(route?.canActivate?.length).toBeGreaterThan(0);
  }

  it('guards workspace-level admin routes individually', () => {
    expectGuarded(childRoute('test-files'));
    expectGuarded(childRoute('test-results'));
    expectGuarded(childRoute('users'));
    expectGuarded(childRoute('cleaning'));
    expectGuarded(childRoute('export'));
    expectGuarded(childRoute('settings'));
  });

  it('guards coding management routes separately from my coding jobs', () => {
    expectGuarded(codingChildRoute('management'));
    expectGuarded(codingChildRoute('statistics'));
    expectGuarded(codingChildRoute('manual'));
    expectGuarded(codingChildRoute('export'));
    expectGuarded(codingChildRoute('my-jobs'));
  });
});
