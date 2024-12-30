const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

class StripeService {
    constructor() {
        this.stripe = stripe;
        this.PRICE_ID = process.env.STRIPE_PRICE_ID;
        this.SUBSCRIPTION_AMOUNT = 1000; // £10.00
    }

    async createSubscription(userId, paymentMethodId) {
        const customer = await this.createCustomer(userId, paymentMethodId);
        return await this.stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: this.PRICE_ID }],
            payment_behavior: 'default_incomplete',
            expand: ['latest_invoice.payment_intent']
        });
    }

    async createCustomer(userId, paymentMethodId) {
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(userId)
            .get();
        
        const userData = userDoc.data();
        
        return await this.stripe.customers.create({
            payment_method: paymentMethodId,
            email: userData.email,
            metadata: {
                firebaseUserId: userId
            }
        });
    }

    async updateUserSubscription(userId, subscription) {
        await admin.firestore()
            .collection('users')
            .doc(userId)
            .update({
                stripeSubscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                subscriptionPriceId: this.PRICE_ID,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    async handleWebhook(event) {
        switch (event.type) {
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                const subscription = event.data.object;
                await this.updateSubscriptionStatus(subscription);
                break;
        }
    }
}

module.exports = StripeService;