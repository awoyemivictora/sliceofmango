# from typing import Dict
# from fastapi import APIRouter, Depends, HTTPException, status, Request
# from sqlalchemy.ext.asyncio import AsyncSession
# from sqlalchemy.future import select
# from app.services.db import get_db
# from app.models import User
# from app.models import Subscription
# from app.schemas import SubscriptionRequest, SubscriptionResponse
# from app.dependencies import get_current_user_by_wallet
# from app.utils.logger import get_logger
# from app.config import settings
# # import stripe # pip install stripe
# # import paystack # pip install paystackapi (or a community library)
# from datetime import datetime, timedelta

# logger = get_logger(__name__)

# router = APIRouter()

# stripe.api_key = settings.STRIPE_SECRET_KEY

# # Placeholder for Paystack Client
# # class PaystackClient:
# #     def __init__(self, secret_key: str):
# #         self.secret_key = secret_key
# #         self.base_url = "https://api.paystack.co"

# #     async def initialize_transaction(self, email: str, amount: int, metadata: dict):
# #         headers = {"Authorization": f"Bearer {self.secret_key}", "Content-Type": "application/json"}
# #         payload = {"email": email, "amount": amount * 100, "metadata": metadata} # amount in kobo
# #         async with httpx.AsyncClient() as client:
# #             response = await client.post(f"{self.base_url}/transaction/initialize", json=payload, headers=headers)
# #             response.raise_for_status()
# #             return response.json()

# #     async def verify_transaction(self, reference: str):
# #         headers = {"Authorization": f"Bearer {self.secret_key}"}
# #         async with httpx.AsyncClient() as client:
# #             response = await client.get(f"{self.base_url}/transaction/verify/{reference}", headers=headers)
# #             response.raise_for_status()
# #             return response.json()

# # paystack_client = PaystackClient(settings.PAYSTACK_SECRET_KEY)


# @router.post("/subscribe", response_model=Dict[str, str], status_code=status.HTTP_200_OK)
# async def initiate_subscription(
#     sub_request: SubscriptionRequest,
#     current_user: User = Depends(get_current_user_by_wallet),
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     Initiates a subscription payment via Stripe or Paystack.
#     This will return a checkout URL or payment intent client secret.
#     """
#     if not sub_request.email:
#         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is required for subscription.")
    
#     # Ensure the user record has the email set
#     if not current_user.email:
#         current_user.email = sub_request.email
#         db.add(current_user)
#         await db.commit()
#         await db.refresh(current_user)
#         logger.info(f"User {current_user.wallet_address} updated with email for subscription: {sub_request.email}")

#     # Choose your payment gateway
#     payment_gateway = "stripe" # or "paystack"

#     if payment_gateway == "stripe":
#         try:
#             # Create a Stripe Customer (if not exists)
#             stripe_customer_id = None
#             if current_user.email: # Check if email is associated with a stripe customer
#                 customers = stripe.Customer.list(email=current_user.email, limit=1)
#                 if customers.data:
#                     stripe_customer_id = customers.data[0].id
            
#             if not stripe_customer_id:
#                 customer = stripe.Customer.create(email=current_user.email, name=current_user.wallet_address)
#                 stripe_customer_id = customer.id
            
#             # Create a Checkout Session (for one-time payment or recurring)
#             # For recurring, you'd use `stripe.Subscription` and `stripe.Price` objects
            
#             # Example for a one-time payment (can be adapted for recurring)
#             checkout_session = stripe.checkout.Session.create(
#                 line_items=[
#                     {
#                         'price_data': {
#                             'currency': 'usd',
#                             'product_data': {
#                                 'name': 'Solsniper Premium Plan',
#                                 'description': 'Includes all features for serious traders and gives you maximum protection against rug pulls.'
#                             },
#                             'unit_amount': 2500, # $25.00
#                             'recurring': {'interval': 'month'} # For recurring subscription
#                         },
#                         'quantity': 1,
#                     },
#                 ],
#                 mode='subscription', # or 'payment' for one-time
#                 success_url='http://localhost:3000/subscription/success?session_id={CHECKOUT_SESSION_ID}',
#                 cancel_url='http://localhost:3000/subscription/cancel',
#                 customer=stripe_customer_id,
#                 metadata={
#                     "user_wallet_address": current_user.wallet_address,
#                     "plan_name": "Premium"
#                 }
#             )
#             logger.info(f"Stripe checkout session created for {current_user.wallet_address}: {checkout_session.url}")
#             return {"checkout_url": checkout_session.url}
#         except stripe.error.StripeError as e:
#             logger.error(f"Stripe error initiating subscription: {e}")
#             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Stripe error: {e.user_message}")
#         except Exception as e:
#             logger.error(f"Error initiating Stripe subscription: {e}")
#             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to initiate subscription: {e}")

