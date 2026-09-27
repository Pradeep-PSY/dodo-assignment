import { useEffect, useMemo, useState } from 'react'
import './App.css'
import CheckoutSDK from './sdk/checkout'

type Product = {
  id: number
  imageURL: string
  name: string
  type: string
  price: number
  currency: string
  color: string
  gender: string
  quantity: number
}

type CartEntry = {
  product: Product
  quantity: number
}

type View = 'catalog' | 'product' | 'cart'

const CATALOGUE_URL =
  'https://geektrust.s3.ap-southeast-1.amazonaws.com/coding-problems/shopping-cart/catalogue.json'

function getProductDescription(product: Product) {
  const base = `${product.gender} ${product.type.toLowerCase()} in ${product.color.toLowerCase()} with a clean, athletic look.`

  if (product.type.toLowerCase().includes('hoodie')) {
    return `${base} Crafted for comfortable layering and everyday movement with a premium finish.`
  }

  if (product.type.toLowerCase().includes('polo')) {
    return `${base} Designed with a structured collar and refined details for easy smart-casual styling.`
  }

  if (product.type.toLowerCase().includes('shirt')) {
    return `${base} A versatile staple for workdays and weekends, finished with a tailored silhouette.`
  }

  if (product.type.toLowerCase().includes('sweater')) {
    return `${base} Soft-touch comfort and warmth for cooler evenings, without compromising on polish.`
  }

  return `${base} A statement piece that balances comfort, versatility, and a premium finish.`
}

