import { mount } from 'cypress/angular-zoneless';

Cypress.Commands.add('mount', mount);

beforeEach(() => {
  cy.window().should('not.have.property', 'Zone');
});

afterEach(() => {
  cy.window().should('not.have.property', 'Zone');
});

declare global {
  namespace Cypress {
    interface Chainable {
      mount: typeof mount;
    }
  }
}