#     # elif payment_gateway == "paystack":
#     #     try:
#     #         # Example for Paystack
#     #         response = await paystack_client.initialize_transaction(
#     #             email=current_user.email,
#     #             amount=25, # $25 USD, Paystack expects amount in kobo, so * 100
#     #             metadata={"user_wallet_address": current_user.wallet_address, "plan_name": "Premium"}
#     #         )
#     #         if response.get("status") and response["data"].get("authorization_url"):
#     #             logger.info(f"Paystack transaction initialized for {current_user.wallet_address}: {response['data']['authorization_url']}")
#     #             return {"checkout_url": response["data"]["authorization_url"]}
#     #         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Paystack initialization failed.")
#     #     except Exception as e:
#     #         logger.error(f"Error initiating Paystack subscription: {e}")
#     #         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to initiate subscription: {e}")
#     else:
#         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Payment gateway not configured.")




# @router.post("/webhook/stripe")
# async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
#     """
#     Handles Stripe webhook events to update subscription status.
#     This endpoint needs to be exposed to Stripe.
#     """
#     payload = await request.body()
#     sig_header = request.headers.get('stripe-signature')

#     try:
#         event = stripe.Webhook.construct_event(
#             payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
#         )
#     except ValueError as e:
#         # Invalid payload
#         logger.error(f"Stripe webhook invalid payload: {e}")
#         raise HTTPException(status_code=400, detail="Invalid payload")
#     except stripe.error.SignatureVerificationError as e:
#         # Invalid signature
#         logger.error(f"Stripe webhook invalid signature: {e}")
#         raise HTTPException(status_code=400, detail="Invalid signature")

#     # Handle the event
#     if event['type'] == 'checkout.session.completed':
#         session = event['data']['object']
#         user_wallet_address = session.metadata.get("user_wallet_address")
#         plan_name = session.metadata.get("plan_name")
#         stripe_subscription_id = session.get("subscription") # For recurring
        
#         if user_wallet_address and plan_name:
#             user_result = await db.execute(select(User).where(User.wallet_address == user_wallet_address))
#             user = user_result.scalar_one_or_none()
            
#             if user:
#                 user.is_premium = True
                
#                 # Deactivate existing subscriptions
#                 existing_subscriptions_result = await db.execute(
#                     select(Subscription).where(Subscription.user_wallet_address == user_wallet_address, Subscription.is_active == True)
#                 )
#                 for sub in existing_subscriptions_result.scalars().all():
#                     sub.is_active = False
#                     db.add(sub)

#                 new_subscription = Subscription(
#                     user_wallet_address=user_wallet_address,
#                     plan_name=plan_name,
#                     is_active=True,
#                     start_date=datetime.now(),
#                     end_date=datetime.now() + timedelta(days=30), # Assuming monthly
#                     payment_provider_id=stripe_subscription_id
#                 )
#                 db.add(user)
#                 db.add(new_subscription)
#                 await db.commit()
#                 logger.info(f"User {user_wallet_address} subscribed to Premium plan via Stripe.")
#             else:
#                 logger.warning(f"Stripe webhook: User with wallet {user_wallet_address} not found.")
#         else:
#             logger.warning(f"Stripe webhook: Missing metadata for checkout session {session.id}.")

#     elif event['type'] == 'customer.subscription.deleted':
#         subscription = event['data']['object']
#         stripe_subscription_id = subscription.id
        
#         # Find and deactivate the subscription in your DB
#         sub_result = await db.execute(select(Subscription).where(Subscription.payment_provider_id == stripe_subscription_id))
#         sub_record = sub_result.scalar_one_or_none()
        
#         if sub_record:
#             sub_record.is_active = False
#             user_result = await db.execute(select(User).where(User.wallet_address == sub_record.user_wallet_address))
#             user = user_result.scalar_one_or_none()
#             if user:
#                 # Check if user has any other active subscriptions
#                 other_active_subs_count = await db.execute(
#                     select(func.count(Subscription.id))
#                     .where(Subscription.user_wallet_address == user.wallet_address)
#                     .where(Subscription.is_active == True)
#                     .where(Subscription.id != sub_record.id) # Exclude the one being deleted
#                 )
#                 if other_active_subs_count.scalar_one() == 0:
#                     user.is_premium = False # Set to false only if no other active subs
#                     db.add(user)

#             db.add(sub_record)
#             await db.commit()
#             logger.info(f"Stripe subscription {stripe_subscription_id} cancelled/deleted for user {sub_record.user_wallet_address}.")
#         else:
#             logger.warning(f"Stripe webhook: Subscription {stripe_subscription_id} not found in DB for deletion.")

#     # ... handle other event types like 'invoice.payment_failed', etc.

#     return {"status": "success"}

# # @router.post("/webhook/paystack")
# # async def paystack_webhook(request: Request, db: AsyncSession = Depends(get_db)):
# #     """
# #     Handles Paystack webhook events.
# #     """
# #     payload = await request.json()
# #     # Paystack webhook verification (using HMAC-SHA512) is crucial here
# #     # You'd verify the X-Paystack-Signature header with your secret key.
# #     # Omitted for brevity.
    
