import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SERVER_URL } from '../../apps/frontend/src/app/injection-tokens';
import { AppService } from '../../apps/frontend/src/app/services/app.service';
import { BackendService } from '../../apps/frontend/src/app/services/backend.service';
import { TestResultService } from '../../apps/frontend/src/app/services/test-result.service';
import { TestResultsFlatTableComponent } from '../../apps/frontend/src/app/ws-admin/components/test-results/test-results-flat-table.component';

class AppServiceMock {
  selectedWorkspaceId = 9;
}

describe('TestResultsFlatTableComponent', () => {
  it('requests flat responses via /test-results/flat-responses', () => {
    cy.window().then(win => {
      win.localStorage.setItem('id_token', 'ct-dummy-token');
    });

    cy.intercept('GET', '**/admin/workspace/**/test-results/flat-responses*', req => {
      expect(req.url).to.contain('/admin/workspace/9/test-results/flat-responses');
      req.reply({
        statusCode: 200,
        body: {
          data: [
            {
              responseId: 123,
              unitId: 456,
              personId: 789,
              code: 'P001',
              group: 'G1',
              login: 'user1',
              booklet: 'B1',
              unit: 'U1',
              response: 'VAR_1',
              responseStatus: 'VALUE_CHANGED',
              responseValue: '42',
              tags: ['tag-a']
            }
          ],
          total: 1,
          page: 1,
          limit: 50
        }
      });
    }).as('flatResponses');

    cy.mount(TestResultsFlatTableComponent, {
      providers: [
        provideHttpClient(),
        provideNoopAnimations(),
        TestResultService,
        { provide: SERVER_URL, useValue: '/api/' },
        { provide: AppService, useClass: AppServiceMock },
        { provide: BackendService, useValue: {} },
        {
          provide: MatSnackBar,
          useValue: {
            open: () => ({ dismiss: () => {} })
          }
        },
        {
          provide: MatDialog,
          useValue: {
            open: () => ({ afterClosed: () => ({ subscribe: () => {} }) })
          }
        }
      ]
    });

    cy.wait('@flatResponses', { timeout: 20000 });
    cy.contains('P001');
    cy.contains('VAR_1');
  });
});
