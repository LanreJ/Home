// filepath: /workspaces/Home/cypress/integration/upload_spec.js
describe('Document Upload', () => {
  it('Uploads a document and processes it', () => {
    cy.visit('/upload.html');

    cy.get('input[type="file"]').attachFile('sample-tax-document.pdf');
    cy.get('input[name="userId"]').type('testUserId');
    cy.get('button[type="submit"]').click();

    cy.contains('File uploaded and processed successfully.').should('be.visible');
  });
});