# #     event_type = payload.get("event")
# #     data = payload.get("data")
    
# #     if event_type == "charge.success":
# #         reference = data.get("reference")
# #         status_paystack = data.get("status")
# #         amount = data.get("amount") / 100 # Convert kobo to currency unit
# #         user_email = data.get("customer", {}).get("email")
# #         metadata = data.get("metadata", {})
# #         user_wallet_address = metadata.get("user_wallet_address")
# #         plan_name = metadata.get("plan_name")
        
# #         if status_paystack == "success" and user_wallet_address and plan_name:
# #             user_result = await db.execute(select(User).where(User.wallet_address == user_wallet_address))
# #             user = user_result.scalar_one_or_none()
            
# #             if user:
# #                 user.is_premium = True
                
# #                 existing_subscriptions_result = await db.execute(
# #                     select(Subscription).where(Subscription.user_wallet_address == user_wallet_address, Subscription.is_active == True)
# #                 )
# #                 for sub in existing_subscriptions_result.scalars().all():
# #                     sub.is_active = False
# #                     db.add(sub)

# #                 new_subscription = Subscription(
# #                     user_wallet_address=user_wallet_address,
# #                     plan_name=plan_name,
# #                     is_active=True,
# #                     start_date=datetime.now(),
# #                     end_date=datetime.now() + timedelta(days=30), # Assuming monthly
# #                     payment_provider_id=reference # Use transaction reference as payment ID
# #                 )
# #                 db.add(user)
# #                 db.add(new_subscription)
# #                 await db.commit()
# #                 logger.info(f"User {user_wallet_address} subscribed to Premium plan via Paystack.")
# #             else:
# #                 logger.warning(f"Paystack webhook: User with wallet {user_wallet_address} not found.")
# #         else:
# #             logger.warning(f"Paystack webhook: Charge success but missing data or not successful: {payload}")
            
# #     return {"status": "success"}





# # @router.get("/status", response_model=SubscriptionResponse)
# # async def get_subscription_status(
# #     current_user: User = Depends(get_current_user_by_wallet),
# #     db: AsyncSession = Depends(get_db)
# # ):
# #     """
# #     Retrieves the current active subscription status for the user.
# #     """
# #     result = await db.execute(
# #         select(Subscription)
# #         .where(Subscription.user_wallet_address == current_user.wallet_address)
# #         .where(Subscription.is_active == True)
# #         .order_by(Subscription.start_date.desc())
# #     )
# #     active_subscription = result.scalar_one_or_none()

# #     if not active_subscription:
# #         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active subscription found.")
    
# #     logger.info(f"Subscription status requested for {current_user.wallet_address}: {active_subscription.plan_name}")
# #     return active_subscription




# # @router.post("/cancel")
# # async def cancel_subscription(
# #     current_user: User = Depends(get_current_user_by_wallet),
# #     db: AsyncSession = Depends(get_db)
# # ):
# #     """
# #     Allows a user to cancel their active subscription.
# #     This often involves calling the payment provider's API.
# #     """
# #     result = await db.execute(
# #         select(Subscription)
# #         .where(Subscription.user_wallet_address == current_user.wallet_address)
# #         .where(Subscription.is_active == True)
# #     )
# #     active_subscription = result.scalar_one_or_none()

# #     if not active_subscription:
# #         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active subscription to cancel.")

# #     try:
# #         # Call Stripe/Paystack API to cancel the subscription
# #         if active_subscription.payment_provider_id and "sub_" in active_subscription.payment_provider_id: # Simple check for Stripe sub ID
# #             stripe.Subscription.delete(active_subscription.payment_provider_id)
# #             logger.info(f"Stripe subscription {active_subscription.payment_provider_id} cancelled via API for user {current_user.wallet_address}")
# #         # elif active_subscription.payment_provider_id: # Assume it's a Paystack reference
# #         #    # Paystack doesn't have a direct "cancel subscription" API for single transactions.
# #         #    # This often means just marking it inactive on your side and handling renewal.
# #         #    logger.info(f"Paystack subscription {active_subscription.payment_provider_id} marked for cancellation by user {current_user.wallet_address}")

# #         # Update in DB
# #         active_subscription.is_active = False
# #         active_subscription.end_date = datetime.now() # End immediately on cancellation
# #         current_user.is_premium = False # Set user to non-premium
# #         db.add(active_subscription)
# #         db.add(current_user)
# #         await db.commit()
# #         logger.info(f"Subscription for {current_user.wallet_address} successfully cancelled.")
# #         return {"message": "Subscription cancelled successfully."}

# #     except stripe.error.StripeError as e:
# #         logger.error(f"Stripe API error during subscription cancellation for {current_user.wallet_address}: {e}")
# #         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to cancel subscription via Stripe: {e.user_message}")
# #     except Exception as e:
# #         logger.error(f"Error cancelling subscription for {current_user.wallet_address}: {e}")
# #         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to cancel subscription: {e}")
    
    
    