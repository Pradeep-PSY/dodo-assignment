# Dodo Payments Shopping Demo

This app simulates a storefront flow where a shopper browses products, adds items to a cart, proceeds to a hosted checkout, and completes a fake payment using a payment form in a separate checkout app.

## Flow of the app

### 1. Product catalog loads on page render

When the app loads, it fetches the product catalogue from the GeekTrust API:

- https://geektrust.s3.ap-southeast-1.amazonaws.com/coding-problems/shopping-cart/catalogue.json
- The data is stored in React state.
- A loading indicator is shown until the catalogue arrives.
- If the request fails, an error message is displayed instead of the product grid.

### 2. User chooses a product

The shopper can:

- browse the catalog grid
- click on a product card to open the individual product detail screen
- review the product name, price, color, description, and stock information

This selection is handled by the `selectedProductId` state and `view` state, which switch between `catalog`, `product`, and `cart` screens.

### 3. User adds products to cart

From the product detail page the shopper can either:

- click `Add to cart` to store the item without leaving the details page
- click `Buy now` to add the item immediately and navigate to the cart page

The shopping cart is stored as a dictionary keyed by product ID. Each entry contains:

- the product object
- the selected quantity

The cart shows:

- total number of items
- running subtotal
- itemized quantity controls
- ability to increase or decrease the quantity

### 4. User proceeds to checkout

Once the shopper is satisfied with the selection, they click `Make a payment` in the cart summary panel.

At this moment the app:

- checks that the cart is not empty
- builds a `sessionMetadata` payload containing:
  - amount
  - currency
  - item count
  - cart line items with id, name, quantity, and unit price
- generates a unique session ID
- opens the hosted checkout using the browser SDK

The checkout is opened in `iframe` mode and the page is hosted on a different origin, which is the intended hosted checkout experience.

### 5. Hosted checkout page loads and asks for card details

The checkout page receives the data in the URL query string through `session_id`, `mode`, and `metadata` parameters.

It reads the items and amount, displays the order summary, and renders a card-payment form with fields for:

- full name
- card number
- expiry date
- CVV

The hosted checkout app validates the form before payment is processed.

### 6. Payment is simulated

The payment flow uses fake card numbers:

- `4242 4242 4242 4242` → success
- `4000 0000 0000 0002` → decline
- `4000 0000 0000 0341` → fails once, then succeeds on retry

When the payment succeeds, the app posts a `success` event back to the parent storefront window. The cart is cleared and the user receives a success message.

When the payment fails or is declined, the checkout page shows a red error message and does not charge the card.

## SDK and hosted checkout behaviour

The storefront uses a browser SDK defined in `src/sdk/checkout.ts`.

The SDK exposes a `Checkout` class with an `open` method. This method:

- verifies the browser environment
- prevents duplicate active checkouts
- creates an iframe or popup
- opens the hosted payment page with session metadata
- listens for `ready`, `success`, `close`, and `error` messages from the checkout page
- triggers merchant callbacks for each lifecycle event

This allows the storefront and the hosted checkout to communicate without coupling the checkout page directly into the merchant app.

## Edge cases and handling

### Double-click on payment button

The payment button is disabled while the checkout is opening or already in progress.

This prevents the same checkout session from being launched multiple times by accident.

The app also guards against duplicate openings in the SDK itself:

- if a checkout is already active, the SDK returns the current flow or emits a `CHECKOUT_ALREADY_OPEN` error
- it prevents multiple modals or windows from stacking on top of each other

### Payment fails

If the bank rejects the card, the checkout app shows a red alert with this message:

> Your bank declined this payment. No charge was made. Try another card or payment method.

This failure:

- keeps the shopper in the checkout experience
- allows them to correct the card details or try another method
- prevents any charge when the result is declined

### Validation errors

The payment form validates:

- required fields
- card number length
- expiry format
- CVV length and numeric constraints

If validation fails, the form highlights the invalid fields and shows the error message instead of sending the payment request.

### Checkout closed by user

If the shopper presses cancel or closes the hosted checkout, the SDK emits a `close` event and the storefront updates its UI to reflect that the checkout was closed without a completed payment.

### Checkout not available or blocked

If the checkout cannot open due to an environment issue or popup blocking, the app shows a friendly message and allows the user to retry.

## Resulting user journey

The complete flow is:

1. The page loads and fetches products.
2. The shopper selects a product and views details.
3. The shopper adds the item to cart and adjusts quantity if needed.
4. The shopper clicks payment.
5. The app builds session metadata and opens hosted checkout on another domain.
6. The checkout form validates the card details.
7. A fake payment is processed.
8. The app emits `success`, `close`, or `error` events back to the parent page.
9. The storefront updates the UI and clears or preserves the cart accordingly.

This matches the expected hosted-checkout pattern where the storefront remains in control of product and cart data while the payment experience is kept in a dedicated secure checkout page.

