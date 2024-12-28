class ErrorHandler {
    ...existing code...

    async logError(errorRecord, submissionId) {
        const severity = this.calculateSeverity(errorRecord);
        
        await this.db.collection('error_logs').add({
            ...errorRecord,
            submissionId,
            severity,
            environment: process.env.NODE_ENV,
            createdAt: new Date(),
            metadata: {
                retryable: this.isRetryableError(errorRecord),
                serviceVersion: process.env.SERVICE_VERSION
            }
        });

        if (severity === 'HIGH') {
            await this.notifier.alertAdmin({
                type: 'CRITICAL_ERROR',
                submissionId,
                error: errorRecord
            });
        }
    }

    calculateSeverity(error) {
        if (error.code >= 500) return 'HIGH';
        if (error.code >= 400) return 'MEDIUM';
        return 'LOW';
    }

    async createAuditTrail(submissionId, action, details) {
        await this.db.collection('audit_trails').add({
            submissionId,
            action,
            details,
            timestamp: new Date(),
            userId: this.getCurrentUser()
        });
    }

    getCurrentUser() {
        return process.env.FIREBASE_AUTH_UID || 'system';
    }
}

module.exports = ErrorHandler;