export type CheckoutMode = 'iframe' | 'popup';

export interface CheckoutSuccessPayload {
  sessionId: string;
  paymentId: string;
}

export interface CheckoutClosePayload {
  reason: string;
  sessionId: string;
}

export interface CheckoutErrorPayload {
  code: string;
  message: string;
  retryable?: boolean;
  sessionId: string;
}

export interface CheckoutReadyPayload {
  sessionId: string;
}

export interface CheckoutCartMetadata {
  amount?: number;
  currency?: string;
  itemCount?: number;
  items?: Array<{
    id: number | string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
}

export interface CheckoutOpenOptions {
  sessionId: string;
  checkoutUrl?: string;
  allowedOrigin?: string;
  mode?: CheckoutMode;
  width?: number;
  height?: number;
  metadata?: CheckoutCartMetadata;
  onReady?: (payload: CheckoutReadyPayload) => void;
  onSuccess?: (payload: CheckoutSuccessPayload) => void;
  onClose?: (payload: CheckoutClosePayload) => void;
  onError?: (payload: CheckoutErrorPayload) => void;
}

export interface CheckoutController {
  close: () => void;
  isOpen: () => boolean;
}

interface CheckoutMessageEventData {
  source: string;
  event?: 'ready' | 'success' | 'close' | 'error';
  sessionId?: string;
  paymentId?: string;
  reason?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
}

interface ActiveCheckoutState {
  mode: CheckoutMode;
  sessionId: string;
  iframe: HTMLIFrameElement | null;
  overlay: HTMLDivElement | null;
  popup: Window | null;
  closePoll: number | null;
  cleanup: () => void;
  controller: CheckoutController;
}

export class Checkout {
  static active: ActiveCheckoutState | null = null;
  static readonly DEFAULT_CHECKOUT_URL = 'https://checkout-page-eta.vercel.app/';

  static assertBrowser(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('Checkout requires a browser environment');
    }
  }

  static parseOrigin(url: string): string {
    return new URL(url, window.location.href).origin;
  }

  static buildCheckoutUrl(
    base: string,
    sessionId: string,
    mode: CheckoutMode,
    metadata?: CheckoutCartMetadata
  ): string {
    const url = new URL(base, window.location.href);
    url.searchParams.set('session_id', sessionId);
    url.searchParams.set('mode', mode);

    if (metadata) {
      url.searchParams.set('metadata', JSON.stringify(metadata));
    }

    return url.toString();
  }

