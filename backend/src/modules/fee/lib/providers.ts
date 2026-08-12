import crypto from 'crypto'

// The payment provider, behind one small interface.
//
// There are no gateway credentials in this deployment yet, so the default driver
// is 'mock' — it produces real order ids and real webhook signatures, and the
// entire flow (order → redirect → callback → verify → capture → receipt) runs end
// to end against it. What it does NOT do is move money.
//
// The point of the seam is that switching to Razorpay is a credentials change and
// an adapter, not a rewrite of the fee module: nothing outside this file knows
// which provider is in use, and the capture path is shared with the counter.

export interface CreateOrderInput {
  orderId: string
  amountPaise: number
  currency: string
  studentName?: string
  notes?: Record<string, string>
}

export interface ProviderOrder {
  /** The provider's own id, stored so a webhook can be matched back. */
  providerOrderId: string
  /** Handed to the browser SDK / redirect. */
  checkout: Record<string, any>
}

export interface VerifiedEvent {
  providerOrderId: string
  providerPaymentId: string
  status: 'paid' | 'failed'
  amountPaise: number
  method?: string
  failureReason?: string
}

export interface PaymentProvider {
  readonly name: string
  /** True when this driver cannot actually move money. */
  readonly isSimulated: boolean
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>
  /** Verify a webhook body against its signature. Returns null if untrusted. */
  verifyWebhook(rawBody: string, signature: string | undefined): VerifiedEvent | null
}

/**
 * Constant-time comparison. A plain `===` on a signature leaks how many leading
 * bytes matched through timing, which is enough to forge one given patience.
 */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * A signing key for development that is not in this repository.
 *
 * There used to be `?? 'dev-mock-secret'` on the line below, which meant the key
 * every unconfigured deployment signed its webhooks with was a string anyone
 * could read here. Combined with a deterministic order id it made "mark this
 * order paid" a request you could compose from the source alone, with no login.
 *
 * Generated once per process instead. The mock still round-trips — the same
 * value signs and verifies — so development is unaffected, but nothing in
 * version control produces a signature this process will accept, and a restart
 * invalidates yesterday's.
 */
const EPHEMERAL_DEV_SECRET = crypto.randomBytes(32).toString('hex')

const MIN_SECRET_LENGTH = 16

function webhookSecret(): string {
  const configured = process.env.PAYMENT_WEBHOOK_SECRET
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      configured
        ? `PAYMENT_WEBHOOK_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`
        : 'PAYMENT_WEBHOOK_SECRET is not set. Refusing to sign or verify a payment webhook without one.',
    )
  }
  return EPHEMERAL_DEV_SECRET
}

// ── Mock ──────────────────────────────────────────────────────────────
//
// Signs its callbacks with the same HMAC-SHA256 scheme Razorpay uses, so the
// verification path being exercised in development is the one that will run in
// production — rather than a bypass that gets discovered on go-live day.

class MockProvider implements PaymentProvider {
  readonly name = 'mock'
  readonly isSimulated = true

  private get secret(): string {
    return webhookSecret()
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    // Random, not derived from our own order id. The old form
    // (`mock_order_${orderId without dashes}`) was DERIVABLE: anyone who had ever
    // seen one order could compute the provider id of any other, which is half of
    // a forged capture. The id is stored on the order row either way, so nothing
    // downstream needs it to be reconstructible.
    const providerOrderId = `mock_order_${crypto.randomBytes(12).toString('hex')}`
    return {
      providerOrderId,
      checkout: {
        provider: 'mock',
        order_id: providerOrderId,
        amount: input.amountPaise,
        currency: input.currency,
        // No real checkout to redirect to. The portal shows a confirm step that
        // posts back to /simulate, which signs an event exactly as a provider would.
        simulated: true,
      },
    }
  }

  verifyWebhook(rawBody: string, signature: string | undefined): VerifiedEvent | null {
    if (!signature) return null
    const expected = crypto.createHmac('sha256', this.secret).update(rawBody).digest('hex')
    if (!safeEqual(expected, signature)) return null

    try {
      const body = JSON.parse(rawBody)
      if (!body.order_id || !body.payment_id) return null
      return {
        providerOrderId: String(body.order_id),
        providerPaymentId: String(body.payment_id),
        status: body.status === 'paid' ? 'paid' : 'failed',
        amountPaise: Number(body.amount) || 0,
        method: body.method,
        failureReason: body.failure_reason,
      }
    } catch {
      return null
    }
  }

