// The live replay suite deliberately has no global API intercepts or Keycloak stubs.
Cypress.on('uncaught:exception', (error) => {
  if (error.message.includes('ResizeObserver loop')) {
    return false;
  }
  return true;
});