  static createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.setAttribute('data-checkout-sdk', 'true');
    style.textContent = `
      .checkout-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.62);backdrop-filter:blur(4px)}
      .checkout-modal{position:relative;width:min(100%,520px);height:min(92vh,820px);background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.28)}
      .checkout-frame{display:block;width:100%;height:100%;border:0;background:#fff}
      .checkout-close{position:absolute;right:10px;top:10px;width:38px;height:38px;border:0;border-radius:999px;background:rgba(15,23,42,.08);color:#0f172a;font-size:22px;line-height:38px;cursor:pointer;z-index:2}
      .checkout-close:hover{background:rgba(15,23,42,.14)}
      @media(max-width:600px){.checkout-overlay{padding:0}.checkout-modal{width:100%;height:100%;border-radius:0}}
    `;
    document.head.appendChild(style);
    return style;
  }

  static createIframeUI(onUserClose: () => void, width: number, height: number): {
    overlay: HTMLDivElement;
    iframe: HTMLIFrameElement;
  } {
    const overlay = document.createElement('div');
    overlay.className = 'checkout-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Secure checkout');

    const modal = document.createElement('div');
    modal.className = 'checkout-modal';
    modal.style.width = `${width}px`;
    modal.style.maxWidth = '100%';
    modal.style.height = `${height}px`;

    const close = document.createElement('button');
    close.className = 'checkout-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close checkout');
    close.textContent = '×';
    close.addEventListener('click', onUserClose);

    const iframe = document.createElement('iframe');
    iframe.className = 'checkout-frame';
    iframe.title = 'Secure checkout';
    iframe.allow = 'payment *; clipboard-write';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';

    modal.appendChild(close);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    return { overlay, iframe };
  }

  static closeActive(): void {
    if (!Checkout.active) return;

    const current = Checkout.active;
    Checkout.active = null;
    current.cleanup();
  }

  static open(options: CheckoutOpenOptions): CheckoutController | null {
    Checkout.assertBrowser();

    if (!options.sessionId) {
      throw new Error('Checkout.open: sessionId is required');
    }

    if (Checkout.active) {
      if (Checkout.active.mode === 'popup' && Checkout.active.popup && !Checkout.active.popup.closed) {
        Checkout.active.popup.focus();
      } else if (Checkout.active.mode === 'iframe') {
        Checkout.active.iframe?.focus();
      }

      options.onError?.({
        code: 'CHECKOUT_ALREADY_OPEN',
        message: 'A checkout is already open. Complete or close it before starting another one.',
        retryable: false,
        sessionId: options.sessionId,
      });

      return Checkout.active.controller;
    }

    const mode: CheckoutMode = options.mode || 'iframe';
    const checkoutUrl = options.checkoutUrl || Checkout.DEFAULT_CHECKOUT_URL;
    const allowedOrigin = options.allowedOrigin || Checkout.parseOrigin(checkoutUrl);
    const targetUrl = Checkout.buildCheckoutUrl(checkoutUrl, options.sessionId, mode, options.metadata);
    const width = options.width || 520;
    const height = options.height || 760;

    let style: HTMLStyleElement | null = null;
    let iframe: HTMLIFrameElement | null = null;
    let overlay: HTMLDivElement | null = null;
    let popup: Window | null = null;
    let closePoll: number | null = null;
    let closedBySdk = false;

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== allowedOrigin) return;
      if (Checkout.active?.sessionId !== options.sessionId) return;
      if (mode === 'iframe' && event.source !== iframe?.contentWindow) return;
      if (mode === 'popup' && event.source !== popup) return;

      const data = event.data as CheckoutMessageEventData;
      if (!data || data.source !== 'checkout-sdk') return;
      if (data.sessionId && data.sessionId !== options.sessionId) return;

      switch (data.event) {
        case 'ready':
          options.onReady?.({ sessionId: options.sessionId });
          break;

        case 'success': {
          const current = Checkout.active;
          if (!current) return;

          Checkout.active = null;
          current.cleanup();
          if (popup && !popup.closed) popup.close();

          options.onSuccess?.({
            sessionId: options.sessionId,
            paymentId: data.paymentId || `pay_demo_${Date.now()}`,
          });
          break;
        }

        case 'close': {
          const current = Checkout.active;
          if (!current) return;

          Checkout.active = null;
          current.cleanup();
          if (popup && !popup.closed) popup.close();

          options.onClose?.({
            reason: data.reason || 'unknown',
            sessionId: options.sessionId,
          });
          break;
        }

        case 'error':
          options.onError?.({
            code: data.code || 'CHECKOUT_ERROR',
            message: data.message || 'Payment could not be completed.',
            retryable: data.retryable,
            sessionId: options.sessionId,
          });
          break;

        default:
          break;
      }
    };

    const cleanup = (): void => {
      window.removeEventListener('message', onMessage);
      if (closePoll !== null) window.clearInterval(closePoll);
      overlay?.parentNode?.removeChild(overlay);
      style?.parentNode?.removeChild(style);
    };

    const controller: CheckoutController = {
      close: (): void => {
        closedBySdk = true;
        if (popup && !popup.closed) popup.close();

        if (Checkout.active) {
          const current = Checkout.active;
          Checkout.active = null;
          current.cleanup();
          options.onClose?.({ reason: 'user_closed', sessionId: options.sessionId });
        }
      },
      isOpen: (): boolean => Checkout.active !== null,
    };

    window.addEventListener('message', onMessage);

    if (mode === 'iframe') {
      style = Checkout.createStyles();
      const ui = Checkout.createIframeUI(() => {
        closedBySdk = true;
        if (!Checkout.active) return;

        const current = Checkout.active;
        Checkout.active = null;
        current.cleanup();
        options.onClose?.({ reason: 'user_closed', sessionId: options.sessionId });
      }, width, height);

      overlay = ui.overlay;
      iframe = ui.iframe;
      iframe.src = targetUrl;
    } else {
      popup = window.open(
        targetUrl,
        'Checkout',
        `popup=yes,width=${width},height=${height},noopener=no,noreferrer=no`
      );

      if (!popup) {
        window.removeEventListener('message', onMessage);
        options.onError?.({
          code: 'POPUP_BLOCKED',
          message: 'Your browser blocked the checkout window. Please allow popups and try again.',
          retryable: true,
          sessionId: options.sessionId,
        });
        return null;
      }

      popup.focus();
      closePoll = window.setInterval(() => {
        if (!Checkout.active || !popup || !popup.closed) return;

        window.clearInterval(closePoll as number);
        const current = Checkout.active;
        Checkout.active = null;
        current.cleanup();

        if (!closedBySdk) {
          options.onClose?.({ reason: 'popup_closed', sessionId: options.sessionId });
        }
      }, 250);
    }

    Checkout.active = {
      mode,
      sessionId: options.sessionId,
      iframe,
      overlay,
      popup,
      closePoll,
      cleanup,
      controller,
    };

    return controller;
  }

  static close(): void {
    Checkout.active?.controller.close();
  }

  static isOpen(): boolean {
    return Checkout.active !== null;
  }
}

declare global {
  interface Window {
    Checkout?: typeof Checkout;
    CheckoutSDK?: typeof Checkout;
  }
}

if (typeof window !== 'undefined') {
  window.Checkout = Checkout;
  window.CheckoutSDK = Checkout;
}

export default Checkout;
