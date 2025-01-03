// filepath: /workspaces/Home/cypress/integration/upload_spec.js
describe('Document Upload', () => {
  it('Uploads a document and processes it', () => {
    cy.visit('/index.html');

    cy.get('#document-file').attachFile('sample-tax-document.pdf');
    cy.get('#user-id').type('testUserId');
    cy.get('button[type="submit"]').click();

    cy.get('#upload-status').should('contain.text', 'File uploaded and processing initiated.');
  });
});