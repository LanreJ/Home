import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';
import path from 'path';

export class StorageService {
    constructor() {
        this.storage = getStorage();
        this.db = getFirestore();
        this.bucket = this.storage.bucket();
    }

    async uploadDocument(file, userId, taxYear, metadata = {}) {
        try {
            const filename = this.generateSecureFilename(file.originalname);