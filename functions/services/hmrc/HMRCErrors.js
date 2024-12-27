class HMRCError extends Error {
    constructor(message, code, correlationId) {
        super(message);
        this.name = 'HMRCError';
        this.code = code;
        this.correlationId = correlationId;
        this.timestamp = new Date();
    }
}

module.exports = HMRCError;