  /** Test helper: sign a body the way the provider would. Mock only. */
  sign(rawBody: string): string {
    return crypto.createHmac('sha256', this.secret).update(rawBody).digest('hex')
  }
}

// ── Razorpay ──────────────────────────────────────────────────────────
//
// Left deliberately unimplemented rather than half-written. Filling this in is:
// POST https://api.razorpay.com/v1/orders with basic auth, and a webhook whose
// signature is HMAC-SHA256 of the raw body under the webhook secret — the same
// verification shape the mock already exercises.

class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay'
  readonly isSimulated = false
  private keyId = process.env.RAZORPAY_KEY_ID ?? ''
  private keySecret = process.env.RAZORPAY_KEY_SECRET ?? ''

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    if (!this.keyId || !this.keySecret) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set')
    }
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        // Our own id, echoed back on the webhook — the tie between their record
        // and ours if an order id is ever ambiguous.
        receipt: input.orderId,
        notes: input.notes ?? {},
      }),
    })
    if (!res.ok) throw new Error(`Razorpay order failed: ${res.status} ${await res.text()}`)
    const order: any = await res.json()
    return {
      providerOrderId: order.id,
      checkout: {
        provider: 'razorpay',
        key: this.keyId,
        order_id: order.id,
        amount: input.amountPaise,
        currency: input.currency,
        name: input.studentName,
      },
    }
  }

  verifyWebhook(rawBody: string, signature: string | undefined): VerifiedEvent | null {
    if (!signature) return null
    const expected = crypto.createHmac('sha256', webhookSecret()).update(rawBody).digest('hex')
    if (!safeEqual(expected, signature)) return null

    try {
      const body = JSON.parse(rawBody)
      const entity = body?.payload?.payment?.entity
      if (!entity?.order_id || !entity?.id) return null
      return {
        providerOrderId: entity.order_id,
        providerPaymentId: entity.id,
        status: body.event === 'payment.captured' ? 'paid' : 'failed',
        amountPaise: Number(entity.amount) || 0,
        method: entity.method,
        failureReason: entity.error_description,
      }
    } catch {
      return null
    }
  }
}

const mock = new MockProvider()
const razorpay = new RazorpayProvider()

export function providerByName(name: string): PaymentProvider | null {
  return name === 'razorpay' ? razorpay : name === 'mock' ? mock : null
}

/**
 * The active driver.
 *
 * It used to be `(process.env.PAYMENT_PROVIDER ?? 'mock') === 'razorpay'`, and
 * the `?? 'mock'` was the whole problem: PAYMENT_PROVIDER was declared in
 * neither render.yaml nor .env.example, so a production deploy from this repo
 * silently ran the simulator. Everything downstream then behaved as designed —
 * and what it was designed to do, when simulated, is mark orders paid.
 *
 * Development still defaults to mock, because a local checkout that 500s helps
 * nobody. Production has to say which driver it wants out loud.
 */
export function activeProvider(): PaymentProvider {
  const configured = process.env.PAYMENT_PROVIDER

  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PAYMENT_PROVIDER is not set. Set it to "mock" to keep the simulated flow, ' +
        'or "razorpay" once credentials exist. Defaulting silently is how a live ' +
        'deployment ends up running the simulator.',
      )
    }
    return mock
  }

  const provider = providerByName(configured)
  if (!provider) {
    throw new Error(`PAYMENT_PROVIDER is "${configured}", which is not a driver this build knows. Use "mock" or "razorpay".`)
  }
  return provider
}

/**
 * Why the gateway would refuse to run, or null if it is properly configured.
 *
 * Checked at boot (so a misconfiguration is a startup line rather than a
 * mystery) and again per request (so the routes fail closed with a 503 instead
 * of throwing out of a handler). Deliberately does NOT kill the process: this is
 * a school ERP, and attendance, exams and the timetable should not stop because
 * a payment key is missing.
 */
export function paymentConfigError(): string | null {
  try {
    activeProvider()
    webhookSecret()
    return null
  } catch (e: any) {
    return e.message
  }
}

export { mock as mockProvider }
