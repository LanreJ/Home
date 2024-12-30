const admin = require('firebase-admin');

async function checkSubscription(req, res, next) {
    try {
        const userId = req.user.uid;
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(userId)
            .get();

        if (!userDoc.exists || !userDoc.data().subscriptionStatus === 'active') {
            return res.status(403).json({
                error: 'Subscription required',
                code: 'SUBSCRIPTION_REQUIRED'
            });
        }
        next();
    } catch (error) {
        res.status(500).send({ error: 'Internal server error' });
    }
}

module.exports = checkSubscription;