function App() {
  const [view, setView] = useState<View>('catalog')
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [cart, setCart] = useState<Record<number, CartEntry>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paymentMessage, setPaymentMessage] = useState('')
  const [checkoutInProgress, setCheckoutInProgress] = useState(false)

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(CATALOGUE_URL)

        if (!response.ok) {
          throw new Error('Unable to fetch product catalogue.')
        }

        const data = (await response.json()) as Product[]
        setProducts(data)
      } catch (fetchError) {
        setError(
          fetchError instanceof Error ? fetchError.message : 'Something went wrong while loading products.'
        )
      } finally {
        setLoading(false)
      }
    }

    void fetchProducts()
  }, [])

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null

  const cartItems = useMemo(() => Object.values(cart), [cart])

  const cartCount = useMemo(
    () => cartItems.reduce((total, item) => total + item.quantity, 0),
    [cartItems]
  )

  const cartTotal = useMemo(
    () => cartItems.reduce((total, item) => total + item.product.price * item.quantity, 0),
    [cartItems]
  )

  const addToCart = (product: Product, quantity = 1) => {
    setPaymentMessage('')
    setCart((previousCart) => {
      const existingItem = previousCart[product.id]
      const nextQuantity = (existingItem?.quantity ?? 0) + quantity

      return {
        ...previousCart,
        [product.id]: {
          product,
          quantity: nextQuantity,
        },
      }
    })
  }

  const updateQuantity = (productId: number, delta: number) => {
    setCart((previousCart) => {
      const existingItem = previousCart[productId]

      if (!existingItem) {
        return previousCart
      }

      const nextQuantity = existingItem.quantity + delta

      if (nextQuantity <= 0) {
        const updatedCart = { ...previousCart }
        delete updatedCart[productId]
        return updatedCart
      }

      return {
        ...previousCart,
        [productId]: {
          ...existingItem,
          quantity: nextQuantity,
        },
      }
    })
  }

  const handleBuyNow = (product: Product) => {
    addToCart(product, 1)
    setView('cart')
  }

  const resetCheckoutUi = () => {
    setCheckoutInProgress(false)
    setPaymentMessage('')
  }

  const handleCheckout = () => {
    if (cartItems.length === 0) {
      return
    }

    const checkout = window.Checkout ?? CheckoutSDK

    if (!checkout || typeof checkout.open !== 'function') {
      resetCheckoutUi()
      setPaymentMessage('Secure checkout is unavailable. Please try again.')
      return
    }

    const sessionId = `shop-session-${Date.now()}`
    const sessionMetadata = {
      amount: cartTotal,
      currency: 'INR',
      itemCount: cartCount,
      items: cartItems.map(({ product, quantity }) => ({
        id: product.id,
        name: product.name,
        quantity,
        unitPrice: product.price,
      })),
    }


    setCheckoutInProgress(true)
    setPaymentMessage('Opening secure checkout...')

    try {
      const result = checkout.open({
        sessionId,
        checkoutUrl: 'https://checkout-page-eta.vercel.app/',
        mode: 'iframe',
        width: 620,
        height: 860,
        metadata: sessionMetadata,
        onReady: ({ sessionId: readySessionId }) => {
          setPaymentMessage(`Hosted checkout ready for session ${readySessionId}.`)
        },
        onSuccess: ({ sessionId: successSessionId, paymentId }) => {
          setCheckoutInProgress(false)
          setPaymentMessage(`Payment successful for session ${successSessionId}. Payment ID: ${paymentId}`)
          setCart({})
        },
        onClose: ({ reason, sessionId: closedSessionId }) => {
          setCheckoutInProgress(false)
          setPaymentMessage(`Checkout closed for session ${closedSessionId}. Reason: ${reason}`)
        },
        onError: ({ code, message, retryable, sessionId: errorSessionId }) => {
          setCheckoutInProgress(false)
          setPaymentMessage(
            retryable
              ? `Checkout error for session ${errorSessionId} (${code}): ${message}. Please try again.`
              : `Checkout rejected for session ${errorSessionId} (${code}): ${message}`
          )
        },
      })

      if (result === null || result === undefined) {
        resetCheckoutUi()
        setPaymentMessage('Checkout could not be opened. Please try again.')
      }
    } catch (error) {
      resetCheckoutUi()
      setPaymentMessage(
        error instanceof Error ? `Checkout could not be opened: ${error.message}` : 'Checkout could not be opened. Please try again.'
      )
    }
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-block" onClick={() => setView('catalog')} role="button" tabIndex={0}>
          <div className="brand-mark">D</div>
          <div>
            <p className="eyebrow">Dodo Payments</p>
            <h1>Style Store</h1>
          </div>
        </div>

        <button className="cart-button" type="button" onClick={() => setView('cart')}>
          <span className="cart-icon" aria-hidden="true">
            🛒
          </span>
          <span>Cart</span>
          <span className="cart-badge">{cartCount}</span>
        </button>
      </header>

      {view === 'catalog' && (
        <main className="catalog-page">
          <section className="catalog-hero">
            <span className="pill">Fresh arrivals</span>
            <h2>Premium essentials for every day.</h2>
            <p>
              Discover elevated staples and statement pieces designed for comfort, confidence, and everyday style.
            </p>
          </section>

          {loading && <p className="status-text">Loading products...</p>}
          {error && <p className="status-text error">{error}</p>}

          {!loading && !error && (
            <div className="product-grid">
              {products.map((product) => (
                <article
                  key={product.id}
                  className="product-card"
                  onClick={() => {
                    setSelectedProductId(product.id)
                    setView('product')
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedProductId(product.id)
                      setView('product')
                    }
                  }}
                >
                  <div className="product-image-wrap">
                    <img src={product.imageURL} alt={product.name} />
                  </div>
                  <div className="product-copy">
                    <div className="product-meta">
                      <span>{product.gender}</span>
                      <span>{product.type}</span>
                    </div>
                    <h3>{product.name}</h3>
                    <p className="product-color">{product.color}</p>
                    <div className="product-footer">
                      <strong>₹{product.price}</strong>
                      <button
                        type="button"
                        className="inline-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedProductId(product.id)
                          setView('product')
                        }}
                      >
                        View details
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      )}

      {view === 'product' && selectedProduct && (
        <main className="detail-page">
          <button className="back-link" type="button" onClick={() => setView('catalog')}>
            ← Back to catalog
          </button>

          <div className="detail-layout">
            <div className="gallery-panel">
              <img src={selectedProduct.imageURL} alt={selectedProduct.name} />
            </div>

            <div className="detail-panel">
              <p className="eyebrow product-eyebrow">
                {selectedProduct.gender} / {selectedProduct.type}
              </p>
              <h2>{selectedProduct.name}</h2>

              <div className="price-row">
                <span className="price-tag">₹{selectedProduct.price}</span>
                <span className="detail-tag">{selectedProduct.color}</span>
              </div>

              <p className="description">{getProductDescription(selectedProduct)}</p>

              <div className="detail-badges">
                <span>In stock: {selectedProduct.quantity}</span>
                <span>Premium fabric</span>
              </div>

              <div className="cta-row">
                <button className="secondary-button" type="button" onClick={() => addToCart(selectedProduct)}>
                  Add to cart
                </button>
                <button className="primary-button" type="button" onClick={() => handleBuyNow(selectedProduct)}>
                  Buy now
                </button>
              </div>
            </div>
          </div>
        </main>
      )}

      {view === 'cart' && (
        <main className="cart-page">
          <button className="back-link" type="button" onClick={() => setView('catalog')}>
            ← Continue shopping
          </button>

          {cartItems.length === 0 ? (
            <div className="empty-cart">
              <h2>Your cart is empty</h2>
              <p>Add a few standout pieces to begin your order.</p>
              <button className="primary-button" type="button" onClick={() => setView('catalog')}>
                Browse products
              </button>
            </div>
          ) : (
            <div className="cart-layout">
              <div className="cart-items">
                {cartItems.map(({ product, quantity }) => (
                  <div className="cart-item" key={product.id}>
                    <img src={product.imageURL} alt={product.name} />

                    <div className="cart-item-copy">
                      <h3>{product.name}</h3>
                      <p>
                        {product.color} • {product.gender}
                      </p>
                    </div>

                    <div className="quantity-control" aria-label={`Quantity for ${product.name}`}>
                      <button type="button" onClick={() => updateQuantity(product.id, -1)}>
                        −
                      </button>
                      <span>{quantity}</span>
                      <button type="button" onClick={() => updateQuantity(product.id, 1)}>
                        +
                      </button>
                    </div>

                    <strong>₹{product.price * quantity}</strong>
                  </div>
                ))}
              </div>

              <aside className="summary-panel">
                <h3>Order summary</h3>
                <div className="summary-row">
                  <span>Subtotal</span>
                  <strong>₹{cartTotal}</strong>
                </div>
                <div className="summary-row">
                  <span>Delivery</span>
                  <strong>Free</strong>
                </div>
                <div className="summary-row total-row">
                  <span>Total</span>
                  <strong>₹{cartTotal}</strong>
                </div>

                <button
                  className="primary-button checkout-button"
                  type="button"
                  onClick={handleCheckout}
                  disabled={checkoutInProgress}
                >
                  {checkoutInProgress ? 'Opening checkout...' : 'Make a payment'}
                </button>

                {paymentMessage && <p className="payment-message">{paymentMessage}</p>}
              </aside>
            </div>
          )}
        </main>
      )}
    </div>
  )
}

export default App
