class StatusPoller {
    constructor(hmrcService, tracker) {
        this.hmrcService = hmrcService;
        this.tracker = tracker;
        this.pollInterval = 30000; // 30 seconds
        this.maxAttempts = 20; // 10 minutes total
    }

    async startPolling(submissionId) {
        let attempts = 0;
        while (attempts < this.maxAttempts) {
            const status = await this.hmrcService.checkSubmissionStatus(submissionId);
            await this.tracker.updateStatus(submissionId, status.state, {
                lastChecked: new Date(),
                details: status.details
            });

            if (this.isTerminalState(status.state)) {
                return status;
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        }
        throw new Error('Polling timeout exceeded');
    }

    isTerminalState(state) {
        return ['ACCEPTED', 'REJECTED', 'FAILED'].includes(state);
    }
}