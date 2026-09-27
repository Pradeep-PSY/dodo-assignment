import { useEffect, useMemo, useState } from "react";
import "./App.css";

type PaymentStatus = "idle" | "loading" | "success" | "declined" | "failed";

type CheckoutEventName = "ready" | "success" | "close" | "error";

type FormState = {
  fullName: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const SUCCESS_CARD = "4242 4242 4242 4242";
const DECLINE_CARD = "4000 0000 0000 0002";
const RETRY_CARD = "4000 0000 0000 0341";

const initialForm: FormState = {
  fullName: "",
  cardNumber: "",
  expiry: "",
  cvv: "",
};

function formatCardNumber(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);

  if (digits.length <= 2) {
    return digits;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function App() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [message, setMessage] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  const sessionId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("session_id") || "demo-session";
  }, []);

  const mode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") || "iframe";
  }, []);

  const postCheckoutEvent = (
    event: CheckoutEventName,
    extra: Record<string, unknown> = {},
  ) => {
    const payload = {
      source: "checkout-sdk",
      event,
      sessionId,
      mode,
      ...extra,
    };

    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, "*");
    }
  };

  useEffect(() => {
    postCheckoutEvent("ready");

    const handleBeforeUnload = () => {
      postCheckoutEvent("close", { reason: "checkout_closed" });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [sessionId, mode]);

  const metadata = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const rawMetadata = params.get("metadata");

    if (!rawMetadata) {
      return {
        amount: 249,
        currency: "INR",
        itemCount: 1,
        items: [
          {
            id: "demo",
            name: "Dodo Payment Demo",
            quantity: 1,
            unitPrice: 249,
          },
        ],
      };
    }

    try {
      return JSON.parse(rawMetadata) as {
        amount?: number;
        currency?: string;
        itemCount?: number;
        items?: Array<{
          id: number | string;
          name: string;
          quantity: number;
          unitPrice: number;
        }>;
      };
    } catch {
      return {
        amount: 249,
        currency: "INR",
        itemCount: 1,
        items: [
          {
            id: "demo",
            name: "Dodo Payment Demo",
            quantity: 1,
            unitPrice: 249,
          },
        ],
      };
    }
  }, []);

  const amount = useMemo(() => {
    const currency = metadata.currency ?? "INR";
    const value = Number(metadata.amount ?? 249);

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  }, [metadata]);

  const summaryItems = metadata.items ?? [];

  const validateForm = () => {
    const nextErrors: FormErrors = {};

    if (!form.fullName.trim()) {
      nextErrors.fullName = "Full name is required.";
    } else if (form.fullName.trim().length < 2) {
      nextErrors.fullName = "Please enter a valid full name.";
    }

    const cardDigits = form.cardNumber.replace(/\D/g, "");
    if (!cardDigits) {
      nextErrors.cardNumber = "Card number is required.";
    } else if (cardDigits.length !== 16) {
      nextErrors.cardNumber = "Card number must be 16 digits.";
    }

    if (!form.expiry) {
      nextErrors.expiry = "Expiry date is required.";
    } else {
      const [monthStr, yearStr] = form.expiry.split("/");
      const month = Number(monthStr);
      const year = Number(yearStr);

      if (
        !monthStr ||
        !yearStr ||
        month < 1 ||
        month > 12 ||
        Number.isNaN(month) ||
        Number.isNaN(year)
      ) {
        nextErrors.expiry = "Enter a valid expiry date in MM/YY format.";
      }
    }

    const cvvDigits = form.cvv.replace(/\D/g, "");
    if (!cvvDigits) {
      nextErrors.cvv = "CVV is required.";
    } else if (cvvDigits.length !== 3) {
      nextErrors.cvv = "CVV must be 3 digits.";
    } else if (Number(cvvDigits) < 0) {
      nextErrors.cvv = "CVV cannot be negative.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const fakePayment = () => {
    const normalizedCard = form.cardNumber.trim();

    if (normalizedCard === SUCCESS_CARD) {
      return {
        success: true,
        message: "Payment successful. Your order has been placed.",
      };
    }

    if (normalizedCard === DECLINE_CARD) {
      return {
        success: false,
        message:
          "Your bank declined this payment. No charge was made. Try another card or payment method.",
      };
    }

    if (normalizedCard === RETRY_CARD) {
      if (retryCount === 0) {
        setRetryCount(1);
        return { success: false, message: "Payment failed once. Retrying..." };
      }

      return {
        success: true,
        message: "Payment succeeded on retry. Order confirmed.",
      };
    }

    return {
      success: false,
      message: "Payment failed. Please check your card details.",
    };
  };

  const handleChange = (field: keyof FormState, value: string) => {
    const sanitizedValue =
      field === "cardNumber"
        ? formatCardNumber(value)
        : field === "expiry"
          ? formatExpiry(value)
          : value;

    setForm((current) => ({
      ...current,
      [field]:
        field === "cvv"
          ? sanitizedValue.replace(/\D/g, "").slice(0, 3)
          : sanitizedValue,
    }));

    setErrors((current) => ({
      ...current,
      [field]: undefined,
    }));

    if (message) {
      setMessage("");
      setStatus("idle");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validateForm()) {
      const validationMessage =
        "Please fix the highlighted fields and try again.";
      setStatus("failed");
      setMessage(validationMessage);
      postCheckoutEvent("error", {
        code: "VALIDATION_ERROR",
        message: validationMessage,
        retryable: true,
      });
      return;
    }

    setStatus("loading");
    setMessage("Confirming the payment...");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = fakePayment();

    if (result.success) {
      const paymentId = `pay_${Date.now()}`;
      setStatus("success");
      setMessage(result.message);
      postCheckoutEvent("success", { paymentId });
      return;
    }

    setStatus("declined");
    setMessage(result.message);
    postCheckoutEvent("error", {
      code: "CARD_DECLINED",
      message: result.message,
      retryable: true,
    });
  };

  return (
    <div className="checkout-shell">
      <div className="checkout-card">
        <div className="payment-header">
          <div>
            <p className="eyebrow">Secure checkout</p>
            <h1>Card payment</h1>
          </div>
          <div className="amount-badge">{amount}</div>
        </div>

        <div className="payment-methods" aria-label="payment methods">
          <button type="button" className="method active">
            💳 Credit / Debit Card
          </button>
        </div>

        {summaryItems.length > 0 && (
          <div className="item-summary">
            <p className="summary-title">Order details</p>
            <ul>
              {summaryItems.map((item) => (
                <li
                  key={`${item.id}-${item.name}`}
                  className="flex justify-between"
                >
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <strong>
                    {new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: metadata.currency ?? "INR",
                      maximumFractionDigits: 2,
                    }).format((item.unitPrice ?? 0) * (item.quantity ?? 1))}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="payment-form">
          <label>
            <span>Full name</span>
            <input
              type="text"
              name="fullName"
              value={form.fullName}
              onChange={(event) => handleChange("fullName", event.target.value)}
              placeholder="John Doe"
            />
            {errors.fullName && <small>{errors.fullName}</small>}
          </label>

          <label>
            <span>Card number</span>
            <input
              name="cardNumber"
              type="text"
              value={form.cardNumber}
              onChange={(event) =>
                handleChange("cardNumber", event.target.value)
              }
              placeholder="4242 4242 4242 4242"
              inputMode="numeric"
            />
            {errors.cardNumber && <small>{errors.cardNumber}</small>}
          </label>

          <div className="two-column">
            <label>
              <span>Expiration</span>
              <input
                type="text"
                name="expiry"
                value={form.expiry}
                onChange={(event) => handleChange("expiry", event.target.value)}
                placeholder="MM/YY"
                inputMode="numeric"
              />
              {errors.expiry && <small>{errors.expiry}</small>}
            </label>

            <label>
              <span>CVV</span>
              <input
                name="cvv"
                type="password"
                value={form.cvv}
                onChange={(event) => handleChange("cvv", event.target.value)}
                placeholder="123"
                inputMode="numeric"
                maxLength={3}
              />
              {errors.cvv && <small>{errors.cvv}</small>}
            </label>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="cancel-button"
              onClick={() =>
                postCheckoutEvent("close", { reason: "user_closed" })
              }
            >
              Cancel
            </button>
            <button
              type="submit"
              className="pay-button"
              disabled={status === "loading"}
            >
              {status === "loading" ? "Processing..." : "Pay now"}
            </button>
          </div>
        </form>

        {(status !== "idle" || message) && (
          <div className="payment-status" data-state={status}>
            {status === "loading" && (
              <span
                className="payment-spinner"
                aria-label="Confirming payment"
              />
            )}
            <span>
              {message || "Use one of the fake cards to test the flow."}
            </span>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
