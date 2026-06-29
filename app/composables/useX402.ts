import type { QualityAnalysisResult } from '~/types'

/**
 * Client-side x402 payment flow for paid quality scans.
 *
 * Handles the 402 → wallet sign → retry cycle using the browser's
 * ethereum provider (MetaMask, Coinbase Wallet, etc.).
 */
export function useX402() {
  const paying = ref(false)
  const paymentError = ref<string | null>(null)
  const walletConnected = ref(false)
  const walletAddress = ref<string | null>(null)

  // Check if wallet is available
  const hasWallet = computed(() => typeof window !== 'undefined' && !!(window as any).ethereum)

  async function connectWallet(): Promise<string | null> {
    if (typeof window === 'undefined') return null

    const ethereum = (window as any).ethereum
    if (!ethereum) {
      paymentError.value = 'No wallet detected. Install MetaMask or Coinbase Wallet.'
      return null
    }

    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
      if (accounts?.[0]) {
        walletAddress.value = accounts[0]
        walletConnected.value = true
        return accounts[0]
      }
      return null
    } catch (err: any) {
      paymentError.value = err.message ?? 'Failed to connect wallet'
      return null
    }
  }

  /**
   * Execute a paid API call with x402 payment flow.
   *
   * 1. Make initial request → get 402 with payment instructions
   * 2. Sign USDC transfer via wallet
   * 3. Retry request with payment header
   */
  async function payAndFetch<T = any>(
    url: string,
    body: Record<string, any>
  ): Promise<T | null> {
    paying.value = true
    paymentError.value = null

    try {
      // Step 1: Make initial request to get payment instructions
      const initialResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      // If not 402, something else happened
      if (initialResponse.status !== 402) {
        if (initialResponse.ok) {
          return await initialResponse.json()
        }
        const errText = await initialResponse.text()
        throw new Error(`Unexpected response: ${initialResponse.status} ${errText}`)
      }

      // Step 2: Parse payment requirements from 402 response
      const paymentRequired = await initialResponse.json()
      const requirements = paymentRequired.accepts?.[0] ?? paymentRequired.data?.accepts?.[0]

      if (!requirements) {
        throw new Error('Invalid payment requirements from server')
      }

      // Ensure wallet is connected
      if (!walletConnected.value) {
        const addr = await connectWallet()
        if (!addr) throw new Error('Wallet connection required for paid scans')
      }

      // Step 3: Sign the USDC transfer
      const ethereum = (window as any).ethereum
      const paymentPayload = await signUSDCPayment(ethereum, requirements)

      // Step 4: Retry request with payment header
      const paidResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentPayload,
        },
        body: JSON.stringify(body),
      })

      if (!paidResponse.ok) {
        const errText = await paidResponse.text()
        throw new Error(`Payment accepted but request failed: ${errText}`)
      }

      return await paidResponse.json()
    } catch (err: any) {
      paymentError.value = err.message ?? 'Payment failed'
      return null
    } finally {
      paying.value = false
    }
  }

  /**
   * Pay for an instant scan of a single product.
   */
  async function payForInstantScan(params: {
    product_id: string
    workspace_id: string
    product_title: string
    brand_name?: string | null
    category_name?: string | null
    ean?: string | null
    asin?: string | null
    retail_price?: number | null
    currency?: string
  }): Promise<QualityAnalysisResult | null> {
    return payAndFetch<QualityAnalysisResult>('/api/quality/instant', params)
  }

  /**
   * Pay for a bulk scan of multiple products.
   */
  async function payForBulkScan(
    workspace_id: string,
    products: Array<{
      product_id: string
      product_title: string
      brand_name?: string | null
      category_name?: string | null
      ean?: string | null
      asin?: string | null
      retail_price?: number | null
      currency?: string
    }>
  ) {
    return payAndFetch('/api/quality/bulk', { workspace_id, products })
  }

  return {
    paying,
    paymentError,
    walletConnected,
    walletAddress,
    hasWallet,
    connectWallet,
    payForInstantScan,
    payForBulkScan,
  }
}

/**
 * Sign a USDC ERC-20 transfer using the x402 protocol.
 *
 * This creates a signed payment payload that the server can verify
 * via the Coinbase facilitator.
 */
async function signUSDCPayment(
  ethereum: any,
  requirements: {
    payTo: string
    maxAmountRequired: string
    asset: string
    network: string
  }
): Promise<string> {
  const accounts = await ethereum.request({ method: 'eth_accounts' })
  const from = accounts[0]

  if (!from) throw new Error('No wallet account available')

  // Build the x402 payment message
  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network: requirements.network,
    payload: {
      signature: '',
      authorization: {
        from,
        to: requirements.payTo,
        value: requirements.maxAmountRequired,
        validAfter: '0',
        validBefore: Math.floor(Date.now() / 1000 + 300).toString(), // 5 min
        nonce: crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      },
    },
  }

  // EIP-712 typed data for USDC transfer authorization
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: requirements.network === 'base' ? 8453 : 84532, // Base mainnet or Sepolia
      verifyingContract: requirements.asset,
    },
    message: {
      from: payload.payload.authorization.from,
      to: payload.payload.authorization.to,
      value: payload.payload.authorization.value,
      validAfter: payload.payload.authorization.validAfter,
      validBefore: payload.payload.authorization.validBefore,
      nonce: '0x' + payload.payload.authorization.nonce,
    },
  }

  // Sign the typed data
  const signature = await ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [from, JSON.stringify(typedData)],
  })

  payload.payload.signature = signature

  // Return base64-encoded payment payload
  return btoa(JSON.stringify(payload))
}
