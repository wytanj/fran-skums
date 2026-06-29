import { type H3Event, createError, getHeader, setResponseStatus, setResponseHeader } from 'h3'

/**
 * Lightweight x402 adapter for Nitro/H3.
 *
 * Since @x402/express is Express middleware, we build a minimal Nitro-compatible
 * version that handles the 402 Payment Required flow:
 *
 * 1. Check for PAYMENT header
 * 2. If absent → return 402 with payment instructions
 * 3. If present → verify with facilitator → proceed or reject
 */

interface X402Config {
  walletAddress: string
  network: string
  facilitatorUrl: string
}

interface PaymentRequiredPayload {
  x402Version: 1
  accepts: Array<{
    scheme: string
    network: string
    maxAmountRequired: string
    resource: string
    description: string
    mimeType: string
    payTo: string
    maxTimeoutSeconds: number
    asset: string
  }>
}

// USDC contract addresses by network
const USDC_CONTRACTS: Record<string, string> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'ethereum': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'polygon': '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
}

function getConfig(): X402Config {
  const config = useRuntimeConfig()
  return {
    walletAddress: config.x402WalletAddress || '',
    network: config.x402Network || 'base',
    facilitatorUrl: config.x402FacilitatorUrl || 'https://x402.org/facilitator',
  }
}

/**
 * Build a 402 Payment Required response payload.
 */
function buildPaymentRequired(
  price: string,
  resource: string,
  description: string,
  config: X402Config
): PaymentRequiredPayload {
  const usdcAddress = USDC_CONTRACTS[config.network] ?? USDC_CONTRACTS['base']

  // Convert price like "$0.05" to USDC atomic units (6 decimals)
  const priceNum = parseFloat(price.replace(/[^0-9.]/g, ''))
  const amountAtomic = Math.round(priceNum * 1_000_000).toString()

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: config.network,
        maxAmountRequired: amountAtomic,
        resource,
        description,
        mimeType: 'application/json',
        payTo: config.walletAddress,
        maxTimeoutSeconds: 300,
        asset: usdcAddress,
      },
    ],
  }
}

/**
 * Verify a payment with the x402 facilitator.
 */
async function verifyPayment(
  paymentHeader: string,
  payload: PaymentRequiredPayload,
  config: X402Config
): Promise<{ valid: boolean; txHash?: string; error?: string }> {
  try {
    const response = await fetch(`${config.facilitatorUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment: paymentHeader,
        paymentRequirements: payload.accepts[0],
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return { valid: false, error: `Facilitator error: ${text}` }
    }

    const result: any = await response.json()
    return {
      valid: result.valid === true,
      txHash: result.transaction?.hash ?? result.txHash,
      error: result.valid ? undefined : (result.error ?? 'Payment verification failed'),
    }
  } catch (err: any) {
    return { valid: false, error: `Facilitator unreachable: ${err.message}` }
  }
}

/**
 * Settle a verified payment with the facilitator.
 */
async function settlePayment(
  paymentHeader: string,
  payload: PaymentRequiredPayload,
  config: X402Config
): Promise<{ success: boolean; txHash?: string }> {
  try {
    const response = await fetch(`${config.facilitatorUrl}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment: paymentHeader,
        paymentRequirements: payload.accepts[0],
      }),
    })

    if (!response.ok) return { success: false }

    const result: any = await response.json()
    return { success: true, txHash: result.transaction?.hash ?? result.txHash }
  } catch {
    return { success: false }
  }
}

/**
 * x402 payment gate for a Nitro event handler.
 *
 * Call at the top of a paid endpoint. Returns payment receipt info if valid,
 * or throws a 402 error with payment instructions.
 *
 * @example
 * ```ts
 * const receipt = await requireX402Payment(event, '$0.05', 'Instant quality scan')
 * // receipt.txHash, receipt.payerAddress
 * ```
 */
export async function requireX402Payment(
  event: H3Event,
  price: string,
  description: string
): Promise<{ txHash: string | null; payerAddress: string | null }> {
  const config = getConfig()

  if (!config.walletAddress) {
    throw createError({
      statusCode: 500,
      statusMessage: 'x402 wallet not configured. Set X402_WALLET_ADDRESS in .env',
    })
  }

  const resource = event.path ?? '/api/quality/instant'
  const payload = buildPaymentRequired(price, resource, description, config)

  // Check for payment header
  const paymentHeader = getHeader(event, 'X-PAYMENT') ?? getHeader(event, 'x-payment')

  if (!paymentHeader) {
    // No payment — return 402 with instructions
    setResponseStatus(event, 402)
    setResponseHeader(event, 'Content-Type', 'application/json')
    setResponseHeader(event, 'X-PAYMENT-REQUIRED', JSON.stringify(payload))

    throw createError({
      statusCode: 402,
      statusMessage: 'Payment Required',
      data: payload,
    })
  }

  // Verify payment
  const verification = await verifyPayment(paymentHeader, payload, config)

  if (!verification.valid) {
    throw createError({
      statusCode: 402,
      statusMessage: verification.error ?? 'Payment verification failed',
      data: payload,
    })
  }

  // Settle payment
  const settlement = await settlePayment(paymentHeader, payload, config)

  return {
    txHash: settlement.txHash ?? verification.txHash ?? null,
    payerAddress: null, // Extracted from payment header by facilitator
  }
}
