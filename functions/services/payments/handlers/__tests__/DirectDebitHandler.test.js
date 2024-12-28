const DirectDebitHandler = require('../DirectDebitHandler');
const { getMockDb } = require('../../__mocks__/firestore');

describe('DirectDebitHandler', () => {
    let handler;
    let mockDb;

    beforeEach(() => {
        mockDb = getMockDb();
        handler = new DirectDebitHandler(mockDb);
    });

    describe('validation', () => {
        test('should validate sort code format', () => {
            expect(handler.isValidSortCode('12-34-56')).toBe(true);
            expect(handler.isValidSortCode('123456')).toBe(false);
            expect(handler.isValidSortCode('12d-3-456')).toBe(false);
        });

        test('should validate account number format', () => {
            expect(handler.isValidAccountNumber('12345678')).toBe(true);
            expect(handler.isValidAccountNumber('1234567')).toBe(false);
            expect(handler.isValidAccountNumber('123456789')).toBe(false);
        });
    });

    describe('account validation', () => {
        test('should validate account number format', () => {
            expect(handler.isValidAccountNumber('12345678')).toBe(true);
            expect(handler.isValidAccountNumber('1234567')).toBe(false);
            expect(handler.isValidAccountNumber('123456789')).toBe(false);
        });

        test('should validate bank details', async () => {
            const validDetails = {
                accountNumber: '12345678',
                sortCode: '12-34-56',e
                amount: 100
            };

            const validation = await handler.validateBankDetails(validDetails);
            expect(validation.isValid).toBe(true);
        });
    });

    describe('mandate management', () => {
        test('should create new mandate when none exists', async () => {
            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100
            };
            
            const mandate = await handler.createMandate(payment);
            
            expect(mandate.id).toBeDefined();
            expect(mandate.status).toBe('ACTIVE');
            expect(mandate.accountNumber).toBe(payment.accountNumber);
        });

        test('should create new mandate for valid bank details', async () => {
            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100
            };

            const mandate = await handler.createMandate(payment);
            expect(mandate).toEqual(expect.objectContaining({
                accountNumber: payment.accountNumber, 
                sortCode: payment.sortCode,
                status: 'ACTIVE',
                isActive: true
            }));
        });

        test('should find existing mandate', async () => {
            const existingMandate = {
                id: 'test-mandate-id',
                accountNumber: '12345678',
                sortCode: '12-34-56',
                status: 'ACTIVE'
            };

            mockDb.collection('mandates').doc(existingMandate.id).set(existingMandate);

            const found = await handler.findMandate({
                accountNumber: existingMandate.accountNumber,
                sortCode: existingMandate.sortCode
            });

            expect(found.id).toBe(existingMandate.id);
        });
    });

    describe('bank details validation', () => {
        test('should validate complete bank details', async () => {
            const validDetails = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100
            };

            const validation = await handler.validateBankDetails(validDetails);
            expect(validation.isValid).toBe(true);
            expect(validation.errors).toHaveLength(0);
        });

        test('should reject invalid bank details', async () => {
            const invalidDetails = {
                accountNumber: '1234567',  // Too short
                sortCode: '12-345-6',      // Invalid format
                amount: 100
            };

            const validation = await handler.validateBankDetails(invalidDetails);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Invalid account number format');
            expect(validation.errors).toContain('Invalid sort code format');
        });

        test('should handle bank verification service errors', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue(
                new Error('Service unavailable')
            );

            const details = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100
            };

            const validation = await handler.validateBankDetails(details);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Bank account validation failed');
        });

        test('should handle missing required fields', async () => {
            const invalidDetails = {
                accountNumber: '12345678'
                // Missing sortCode
            };

            const validation = await handler.validateBankDetails(invalidDetails);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Missing required field: sortCode');
        });

        test('should handle bank verification timeout', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue(
                new Error('Request timeout')
            );

            const details = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100
            };

            const validation = await handler.validateBankDetails(details);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Bank verification service unavailable');
        });

        test('should respect rate limits', async () => {
            // Simulate rate limit exceeded
            mockDb.bankVerificationService.verify.mockRejectedValue({
                code: 429,
                message: 'Too many requests'
            });

            const details = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100
            };

            const validation = await handler.validateBankDetails(details);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Service temporarily unavailable');
        });
    });

    describe('payment processing', () => {
        test('should process valid payment', async () => {
            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-001'
            };

            const result = await handler.process(payment);
            expect(result.status).toBe('SUCCESS');
            expect(result.transactionId).toBeDefined();
            expect(result.details.amount).toBe(payment.amount);
        });

        test('should handle payment limits', async () => {
            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 1000000,  // Exceeds limit
                reference: 'TEST-002'
            };

            await expect(handler.process(payment))
                .rejects
                .toThrow('Amount exceeds payment limit');
        });

        test('should track payment status', async () => {
            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-003'
            };

            const result = await handler.process(payment);
            const status = await handler.getPaymentStatus(result.transactionId);
            
            expect(status.status).toBe('COMPLETED');
            expect(status.timestamp).toBeDefined();
        });
    });

    describe('error handling', () => {
        test('should handle service unavailable', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue(
                new Error('Service Unavailable')
            );

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-ERR-001'
            };

            await expect(handler.process(payment))
                .rejects
                .toThrow('Bank verification service unavailable');
        });

        test('should handle payment timeout', async () => {
            mockDb.processPayment.mockRejectedValue(
                new Error('Request timeout')
            );

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-ERR-002'
            };

            const result = await handler.process(payment).catch(error => error);
            expect(result.message).toBe('Payment processing timeout');
            expect(result.retryable).toBe(true);
            
            const errorLog = await mockDb.collection('payment_errors').get();
            expect(errorLog.docs[0].data()).toMatchObject({
                type: 'TIMEOUT',
                severity: handler.errorSeverity.HIGH,
                retryable: true
            });
        });

        test('should handle rate limiting', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue({
                code: 429,
                message: 'Rate limit exceeded'
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-ERR-002'
            };

            const result = await handler.process(payment);
            expect(result.status).toBe('RETRY_SCHEDULED');
            expect(result.nextAttempt).toBeDefined();
        });

        test('should notify admin on critical errors', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue({
                code: 500,
                message: 'Internal Server Error'
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-ERR-003'
            };

            await handler.process(payment);
            expect(mockDb.collection('admin_notifications')).toHaveBeenCalled();
        });

        test('should implement retry mechanism', async () => {
            let attempts = 0;
            mockDb.processPayment.mockImplementation(() => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('Request timeout');
                }
                return { success: true };
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-ERR-003'
            };

            const result = await handler.process(payment);
            expect(result.status).toBe('SUCCESS');
            expect(attempts).toBe(3);
        });
    });

    describe('retry mechanism', () => {
        test('should implement exponential backoff', async () => {
            let attempts = 0;
            const retryDelays = [];
            
            mockDb.processPayment.mockImplementation(async () => {
                attempts++;
                const delay = await handler.calculateBackoff(attempts);
                retryDelays.push(delay);
                if (attempts < 3) throw new Error('Temporary failure');
                return { success: true };
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-RETRY-001'
            };

            const result = await handler.process(payment);
            
            expect(result.status).toBe('SUCCESS');
            expect(attempts).toBe(3);
            expect(retryDelays[1]).toBeGreaterThan(retryDelays[0]);
            expect(retryDelays[2]).toBeGreaterThan(retryDelays[1]);
            
            const errorLogs = await mockDb.collection('payment_errors').get();
            expect(errorLogs.docs).toHaveLength(2); // Two failed attempts logged
        });
    });

    describe('rate limiting and recovery', () => {
        test('should handle rate limiting', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue({
                code: 429,
                message: 'Rate limit exceeded'
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-RATE-001'
            };

            const result = await handler.process(payment);
            expect(result.status).toBe('RETRY_SCHEDULED');
            expect(result.retryAfter).toBeGreaterThan(0);
            expect(result.nextAttempt).toBeDefined();
        });

        test('should implement exponential backoff', async () => {
            const attempts = [];
            for (let i = 0; i < 3; i++) {
                const result = await handler.calculateRetryDelay(i + 1);
                attempts.push(result);
            }

            expect(attempts[1]).toBeGreaterThan(attempts[0]);
            expect(attempts[2]).toBeGreaterThan(attempts[1]);
        });

        test('should notify admin after max retries', async () => {
            mockDb.getRetryCount.mockResolvedValue(3);
            
            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-RETRY-001'
            };

            await handler.process(payment);
            
            expect(mockDb.collection('admin_notifications'))
                .toHaveBeenCalledWith(expect.objectContaining({
                    type: 'MAX_RETRIES_EXCEEDED',
                    severity: 'HIGH'
                }));
        });

        test('should handle rate limiting', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue({
                code: 429,
                message: 'Rate limit exceeded'
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-RATE-001'
            };

            const result = await handler.process(payment);
            expect(result.status).toBe('RETRY_SCHEDULED');
            expect(result.retryAfter).toBeGreaterThan(0);

            const rateLimitLog = await mockDb.collection('rate_limit_logs').get();
            expect(rateLimitLog.docs[0].data()).toMatchObject({
                type: 'RATE_LIMIT',
                retryScheduled: true,
                nextAttempt: expect.any(Date)
            });
        });

        test('should recover after rate limit cooldown', async () => {
            let attempts = 0;
            mockDb.bankVerificationService.verify.mockImplementation(() => {
                attempts++;
                if (attempts === 1) {
                    throw { code: 429, message: 'Rate limit exceeded' };
                }
                return { verified: true };
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-RATE-002'
            };

            const result = await handler.process(payment);
            expect(result.status).toBe('SUCCESS');
            expect(attempts).toBe(2);
        });

        test('should handle rate limiting', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue({
                code: 429,
                message: 'Rate limit exceeded'
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-RATE-001'
            };

            const result = await handler.process(payment);
            
            // Verify rate limit response
            expect(result.status).toBe('RETRY_SCHEDULED');
            expect(result.retryAfter).toBeGreaterThan(0);
            expect(result.nextAttempt).toBeInstanceOf(Date);
            
            // Check rate limit logging
            const rateLimitLog = await mockDb.collection('rate_limit_logs').get();
            expect(rateLimitLog.docs[0].data()).toMatchObject({
                type: 'RATE_LIMIT',
                paymentReference: payment.reference,
                retryScheduled: true,
                nextAttempt: expect.any(Date),
                attempt: 1,
                backoffDelay: expect.any(Number)
            });
        });

        test('should handle rate limiting', async () => {
            mockDb.bankVerificationService.verify.mockRejectedValue({
                code: 429,
                message: 'Rate limit exceeded'
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100,
                reference: 'TEST-RATE-003'
            };

            const result = await handler.process(payment);
            
            // Verify rate limit handling
            expect(result.status).toBe('RETRY_SCHEDULED');
            expect(result.retryAfter).toBeGreaterThan(0);
            expect(result.nextAttempt).toBeInstanceOf(Date);
            
            // Check retry configuration
            expect(result.attempt).toBe(1);
            expect(result.maxAttempts).toBe(handler.maxRetryAttempts);
            expect(result.backoffDelay).toBe(
                Math.pow(2, result.attempt - 1) * handler.baseRetryDelay
            );

            // Verify logging
            const rateLimitLog = await mockDb.collection('rate_limit_logs').get();
            expect(rateLimitLog.docs[0].data()).toMatchObject({
                type: 'RATE_LIMIT',
                status: 'SCHEDULED_RETRY',
                attempt: 1,
                nextAttempt: expect.any(Date)
            });
        });
    });

    describe('payment plans', () => {
        test('should create payment plan', async () => {
            const planDetails = {
                totalAmount: 1000,
                installments: 3,
                startDate: new Date(),
                accountNumber: '12345678',
                sortCode: '12-34-56',
                reference: 'PLAN-001'
            };

            const result = await handler.createPaymentPlan(planDetails);
            
            expect(result).toMatchObject({
                status: 'ACTIVE',
                totalAmount: 1000,
                installmentAmount: expect.any(Number),
                scheduledPayments: expect.arrayContaining([
                    expect.objectContaining({
                        dueDate: expect.any(Date),
                        amount: expect.any(Number),
                        status: 'SCHEDULED'
                    })
                ])
            });
        });

        test('should process installment payment', async () => {
            const plan = await handler.createPaymentPlan({
                totalAmount: 1000,
                installments: 3,
                startDate: new Date(),
                accountNumber: '12345678',
                sortCode: '12-34-56',
                reference: 'PLAN-002'
            });

            const installment = plan.scheduledPayments[0];
            const result = await handler.processInstallment(installment);

            expect(result).toMatchObject({
                status: 'COMPLETED',
                planId: plan.id,
                installmentNumber: 1,
                amount: installment.amount,
                processed: expect.any(Date),
                remaining: expect.any(Number)
            });

            const updatedPlan = await handler.getPaymentPlan(plan.id);
            expect(updatedPlan.scheduledPayments[0].status).toBe('COMPLETED');
            expect(updatedPlan.completedInstallments).toBe(1);
        });

        test('should handle failed installment', async () => {
            mockDb.processPayment.mockRejectedValue(new Error('Insufficient funds'));

            const plan = await handler.createPaymentPlan({
                totalAmount: 1000,
                installments: 3,
                startDate: new Date(),
                accountNumber: '12345678',
                sortCode: '12-34-56',
                reference: 'PLAN-003'
            });

            const installment = plan.scheduledPayments[0];
            await expect(handler.processInstallment(installment))
                .rejects
                .toThrow('Insufficient funds');

            const updatedPlan = await handler.getPaymentPlan(plan.id);
            expect(updatedPlan.scheduledPayments[0].status).toBe('FAILED');
            expect(updatedPlan.status).toBe('REQUIRES_ATTENTION');
        });
    });

    describe('authentication and authorization', () => {
        test('should handle unauthorized access', async () => {
            // Mock unauthorized token
            mockDb.verifyToken.mockRejectedValue({
                code: 401,
                message: 'Unauthorized access'
            });

            const payment = {
                accountNumber: '12345678',
                sortCode: '12-34-56',
                amount: 100
            };

            await expect(handler.process(payment))
                .rejects
                .toThrow('Unauthorized access');

            const errorLog = await mockDb.collection('auth_errors').get();
            expect(errorLog.docs[0].data()).toMatchObject({
                type: 'AUTH_ERROR',
                code: 401,
                timestamp: expect.any(Date),
                details: expect.any(Object)
            });
        });

        test('should validate API tokens', async () => {
            const invalidToken = 'invalid-token';
            
            await expect(handler.validateToken(invalidToken))
                .rejects
                .toThrow('Invalid API token');

            const authLog = await mockDb.collection('auth_logs').get();
            expect(authLog.docs[0].data()).toMatchObject({
                status: 'FAILED',
                reason: 'INVALID_TOKEN',
                timestamp: expect.any(Date)
            });
        });
    });
});