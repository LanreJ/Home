// filepath: /workspaces/Home/functions/jest.setup.cjs
import '@testing-library/jest-dom';

const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost'
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.fetch = jest.fn();
global.FormData = jest.fn();

jest.mock('firebase/app', () => ({
    initializeApp: jest.fn(),
    getAuth: jest.fn()
}));

jest.mock('firebase/firestore', () => ({
    getFirestore: jest.fn()
}));