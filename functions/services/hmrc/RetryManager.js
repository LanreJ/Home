class RetryManager {
    constructor(maxRetries = 3) {
        this.maxRetries = maxRetries;
        this.baseDelay = 5000; // 5 seconds
    }

    calculateBackoff(attempt) {
        return Math.min(
            this.baseDelay * Math.pow(2, attempt),
            300000 // Max 5 minutes
        );
    }

    async retry(operation, context) {
        let lastError;
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (!this.isRetryable(error)) {
                    throw error;
                }
                await this.delay(this.calculateBackoff(attempt));
            }
        }
        throw lastError;
    }

    isRetryable(error) {
        return ['TIMEOUT', 'RATE_LIMIT', 'SERVER_ERROR'].includes(error.code);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}