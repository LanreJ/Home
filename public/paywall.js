const stripe = Stripe('pk_live_WExpmdaD9odhD27BiIvbrDYr000xOja9ml'); // Replace with your Stripe publishable key

const subscriptionForm = document.getElementById('subscription-form');
const subscriptionStatus = document.getElementById('subscription-status');

subscriptionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;

  try {
    const response = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });

    const session = await response.json();

    // Redirect to Stripe Checkout
    const { error } = await stripe.redirectToCheckout({ sessionId: session.id });
    if (error) {
      subscriptionStatus.innerText = error.message;
    }
  } catch (error) {
    console.error('Error creating checkout session:', error);
    subscriptionStatus.innerText = 'Failed to initiate subscription.';
  }
});