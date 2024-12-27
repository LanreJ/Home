const admin = require('firebase-admin');

class SubmissionTracker {
    constructor() {
        this.db = admin.firestore();
        this.collection = 'hmrc_submissions';
    }

    async trackSubmission(data) {
        const ref = await this.db.collection(this.collection).add({
            ...data,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'PENDING',
            attempts: 1
        });
        return ref.id;
    }

    async updateStatus(submissionId, status, details = {}) {
        await this.db.collection(this.collection).doc(submissionId).update({
            status,
            ...details,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    async getSubmissionStatus(submissionId) {
        const doc = await this.db.collection(this.collection).doc(submissionId).get();
        return doc.data();
    }
}

module.exports = SubmissionTracker;